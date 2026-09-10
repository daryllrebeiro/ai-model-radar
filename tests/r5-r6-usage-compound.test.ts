import { describe, it, expect } from 'vitest';
import { parseUsageCsv, reconcileUsageImport } from '../src/lib/usage-import';
import {
  validateCompoundRule,
  ruleMatchesEvent,
  evaluateCompoundRules,
} from '../src/lib/compound-rules';
import type { ModelEvent } from '../src/types/events';
import type { ModelSnapshot } from '../src/types/models';

const CSV = `model,prompt_tokens,completion_tokens,cost_usd
openai/gpt-4o,1000000,500000,12.50
openai/gpt-4o,2000000,1000000,25.00
deepseek/deepseek-chat,5000000,2000000,1.26`;

const OPENROUTER_CSV = `model_name,input_tokens,output_tokens,total_cost
anthropic/claude-3-7-sonnet,1000,500,0.02`;

function evt(partial: Partial<ModelEvent>): ModelEvent {
  return {
    id: 1,
    model_id: 'openai/gpt-4o',
    event_type: 'PRICE_CHANGE',
    old_value: null,
    new_value: null,
    pct_change: -20,
    source: 'openrouter',
    detected_at: new Date().toISOString(),
    model_name: 'GPT-4o',
    provider: 'OpenAI',
    ...partial,
  } as ModelEvent;
}

function snap(partial: Partial<ModelSnapshot>): ModelSnapshot {
  return {
    model_id: 'openai/gpt-4o',
    provider: 'OpenAI',
    name: 'GPT-4o',
    price_prompt: 0.0000025,
    price_completion: 0.00001,
    context_length: 128000,
    modality: 'text->text',
    is_free: false,
    raw_json: {},
    polled_at: new Date().toISOString(),
    ...partial,
  } as ModelSnapshot;
}

describe('R5 CSV parsing (upload MVP)', () => {
  it('aggregates duplicate model rows and totals spend', () => {
    const agg = parseUsageCsv(CSV);
    expect(agg.rows).toHaveLength(2);
    const gpt = agg.rows.find((r) => r.model_id === 'openai/gpt-4o')!;
    expect(gpt.prompt_tokens).toBe(3000000);
    expect(gpt.cost_usd).toBeCloseTo(37.5);
    expect(agg.total_spend_usd).toBeCloseTo(38.76);
    expect(agg.cost_estimated).toBe(false);
  });

  it('accepts provider-style headers; missing cost column means estimated', () => {
    const agg = parseUsageCsv(OPENROUTER_CSV);
    expect(agg.rows).toHaveLength(1);
    expect(agg.total_spend_usd).toBeCloseTo(0.02);
    expect(agg.cost_estimated).toBe(false);
    const noCost = parseUsageCsv('model,prompt_tokens,completion_tokens\nx,10,5');
    expect(noCost.cost_estimated).toBe(true);
    expect(noCost.total_spend_usd).toBe(0);
  });

  it('rejects missing headers, negative numbers, oversized uploads', () => {
    expect(() => parseUsageCsv('foo,bar\n1,2')).toThrow(/headers/i);
    expect(() => parseUsageCsv('model,prompt_tokens,completion_tokens\nx,-1,5')).toThrow();
    expect(() => parseUsageCsv('model,prompt_tokens,completion_tokens')).toThrow(/at least one data row/);
    const big = 'model,prompt_tokens,completion_tokens\n' + 'x,1,1\n'.repeat(5001);
    expect(() => parseUsageCsv(big)).toThrow(/upload limit/);
  });

  it('reconciles actuals vs alternatives without touching aggregates', () => {
    const agg = parseUsageCsv(CSV);
    const snapshots = [
      snap({}),
      snap({ model_id: 'deepseek/deepseek-chat', provider: 'DeepSeek', name: 'DeepSeek V3', price_prompt: 0.00000014, price_completion: 0.00000028, context_length: 64000 }),
    ];
    const rep = reconcileUsageImport(agg.rows, snapshots);
    expect(rep.total_actual_usd).toBeCloseTo(38.76);
    const gptRow = rep.rows.find((r) => r.model_id === 'openai/gpt-4o')!;
    expect(gptRow.alt_model_id).toBeTruthy();
    expect(gptRow.savings_usd).toBeGreaterThan(0);
  });
});

describe('R6 compound rules (fixed set, no scripting)', () => {
  it('rejects unknown fields, bad ops, out-of-range numbers', () => {
    expect(validateCompoundRule({ name: '', logic: 'and', conditions: [] })).not.toHaveLength(0);
    expect(
      validateCompoundRule({ name: 'x', logic: 'and', conditions: [{ field: 'price_drop_pct' as any, op: 'eq', value: 10 }] })
    ).toHaveLength(0);
    expect(
      validateCompoundRule({ name: 'x', logic: 'and', conditions: [{ field: 'price_drop_pct', op: 'contains' as any, value: 10 }] })
    ).not.toHaveLength(0);
    expect(
      validateCompoundRule({ name: 'x', logic: 'and', conditions: [{ field: 'price_drop_pct', op: 'gte', value: 150 }] })
    ).not.toHaveLength(0);
    expect(
      validateCompoundRule({ name: 'x', logic: 'and', conditions: [{ field: 'event_type', op: 'eq', value: 'NOPE' }] })
    ).not.toHaveLength(0);
  });

  it('AND/OR semantics: "coding drop >15% with 100k+ context" shape', () => {
    const snapshots = new Map([['openai/gpt-4o', snap({})]]);
    const rule = {
      name: 'big coding drops',
      logic: 'and' as const,
      conditions: [
        { field: 'price_drop_pct' as const, op: 'gte' as const, value: 15 },
        { field: 'context_min' as const, op: 'gte' as const, value: 100000 },
      ],
    };
    expect(ruleMatchesEvent(rule, evt({}), snapshots)).not.toBeNull();
    expect(ruleMatchesEvent(rule, evt({ pct_change: -5 }), snapshots)).toBeNull();
    const orRule = { ...rule, logic: 'or' as const };
    expect(ruleMatchesEvent(orRule, evt({ pct_change: -5 }), snapshots)).not.toBeNull();
  });

  it('BECAME_FREE counts as a 100% drop; unknown context fails context_min', () => {
    const snapshots = new Map<string, ModelSnapshot>();
    const rule = {
      name: 'freebies',
      logic: 'and' as const,
      conditions: [{ field: 'price_drop_pct' as const, op: 'gte' as const, value: 50 }],
    };
    expect(ruleMatchesEvent(rule, evt({ event_type: 'BECAME_FREE', pct_change: null }), snapshots)).not.toBeNull();
    const ctxRule = {
      name: 'ctx',
      logic: 'and' as const,
      conditions: [{ field: 'context_min' as const, op: 'gte' as const, value: 1000 }],
    };
    expect(ruleMatchesEvent(ctxRule, evt({}), snapshots)).toBeNull();
  });

  it('batch evaluation returns only rules with matches', () => {
    const snapshots = new Map([['openai/gpt-4o', snap({})]]);
    const out = evaluateCompoundRules(
      [evt({}), evt({ event_type: 'NEW_MODEL', pct_change: null })],
      [
        { id: 1, name: 'drops', logic: 'and', conditions: [{ field: 'price_drop_pct', op: 'gte', value: 10 }] },
        { id: 2, name: 'nothing', logic: 'and', conditions: [{ field: 'provider', op: 'eq', value: 'Nope' }] },
      ],
      snapshots
    );
    expect(out).toHaveLength(1);
    expect(out[0].ruleId).toBe(1);
  });
});
