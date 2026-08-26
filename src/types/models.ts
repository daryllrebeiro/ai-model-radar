export interface OpenRouterPricing {
  prompt: string | number;
  completion: string | number;
  image?: string | number;
  request?: string | number;
}

export interface OpenRouterArchitecture {
  modality?: string;
  tokenizer?: string;
  instruct_type?: string | null;
}

export interface OpenRouterTopProvider {
  context_length?: number;
  max_completion_tokens?: number;
  is_moderated?: boolean;
}

export interface OpenRouterRawModel {
  id: string;
  name: string;
  created?: number;
  description?: string;
  context_length?: number;
  architecture?: OpenRouterArchitecture;
  pricing?: OpenRouterPricing;
  top_provider?: OpenRouterTopProvider;
  per_request_limits?: unknown;
}

export interface ModelSnapshot {
  id?: number;
  model_id: string;
  provider: string;
  name: string;
  price_prompt: number | null;
  price_completion: number | null;
  context_length: number | null;
  modality: string;
  is_free: boolean;
  raw_json: Record<string, any>;
  polled_at: string;
}

export interface ModelCurrent extends ModelSnapshot {
  last_event_at?: string;
  event_count?: number;
}
