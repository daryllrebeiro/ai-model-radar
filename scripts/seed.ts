import { insertSnapshots, insertEvents } from '../src/lib/db/queries';
import { ModelSnapshot } from '../src/types/models';
import { ModelEvent } from '../src/types/events';

async function seedRealisticData() {
  console.log('🌱 [AI Model Radar] Generating 30 days of realistic AI market history...');

  const now = Date.now();
  const DAY = 24 * 60 * 60 * 1000;

  const snapshots: ModelSnapshot[] = [];
  const events: ModelEvent[] = [];

  interface SeedModelDef {
    id: string;
    provider: string;
    name: string;
    basePrompt: number;
    baseComp: number;
    context: number;
    modality: string;
    history: Array<{
      daysAgo: number;
      prompt: number;
      comp: number;
      context?: number;
      event?: {
        type: ModelEvent['event_type'];
        pct_change?: number;
      };
    }>;
  }

  const modelDefinitions: SeedModelDef[] = [
    {
      id: 'deepseek/deepseek-chat',
      provider: 'DeepSeek',
      name: 'DeepSeek V3',
      basePrompt: 0.00000014, // $0.14 / 1M
      baseComp: 0.00000028,   // $0.28 / 1M
      context: 64000,
      modality: 'text->text',
      history: [
        { daysAgo: 28, prompt: 0.00000027, comp: 0.00000055, event: { type: 'NEW_MODEL' } },
        { daysAgo: 14, prompt: 0.00000020, comp: 0.00000040, event: { type: 'PRICE_CHANGE', pct_change: -25.9 } },
        { daysAgo: 3, prompt: 0.00000014, comp: 0.00000028, event: { type: 'PRICE_CHANGE', pct_change: -30.0 } },
      ],
    },
    {
      id: 'deepseek/deepseek-r1',
      provider: 'DeepSeek',
      name: 'DeepSeek R1',
      basePrompt: 0.00000055, // $0.55 / 1M
      baseComp: 0.00000219,   // $2.19 / 1M
      context: 128000,
      modality: 'text->text',
      history: [
        { daysAgo: 25, prompt: 0.00000085, comp: 0.00000320, event: { type: 'NEW_MODEL' } },
        { daysAgo: 8, prompt: 0.00000055, comp: 0.00000219, event: { type: 'PRICE_CHANGE', pct_change: -35.2 } },
      ],
    },
    {
      id: 'anthropic/claude-3-7-sonnet',
      provider: 'Anthropic',
      name: 'Claude 3.7 Sonnet',
      basePrompt: 0.000003, // $3.00 / 1M
      baseComp: 0.000015,   // $15.00 / 1M
      context: 200000,
      modality: 'text+image->text',
      history: [
        { daysAgo: 5, prompt: 0.000003, comp: 0.000015, context: 200000, event: { type: 'NEW_MODEL' } },
      ],
    },
    {
      id: 'anthropic/claude-3-5-haiku',
      provider: 'Anthropic',
      name: 'Claude 3.5 Haiku',
      basePrompt: 0.0000008, // $0.80 / 1M
      baseComp: 0.000004,    // $4.00 / 1M
      context: 200000,
      modality: 'text+image->text',
      history: [
        { daysAgo: 29, prompt: 0.000001, comp: 0.000005, event: { type: 'NEW_MODEL' } },
        { daysAgo: 12, prompt: 0.0000008, comp: 0.000004, event: { type: 'PRICE_CHANGE', pct_change: -20.0 } },
      ],
    },
    {
      id: 'openai/gpt-4o',
      provider: 'OpenAI',
      name: 'GPT-4o',
      basePrompt: 0.0000025, // $2.50 / 1M
      baseComp: 0.000010,    // $10.00 / 1M
      context: 128000,
      modality: 'text+image->text',
      history: [
        { daysAgo: 30, prompt: 0.000005, comp: 0.000015, event: { type: 'NEW_MODEL' } },
        { daysAgo: 16, prompt: 0.0000025, comp: 0.000010, event: { type: 'PRICE_CHANGE', pct_change: -50.0 } },
      ],
    },
    {
      id: 'openai/gpt-4o-mini',
      provider: 'OpenAI',
      name: 'GPT-4o Mini',
      basePrompt: 0.00000015, // $0.15 / 1M
      baseComp: 0.00000060,   // $0.60 / 1M
      context: 128000,
      modality: 'text+image->text',
      history: [
        { daysAgo: 29, prompt: 0.00000015, comp: 0.00000060, event: { type: 'NEW_MODEL' } },
      ],
    },
    {
      id: 'google/gemini-2.0-flash-001',
      provider: 'Google',
      name: 'Gemini 2.0 Flash',
      basePrompt: 0.0000001, // $0.10 / 1M
      baseComp: 0.0000004,   // $0.40 / 1M
      context: 1048576,      // 1M context
      modality: 'text+image+audio->text',
      history: [
        { daysAgo: 20, prompt: 0.00000015, comp: 0.0000006, context: 500000, event: { type: 'NEW_MODEL' } },
        { daysAgo: 10, prompt: 0.0000001, comp: 0.0000004, context: 1048576, event: { type: 'CONTEXT_CHANGED', pct_change: 109.7 } },
      ],
    },
    {
      id: 'meta-llama/llama-3.3-70b-instruct:free',
      provider: 'Meta',
      name: 'Llama 3.3 70B (Free Tier)',
      basePrompt: 0,
      baseComp: 0,
      context: 131072,
      modality: 'text->text',
      history: [
        { daysAgo: 22, prompt: 0.0000007, comp: 0.0000008, event: { type: 'NEW_MODEL' } },
        { daysAgo: 7, prompt: 0, comp: 0, event: { type: 'BECAME_FREE', pct_change: -100.0 } },
      ],
    },
    {
      id: 'meta-llama/llama-3.1-8b-instruct:free',
      provider: 'Meta',
      name: 'Llama 3.1 8B (Free Tier)',
      basePrompt: 0,
      baseComp: 0,
      context: 131072,
      modality: 'text->text',
      history: [
        { daysAgo: 28, prompt: 0, comp: 0, event: { type: 'NEW_MODEL' } },
      ],
    },
    {
      id: 'mistralai/mistral-large-2411',
      provider: 'Mistral',
      name: 'Mistral Large 2',
      basePrompt: 0.000002, // $2.00 / 1M
      baseComp: 0.000006,   // $6.00 / 1M
      context: 128000,
      modality: 'text->text',
      history: [
        { daysAgo: 27, prompt: 0.000003, comp: 0.000009, context: 32000, event: { type: 'NEW_MODEL' } },
        { daysAgo: 15, prompt: 0.000002, comp: 0.000006, context: 128000, event: { type: 'CONTEXT_CHANGED', pct_change: 300 } },
        { daysAgo: 4, prompt: 0.000002, comp: 0.000006, event: { type: 'PRICE_CHANGE', pct_change: -33.3 } },
      ],
    },
    {
      id: 'qwen/qwen-2.5-72b-instruct',
      provider: 'Qwen / Alibaba',
      name: 'Qwen 2.5 72B',
      basePrompt: 0.00000035, // $0.35 / 1M
      baseComp: 0.00000040,   // $0.40 / 1M
      context: 131072,
      modality: 'text->text',
      history: [
        { daysAgo: 26, prompt: 0.0000009, comp: 0.0000009, event: { type: 'NEW_MODEL' } },
        { daysAgo: 6, prompt: 0.00000035, comp: 0.00000040, event: { type: 'PRICE_CHANGE', pct_change: -61.1 } },
      ],
    },
    {
      id: 'google/gemini-2.0-flash-exp:free',
      provider: 'Google',
      name: 'Gemini 2.0 Flash Exp (Free)',
      basePrompt: 0,
      baseComp: 0,
      context: 1048576,
      modality: 'text+image+audio->text',
      history: [
        { daysAgo: 24, prompt: 0, comp: 0, event: { type: 'NEW_MODEL' } },
      ],
    },
    {
      id: 'x-ai/grok-2',
      provider: 'xAI',
      name: 'Grok 2',
      basePrompt: 0.000002,
      baseComp: 0.000010,
      context: 131072,
      modality: 'text+image->text',
      history: [
        { daysAgo: 18, prompt: 0.000002, comp: 0.000010, event: { type: 'NEW_MODEL' } },
      ],
    },
    {
      id: 'nousresearch/hermes-3-llama-3.1-405b',
      provider: 'Nous Research',
      name: 'Hermes 3 405B',
      basePrompt: 0.000002,
      baseComp: 0.000003,
      context: 131072,
      modality: 'text->text',
      history: [
        { daysAgo: 21, prompt: 0.000004, comp: 0.000005, event: { type: 'NEW_MODEL' } },
        { daysAgo: 2, prompt: 0.000002, comp: 0.000003, event: { type: 'PRICE_CHANGE', pct_change: -50.0 } },
      ],
    }
  ];

  for (const def of modelDefinitions) {
    let lastPrompt = def.basePrompt;
    let lastComp = def.baseComp;
    let lastContext = def.context;

    // Create snapshots across time
    for (let i = 0; i < def.history.length; i++) {
      const step = def.history[i];
      const stepTime = new Date(now - step.daysAgo * DAY).toISOString();
      const isFree = step.prompt === 0 && step.comp === 0;

      const snap: ModelSnapshot = {
        model_id: def.id,
        provider: def.provider,
        name: def.name,
        price_prompt: step.prompt,
        price_completion: step.comp,
        context_length: step.context || def.context,
        modality: def.modality,
        is_free: isFree,
        raw_json: { id: def.id, name: def.name, provider: def.provider },
        polled_at: stepTime,
      };
      snapshots.push(snap);

      if (step.event) {
        let oldValue: Record<string, any> | null = null;
        if (step.event.type !== 'NEW_MODEL') {
          oldValue = {
            price_prompt: lastPrompt,
            price_completion: lastComp,
            context_length: lastContext,
          };
        }

        const newValue: Record<string, any> = {
          price_prompt: step.prompt,
          price_completion: step.comp,
          context_length: step.context || def.context,
          is_free: isFree,
        };

        events.push({
          model_id: def.id,
          event_type: step.event.type,
          old_value: oldValue,
          new_value: newValue,
          pct_change: step.event.pct_change || null,
          source: 'openrouter',
          detected_at: stepTime,
          model_name: def.name,
          provider: def.provider,
          context_length: step.context || def.context,
          modality: def.modality,
        });
      }

      lastPrompt = step.prompt;
      lastComp = step.comp;
      if (step.context) lastContext = step.context;
    }
  }

  // Insert current live snapshots for today
  for (const def of modelDefinitions) {
    const snap: ModelSnapshot = {
      model_id: def.id,
      provider: def.provider,
      name: def.name,
      price_prompt: def.basePrompt,
      price_completion: def.baseComp,
      context_length: def.context,
      modality: def.modality,
      is_free: def.basePrompt === 0 && def.baseComp === 0,
      raw_json: { id: def.id, name: def.name, provider: def.provider },
      polled_at: new Date(now).toISOString(),
    };
    snapshots.push(snap);
  }

  await insertSnapshots(snapshots);
  await insertEvents(events);

  console.log(`✅ [Seed Completed] Created ${snapshots.length} historical snapshots and ${events.length} market events.`);
}

seedRealisticData().catch((err) => {
  console.error('[Seed Error]:', err);
  process.exit(1);
});
