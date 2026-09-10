// R1 thin API client — reads the existing public API only. No new backend.
// Base URL is user-configurable via storage; defaults to the deployed radar.
const DEFAULT_BASE = 'https://ai-model-radar.example';

async function getBase() {
  try {
    const { radarBase } = await chrome.storage.local.get('radarBase');
    return (radarBase || DEFAULT_BASE).replace(/\/$/, '');
  } catch {
    return DEFAULT_BASE;
  }
}

// Returns { price_prompt, price_completion, context_length, modality } or null.
export async function fetchModelSnapshot(modelId) {
  const base = await getBase();
  const res = await fetch(`${base}/api/v1/models/${encodeURIComponent(modelId)}`, {
    headers: { Accept: 'application/json' },
  });
  if (!res.ok) return null;
  const body = await res.json();
  return body?.data ?? body?.current ?? null;
}

export async function getComparatorUrl(modelIds) {
  const base = await getBase();
  return `${base}/compare?models=${encodeURIComponent(modelIds.join(','))}&utm_source=browser-ext`;
}
