import { OrgFileRef, OrgMatch } from '@/types/org-scan';
import { findComplianceForModel } from './compliance';

/**
 * S2 — Report-only org scanner. Reuses R2-style model-id pattern matching
 * over file text supplied by the caller (the GitHub App fetch layer lives
 * outside this pure module so tests never touch the network).
 * Stores match locations + matched line ONLY.
 */
const MODEL_ID_PATTERN = /[a-z0-9][a-z0-9_.-]*\/[a-z0-9][a-z0-9_.\-/:]*/gi;

export function extractModelRefs(text: string): string[] {
  const out = new Set<string>();
  for (const m of text.matchAll(MODEL_ID_PATTERN)) {
    const cand = m[0].replace(/[:.,;)\]]+$/, '');
    if (cand.includes('/') && cand.length <= 120) out.add(cand);
  }
  return [...out];
}

export function scanFilesForModels(
  files: Array<{ repo: string; path: string; content: string }>,
  knownModels: Set<string> | string[],
  deprecationLookup?: (modelId: string) => 'active' | 'announced' | 'removed' | 'unknown'
): OrgMatch[] {
  const known = new Set([...knownModels].map((s) => s.toLowerCase()));
  const matches: OrgMatch[] = [];
  for (const f of files) {
    const lines = f.content.split('\n');
    lines.forEach((line, idx) => {
      for (const ref of extractModelRefs(line)) {
        const key = ref.toLowerCase().replace(/:free$/, '');
        const hit = [...known].find((k) => k === key || key.includes(k) || k.includes(key));
        if (!hit) continue;
        const status = deprecationLookup ? deprecationLookup(hit) : 'unknown';
        matches.push({
          repo: f.repo,
          path: f.path,
          line: idx + 1,
          matched_line: line.slice(0, 500),
          matched_model: hit,
          deprecation_status: status,
          risk_note:
            status === 'removed'
              ? 'Model has a MODEL_REMOVED event — migrate off it.'
              : status === 'announced'
                ? 'Model has a sourced deprecation announcement (see S1).'
                : findComplianceForModel(hit)?.hipaa_eligible === false
                  ? 'Provider posture flags this model for compliance review.'
                  : null,
        });
      }
    });
  }
  return matches;
}

export function toReportIndex(matches: OrgMatch[]): OrgFileRef[] {
  return matches.map((m) => ({ repo: m.repo, path: m.path, line: m.line, matched_line: m.matched_line }));
}
