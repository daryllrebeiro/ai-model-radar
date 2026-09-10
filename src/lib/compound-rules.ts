/**
 * R6 — Compound alert rule builder (Tier C).
 *
 * Fixed, safe condition set combined with AND/OR across category/tag,
 * price-change threshold, context-length threshold, provider, and event
 * type. Rules evaluate against the existing event stream. No arbitrary
 * user scripting — no expression language, no eval.
 */
import { ModelEvent } from '@/types/events';
import { ModelSnapshot } from '@/types/models';
import { extractModelFamily } from './arbitrage';
import { findCapabilityForModel } from './capabilities';

export type CompoundField = 'category' | 'price_drop_pct' | 'context_min' | 'provider' | 'event_type';
export type CompoundOp = 'eq' | 'gte' | 'lte' | 'contains';
export type CompoundLogic = 'and' | 'or';

export interface CompoundCondition {
  field: CompoundField;
  op: CompoundOp;
  value: string | number;
}

export interface CompoundRuleInput {
  name: string;
  logic: CompoundLogic;
  conditions: CompoundCondition[];
}

export const COMPOUND_EVENT_TYPES = [
  'NEW_MODEL',
  'MODEL_REMOVED',
  'PRICE_CHANGE',
  'BECAME_FREE',
  'LEFT_FREE',
  'CONTEXT_CHANGED',
] as const;

const FIELD_OPS: Record<CompoundField, CompoundOp[]> = {
  category: ['contains', 'eq'],
  price_drop_pct: ['gte', 'lte', 'eq'],
  context_min: ['gte'],
  provider: ['eq', 'contains'],
  event_type: ['eq'],
};

/** Pure validation for the fixed condition set. Returns error strings (empty = valid). */
export function validateCompoundRule(rule: CompoundRuleInput): string[] {
  const errors: string[] = [];
  if (!rule.name || rule.name.trim().length === 0) errors.push('Rule name is required.');
  if (rule.logic !== 'and' && rule.logic !== 'or') errors.push('Logic must be "and" or "or".');
  if (!Array.isArray(rule.conditions) || rule.conditions.length === 0) {
    errors.push('At least one condition is required.');
    return errors;
  }
  if (rule.conditions.length > 10) errors.push('At most 10 conditions per rule.');
  rule.conditions.forEach((c, i) => {
    const allowed = (FIELD_OPS as Record<string, CompoundOp[]>)[c.field];
    if (!allowed) {
      errors.push(`Condition ${i + 1}: unknown field "${c.field}".`);
      return;
    }
    if (!allowed.includes(c.op)) {
      errors.push(`Condition ${i + 1}: op "${c.op}" not allowed for field "${c.field}".`);
    }
    if (c.field === 'price_drop_pct' || c.field === 'context_min') {
      if (typeof c.value !== 'number' || !Number.isFinite(c.value) || c.value < 0) {
        errors.push(`Condition ${i + 1}: "${c.field}" needs a non-negative number.`);
      }
      if (c.field === 'price_drop_pct' && typeof c.value === 'number' && c.value > 100) {
        errors.push(`Condition ${i + 1}: price_drop_pct cannot exceed 100.`);
      }
    } else if (typeof c.value !== 'string' || c.value.trim().length === 0) {
      errors.push(`Condition ${i + 1}: "${c.field}" needs a non-empty string.`);
    }
    if (c.field === 'event_type' && typeof c.value === 'string' &&
        !(COMPOUND_EVENT_TYPES as readonly string[]).includes(c.value)) {
      errors.push(`Condition ${i + 1}: unknown event type "${c.value}".`);
    }
  });
  return errors;
}

function eventDropPct(event: ModelEvent): number | null {
  if (event.event_type === 'BECAME_FREE') return 100;
  if (event.event_type === 'PRICE_CHANGE' && typeof event.pct_change === 'number' && event.pct_change < 0) {
    return Math.abs(event.pct_change);
  }
  return null;
}

function eventCategory(event: ModelEvent): string {
  // Category = model family (claude/gpt/llama/…) — the cross-model grouping
  // the spec's example ("my 'coding' category") needs. Capability tags
  // (R3) are matched separately via the same contains semantics.
  return extractModelFamily(event.model_id, event.model_name || event.model_id).toLowerCase();
}

function matchCondition(
  c: CompoundCondition,
  event: ModelEvent,
  snapshots: Map<string, ModelSnapshot>
): { match: boolean; reason: string } {
  const no = (reason: string) => ({ match: false, reason });
  const yes = (reason: string) => ({ match: true, reason });
  switch (c.field) {
    case 'category': {
      const needle = String(c.value).toLowerCase();
      const cat = eventCategory(event);
      const cap = findCapabilityForModel(event.model_id);
      const capHit = cap && Object.entries(cap).some(
        ([k, v]) => v === true && k.toLowerCase().includes(needle)
      );
      if (c.op === 'eq' ? cat === needle || capHit : cat.includes(needle) || capHit) {
        return yes(`category matches "${c.value}"`);
      }
      return no(`category does not match "${c.value}"`);
    }
    case 'price_drop_pct': {
      const drop = eventDropPct(event);
      if (drop === null) return no('not a price-drop event');
      const v = Number(c.value);
      const ok = c.op === 'gte' ? drop >= v : c.op === 'lte' ? drop <= v : drop === v;
      return ok ? yes(`drop ${drop}% ${c.op} ${v}%`) : no(`drop ${drop}% fails ${c.op} ${v}%`);
    }
    case 'context_min': {
      const snap = snapshots.get(event.model_id);
      const ctx = snap?.context_length ?? event.new_value?.context_length ?? null;
      if (typeof ctx !== 'number') return no('no context data');
      return ctx >= Number(c.value)
        ? yes(`context ${ctx.toLocaleString()} ≥ ${Number(c.value).toLocaleString()}`)
        : no(`context ${ctx.toLocaleString()} < ${Number(c.value).toLocaleString()}`);
    }
    case 'provider': {
      const needle = String(c.value).toLowerCase();
      const prov = (event.provider || '').toLowerCase();
      const ok = c.op === 'eq' ? prov === needle : prov.includes(needle);
      return ok ? yes(`provider matches "${c.value}"`) : no(`provider does not match "${c.value}"`);
    }
    case 'event_type': {
      return event.event_type === c.value
        ? yes(`event type is ${c.value}`)
        : no(`event type ${event.event_type} ≠ ${c.value}`);
    }
  }
}

export interface CompoundMatch {
  event: ModelEvent;
  reasons: string[];
}

export function ruleMatchesEvent(
  rule: CompoundRuleInput,
  event: ModelEvent,
  snapshots: Map<string, ModelSnapshot>
): CompoundMatch | null {
  const results = rule.conditions.map((c) => matchCondition(c, event, snapshots));
  const matched = rule.logic === 'and' ? results.every((r) => r.match) : results.some((r) => r.match);
  if (!matched) return null;
  return { event, reasons: results.filter((r) => r.match).map((r) => r.reason) };
}

/** Evaluates saved compound rules against an event batch (ingestion-time shape). */
export function evaluateCompoundRules(
  events: ModelEvent[],
  rules: Array<CompoundRuleInput & { id: number | string }>,
  snapshots: Map<string, ModelSnapshot>
): Array<{ ruleId: number | string; ruleName: string; matches: CompoundMatch[] }> {
  return rules
    .map((rule) => ({
      ruleId: rule.id,
      ruleName: rule.name,
      matches: events
        .map((e) => ruleMatchesEvent(rule, e, snapshots))
        .filter((m): m is CompoundMatch => m !== null),
    }))
    .filter((r) => r.matches.length > 0);
}
