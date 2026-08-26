import { ModelSnapshot } from '@/types/models';
import { ModelEvent } from '@/types/events';

export interface DiffInput {
  // Map of model_id -> latest ModelSnapshot in database
  previousSnapshots: Map<string, ModelSnapshot>;
  // Set of all model_ids ever recorded in DB history
  knownModelIds: Set<string>;
  // Current models retrieved from the latest poll
  currentModels: ModelSnapshot[];
  // Timestamp for this detection cycle
  detectedAt?: string;
  source?: string;
}

export interface DiffResult {
  events: ModelEvent[];
  newSnapshots: ModelSnapshot[];
  currentCount: number;
  newModelsCount: number;
  priceChangesCount: number;
  becameFreeCount: number;
  leftFreeCount: number;
  contextChangedCount: number;
  removedModelsCount: number;
  totalEventsEmitted: number;
}

/**
 * Pure diffing engine comparing the previous snapshot state against current polled models
 */
export function computeModelDiffs({
  previousSnapshots,
  knownModelIds,
  currentModels,
  detectedAt = new Date().toISOString(),
  source = 'openrouter',
}: DiffInput): DiffResult {
  const events: ModelEvent[] = [];
  const currentModelIdSet = new Set<string>();

  let newModelsCount = 0;
  let priceChangesCount = 0;
  let becameFreeCount = 0;
  let leftFreeCount = 0;
  let contextChangedCount = 0;
  let removedModelsCount = 0;

  for (const curr of currentModels) {
    const modelId = curr.model_id;
    currentModelIdSet.add(modelId);

    const prev = previousSnapshots.get(modelId);
    const isBrandNew = !knownModelIds.has(modelId);

    if (isBrandNew) {
      // 1. NEW_MODEL event
      events.push({
        model_id: modelId,
        event_type: 'NEW_MODEL',
        old_value: null,
        new_value: {
          name: curr.name,
          provider: curr.provider,
          price_prompt: curr.price_prompt,
          price_completion: curr.price_completion,
          context_length: curr.context_length,
          modality: curr.modality,
          is_free: curr.is_free,
        },
        pct_change: null,
        source,
        detected_at: detectedAt,
        model_name: curr.name,
        provider: curr.provider,
        context_length: curr.context_length,
        modality: curr.modality,
      });
      newModelsCount++;
    } else if (prev) {
      // Compare prices
      const prevPrompt = prev.price_prompt;
      const currPrompt = curr.price_prompt;
      const prevComp = prev.price_completion;
      const currComp = curr.price_completion;

      const prevWasFree = prev.is_free || (prevPrompt === 0 && prevComp === 0);
      const currIsFree = curr.is_free || (currPrompt === 0 && currComp === 0);

      // Price changed?
      const promptChanged = prevPrompt !== currPrompt;
      const compChanged = prevComp !== currComp;
      const priceChanged = promptChanged || compChanged;

      if (priceChanged) {
        if (!prevWasFree && currIsFree) {
          // 4. BECAME_FREE event
          events.push({
            model_id: modelId,
            event_type: 'BECAME_FREE',
            old_value: { price_prompt: prevPrompt, price_completion: prevComp },
            new_value: { price_prompt: currPrompt, price_completion: currComp },
            pct_change: -100.0,
            source,
            detected_at: detectedAt,
            model_name: curr.name,
            provider: curr.provider,
            context_length: curr.context_length,
            modality: curr.modality,
          });
          becameFreeCount++;
        } else if (prevWasFree && !currIsFree) {
          // 5. LEFT_FREE event
          events.push({
            model_id: modelId,
            event_type: 'LEFT_FREE',
            old_value: { price_prompt: prevPrompt, price_completion: prevComp },
            new_value: { price_prompt: currPrompt, price_completion: currComp },
            pct_change: null,
            source,
            detected_at: detectedAt,
            model_name: curr.name,
            provider: curr.provider,
            context_length: curr.context_length,
            modality: curr.modality,
          });
          leftFreeCount++;
        } else {
          // 3. PRICE_CHANGE event
          // Compute % change using weighted/average or prompt price delta
          let pctChange: number | null = null;
          if (prevPrompt !== null && currPrompt !== null && prevPrompt > 0) {
            pctChange = ((currPrompt - prevPrompt) / prevPrompt) * 100;
          } else if (prevComp !== null && currComp !== null && prevComp > 0) {
            pctChange = ((currComp - prevComp) / prevComp) * 100;
          }

          if (pctChange !== null) {
            pctChange = Math.round(pctChange * 100) / 100; // 2 decimal precision
          }

          events.push({
            model_id: modelId,
            event_type: 'PRICE_CHANGE',
            old_value: { price_prompt: prevPrompt, price_completion: prevComp },
            new_value: { price_prompt: currPrompt, price_completion: currComp },
            pct_change: pctChange,
            source,
            detected_at: detectedAt,
            model_name: curr.name,
            provider: curr.provider,
            context_length: curr.context_length,
            modality: curr.modality,
          });
          priceChangesCount++;
        }
      }

      // Context changed?
      if (prev.context_length !== curr.context_length && curr.context_length !== null) {
        // 6. CONTEXT_CHANGED event
        let pctChange: number | null = null;
        if (prev.context_length && prev.context_length > 0 && curr.context_length > 0) {
          pctChange = ((curr.context_length - prev.context_length) / prev.context_length) * 100;
          pctChange = Math.round(pctChange * 100) / 100;
        }

        events.push({
          model_id: modelId,
          event_type: 'CONTEXT_CHANGED',
          old_value: { context_length: prev.context_length },
          new_value: { context_length: curr.context_length },
          pct_change: pctChange,
          source,
          detected_at: detectedAt,
          model_name: curr.name,
          provider: curr.provider,
          context_length: curr.context_length,
          modality: curr.modality,
        });
        contextChangedCount++;
      }
    }
  }

  // 2. MODEL_REMOVED event: models present in previous snapshot, absent in current
  for (const [prevId, prevSnap] of previousSnapshots.entries()) {
    if (!currentModelIdSet.has(prevId)) {
      events.push({
        model_id: prevId,
        event_type: 'MODEL_REMOVED',
        old_value: {
          name: prevSnap.name,
          provider: prevSnap.provider,
          price_prompt: prevSnap.price_prompt,
          price_completion: prevSnap.price_completion,
          context_length: prevSnap.context_length,
        },
        new_value: null,
        pct_change: null,
        source,
        detected_at: detectedAt,
        model_name: prevSnap.name,
        provider: prevSnap.provider,
        context_length: prevSnap.context_length,
        modality: prevSnap.modality,
      });
      removedModelsCount++;
    }
  }

  return {
    events,
    newSnapshots: currentModels,
    currentCount: currentModels.length,
    newModelsCount,
    priceChangesCount,
    becameFreeCount,
    leftFreeCount,
    contextChangedCount,
    removedModelsCount,
    totalEventsEmitted: events.length,
  };
}
