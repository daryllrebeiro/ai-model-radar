import { describe, it, expect } from 'vitest';
import { computeModelDiffs } from '../src/lib/ingestion/diff';
import { ModelSnapshot } from '../src/types/models';

describe('AI Model Radar - Pure Diffing Engine', () => {
  const createSnapshot = (overrides: Partial<ModelSnapshot>): ModelSnapshot => ({
    model_id: 'openai/gpt-4o',
    provider: 'OpenAI',
    name: 'GPT-4o',
    price_prompt: 0.000005,
    price_completion: 0.000015,
    context_length: 128000,
    modality: 'text+image->text',
    is_free: false,
    raw_json: {},
    polled_at: new Date().toISOString(),
    ...overrides,
  });

  it('1. Emits NEW_MODEL event when a model is seen for the very first time', () => {
    const newModel = createSnapshot({ model_id: 'anthropic/claude-3-7-sonnet', name: 'Claude 3.7 Sonnet' });
    const diff = computeModelDiffs({
      previousSnapshots: new Map(),
      knownModelIds: new Set(),
      currentModels: [newModel],
    });

    expect(diff.events).toHaveLength(1);
    expect(diff.events[0].event_type).toBe('NEW_MODEL');
    expect(diff.events[0].model_id).toBe('anthropic/claude-3-7-sonnet');
    expect(diff.newModelsCount).toBe(1);
  });

  it('2. Emits MODEL_REMOVED when a model disappears from the current snapshot', () => {
    const prev = createSnapshot({ model_id: 'meta/llama-2-70b' });
    const previousSnapshots = new Map([[prev.model_id, prev]]);
    const knownModelIds = new Set([prev.model_id]);

    const diff = computeModelDiffs({
      previousSnapshots,
      knownModelIds,
      currentModels: [], // Empty poll
    });

    expect(diff.events).toHaveLength(1);
    expect(diff.events[0].event_type).toBe('MODEL_REMOVED');
    expect(diff.events[0].model_id).toBe('meta/llama-2-70b');
    expect(diff.removedModelsCount).toBe(1);
  });

  it('3. Emits PRICE_CHANGE with accurate negative percentage when price drops', () => {
    const prev = createSnapshot({
      model_id: 'deepseek/deepseek-v3',
      price_prompt: 0.000001,
      price_completion: 0.000002,
    });
    const curr = createSnapshot({
      model_id: 'deepseek/deepseek-v3',
      price_prompt: 0.0000005, // 50% drop
      price_completion: 0.000001, // 50% drop
    });

    const previousSnapshots = new Map([[prev.model_id, prev]]);
    const knownModelIds = new Set([prev.model_id]);

    const diff = computeModelDiffs({
      previousSnapshots,
      knownModelIds,
      currentModels: [curr],
    });

    expect(diff.events).toHaveLength(1);
    expect(diff.events[0].event_type).toBe('PRICE_CHANGE');
    expect(diff.events[0].pct_change).toBe(-50);
    expect(diff.priceChangesCount).toBe(1);
  });

  it('4. Emits BECAME_FREE when price drops to 0', () => {
    const prev = createSnapshot({
      model_id: 'meta/llama-3.3-70b',
      price_prompt: 0.0000007,
      price_completion: 0.0000008,
      is_free: false,
    });
    const curr = createSnapshot({
      model_id: 'meta/llama-3.3-70b',
      price_prompt: 0,
      price_completion: 0,
      is_free: true,
    });

    const previousSnapshots = new Map([[prev.model_id, prev]]);
    const knownModelIds = new Set([prev.model_id]);

    const diff = computeModelDiffs({
      previousSnapshots,
      knownModelIds,
      currentModels: [curr],
    });

    expect(diff.events).toHaveLength(1);
    expect(diff.events[0].event_type).toBe('BECAME_FREE');
    expect(diff.becameFreeCount).toBe(1);
  });

  it('5. Emits LEFT_FREE when a previously free model becomes paid', () => {
    const prev = createSnapshot({
      model_id: 'google/gemini-2.0-flash-exp:free',
      price_prompt: 0,
      price_completion: 0,
      is_free: true,
    });
    const curr = createSnapshot({
      model_id: 'google/gemini-2.0-flash-exp:free',
      price_prompt: 0.0000001,
      price_completion: 0.0000004,
      is_free: false,
    });

    const previousSnapshots = new Map([[prev.model_id, prev]]);
    const knownModelIds = new Set([prev.model_id]);

    const diff = computeModelDiffs({
      previousSnapshots,
      knownModelIds,
      currentModels: [curr],
    });

    expect(diff.events).toHaveLength(1);
    expect(diff.events[0].event_type).toBe('LEFT_FREE');
    expect(diff.leftFreeCount).toBe(1);
  });

  it('6. Emits CONTEXT_CHANGED when context length expands or changes', () => {
    const prev = createSnapshot({
      model_id: 'mistral/mistral-large',
      context_length: 32000,
    });
    const curr = createSnapshot({
      model_id: 'mistral/mistral-large',
      context_length: 128000,
    });

    const previousSnapshots = new Map([[prev.model_id, prev]]);
    const knownModelIds = new Set([prev.model_id]);

    const diff = computeModelDiffs({
      previousSnapshots,
      knownModelIds,
      currentModels: [curr],
    });

    expect(diff.events).toHaveLength(1);
    expect(diff.events[0].event_type).toBe('CONTEXT_CHANGED');
    expect(diff.events[0].pct_change).toBe(300); // 32k -> 128k = +300%
    expect(diff.contextChangedCount).toBe(1);
  });

  it('7. Emits no events when nothing has changed', () => {
    const model = createSnapshot({ model_id: 'openai/gpt-4o' });
    const previousSnapshots = new Map([[model.model_id, model]]);
    const knownModelIds = new Set([model.model_id]);

    const diff = computeModelDiffs({
      previousSnapshots,
      knownModelIds,
      currentModels: [model],
    });

    expect(diff.events).toHaveLength(0);
    expect(diff.totalEventsEmitted).toBe(0);
  });
});
