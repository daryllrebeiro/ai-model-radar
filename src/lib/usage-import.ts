/**
 * R5 — Real usage import & spend reconciliation (Tier C).
 *
 * Upload-based MVP only (no provider billing OAuth — separate decision).
 * Pure CSV parsing/aggregation/reconciliation: no I/O, fully unit-testable.
 * Caps enforced here so oversized uploads are rejected before touching the DB.
 */
import { ModelSnapshot } from '@/types/models';
import { findMigrationAlternatives } from './migration-advisor';
import { effectiveMonthlyCost, DEFAULT_COST_SCENARIO } from './cost-model';

export const USAGE_IMPORT_MAX_BYTES = 2 * 1024 * 1024;
export const USAGE_IMPORT_MAX_ROWS = 5000;

export interface UsageImportRow {
  model_id: string;
  prompt_tokens: number;
  completion_tokens: number;
  cost_usd: number | null;
}

export interface UsageImportAggregate {
  rows: UsageImportRow[];
  total_spend_usd: number;
  cost_estimated: boolean;
}

const MODEL_HEADERS = new Set(['model', 'model_id', 'model_name', 'name']);
const PROMPT_HEADERS = new Set(['prompt_tokens', 'input_tokens', 'input', 'prompt', 'prompt_token']);
const COMP_HEADERS = new Set(['completion_tokens', 'output_tokens', 'output', 'completion', 'completion_token']);
const COST_HEADERS = new Set(['cost', 'cost_usd', 'total_cost', 'spend', 'spend_usd', 'amount']);

function splitCsvLine(line: string): string[] {
  // Minimal RFC-4180: quoted fields with embedded commas/doubled quotes.
  const out: string[] = [];
  let cur = '';
  let inQuotes = false;
  for (let i = 0; i < line.length; i++) {
    const c = line[i];
    if (inQuotes) {
      if (c === '"') {
        if (line[i + 1] === '"') { cur += '"'; i++; }
        else inQuotes = false;
      } else cur += c;
    } else if (c === '"') inQuotes = true;
    else if (c === ',') { out.push(cur); cur = ''; }
    else cur += c;
  }
  out.push(cur);
  return out.map((s) => s.trim());
}

function toNonNegativeNumber(raw: string): number | null {
  if (raw === '' || raw == null) return null;
  const n = Number(raw.replace(/[$,]/g, ''));
  if (!Number.isFinite(n) || n < 0) return null;
  return n;
}

/** Parses + validates an uploaded usage CSV. Throws on any malformed input. */
export function parseUsageCsv(csv: string): UsageImportAggregate {
  if (typeof csv !== 'string' || csv.length === 0) {
    throw new Error('Empty CSV upload.');
  }
  if (csv.length > USAGE_IMPORT_MAX_BYTES) {
    throw new Error(`CSV exceeds the ${USAGE_IMPORT_MAX_BYTES / 1024 / 1024}MB upload limit.`);
  }
  const lines = csv.split(/\r?\n/).map((l) => l.trim()).filter((l) => l.length > 0);
  if (lines.length < 2) {
    throw new Error('CSV must contain a header row plus at least one data row.');
  }
  if (lines.length - 1 > USAGE_IMPORT_MAX_ROWS) {
    throw new Error(`CSV exceeds the ${USAGE_IMPORT_MAX_ROWS}-row upload limit.`);
  }
  const headers = splitCsvLine(lines[0]).map((h) => h.toLowerCase());
  const modelIdx = headers.findIndex((h) => MODEL_HEADERS.has(h));
  const promptIdx = headers.findIndex((h) => PROMPT_HEADERS.has(h));
  const compIdx = headers.findIndex((h) => COMP_HEADERS.has(h));
  const costIdx = headers.findIndex((h) => COST_HEADERS.has(h));
  if (modelIdx === -1 || promptIdx === -1 || compIdx === -1) {
    throw new Error(
      'Unrecognized CSV headers. Required: a model column (model/model_id), ' +
      'a prompt-tokens column (prompt_tokens/input_tokens), and a completion-tokens ' +
      'column (completion_tokens/output_tokens). Optional: cost/cost_usd.'
    );
  }

  const byModel = new Map<string, UsageImportRow>();
  let costEstimated = costIdx === -1;
  for (let i = 1; i < lines.length; i++) {
    const cols = splitCsvLine(lines[i]);
    const modelId = (cols[modelIdx] || '').trim();
    if (!modelId || modelId.length > 200) {
      throw new Error(`Row ${i + 1}: invalid model id.`);
    }
    const prompt = toNonNegativeNumber(cols[promptIdx] || '');
    const comp = toNonNegativeNumber(cols[compIdx] || '');
    if (prompt === null || comp === null) {
      throw new Error(`Row ${i + 1}: token counts must be non-negative numbers.`);
    }
    let cost: number | null = null;
    if (costIdx !== -1) {
      cost = toNonNegativeNumber(cols[costIdx] || '');
      if (cost === null) {
        throw new Error(`Row ${i + 1}: cost must be a non-negative number.`);
      }
    }
    const key = modelId.toLowerCase();
    const prev = byModel.get(key);
    if (prev) {
      prev.prompt_tokens += prompt;
      prev.completion_tokens += comp;
      if (cost !== null) prev.cost_usd = (prev.cost_usd || 0) + cost;
      else costEstimated = true;
    } else {
      byModel.set(key, { model_id: modelId, prompt_tokens: prompt, completion_tokens: comp, cost_usd: cost });
    }
  }

  const rows = [...byModel.values()];
  const total_spend_usd = Math.round(rows.reduce((s, r) => s + (r.cost_usd || 0), 0) * 100) / 100;
  return { rows, total_spend_usd, cost_estimated: costEstimated };
}

export interface ReconciledRow extends UsageImportRow {
  actual_spend_usd: number;
  actual_estimated: boolean;
  alt_model_id: string | null;
  alt_spend_usd: number | null;
  savings_usd: number | null;
}

export interface ReconciliationReport {
  rows: ReconciledRow[];
  total_actual_usd: number;
  total_alt_usd: number;
  total_savings_usd: number;
  estimates_present: boolean;
}

/**
 * "You spent $X on Model A; Model B would have cost $Y."
 * Actuals come from the upload; where the upload has no cost column the
 * current catalog price is used and flagged estimated. Alternatives reuse
 * the migration advisor over live snapshots.
 */
export function reconcileUsageImport(
  rows: UsageImportRow[],
  snapshots: ModelSnapshot[]
): ReconciliationReport {
  const out: ReconciledRow[] = rows.map((r) => {
    const snap = snapshots.find((s) => s.model_id.toLowerCase() === r.model_id.toLowerCase());
    let actual = r.cost_usd;
    let estimated = false;
    if (actual === null) {
      estimated = true;
      actual =
        snap && snap.price_prompt !== null && snap.price_completion !== null
          ? effectiveMonthlyCost(
              r.prompt_tokens,
              r.completion_tokens,
              snap.price_prompt * 1_000_000,
              snap.price_completion * 1_000_000,
              DEFAULT_COST_SCENARIO
            )
          : 0;
    }
    const report = findMigrationAlternatives(r.model_id, snapshots);
    const alt = report?.alternatives?.[0] || null;
    const altSpend = alt
      ? effectiveMonthlyCost(
          r.prompt_tokens,
          r.completion_tokens,
          alt.prompt_per_1m,
          alt.comp_per_1m,
          DEFAULT_COST_SCENARIO
        )
      : null;
    const savings = altSpend !== null ? Math.round((actual - altSpend) * 100) / 100 : null;
    return {
      ...r,
      actual_spend_usd: Math.round(actual * 100) / 100,
      actual_estimated: estimated,
      alt_model_id: alt ? alt.model_id : null,
      alt_spend_usd: altSpend,
      savings_usd: savings !== null && savings > 0 ? savings : 0,
    };
  });
  const total_actual_usd = Math.round(out.reduce((s, r) => s + r.actual_spend_usd, 0) * 100) / 100;
  const total_alt_usd = Math.round(out.reduce((s, r) => s + (r.alt_spend_usd || 0), 0) * 100) / 100;
  return {
    rows: out,
    total_actual_usd,
    total_alt_usd,
    total_savings_usd: Math.round(out.reduce((s, r) => s + (r.savings_usd || 0), 0) * 100) / 100,
    estimates_present: out.some((r) => r.actual_estimated) || out.some((r) => r.alt_model_id === null),
  };
}
