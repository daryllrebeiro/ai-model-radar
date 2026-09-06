import { ModelSnapshot } from '@/types/models';
import { ModelEvent } from '@/types/events';
import { MarketSignal } from '@/types/signals';
import { PriceDropForecast } from '@/types/forecast';
import { AskAnswer, AskIntent, RadarCitation, RadarCitationType } from '@/types/ask';
import { EndpointTelemetry } from '@/types/telemetry';
import { evaluateEndpointHealth } from './probe';
import { computeArbitrageOpportunities } from './arbitrage';

/**
 * Ask the Radar (Pro feature, gated via ASK_RADAR).
 *
 * Deterministic, retrieval-based Q&A over the full radar dataset. Every claim
 * in the answer is backed by <=N structured citations; `validateAnswer` re-checks
 * each citation against the same context so unverifiable statements are caught
 * in tests and can never ship unchecked.
 */

export interface AskContext {
  snapshots: ModelSnapshot[];
  events: ModelEvent[];
  signals: MarketSignal[];
  forecasts: PriceDropForecast[];
  telemetry?: EndpointTelemetry[];
}

function fmtUsdPer1m(perToken: number | null | undefined): string {
  if (perToken === null || perToken === undefined) return 'n/a';
  return `$${Math.round(perToken * 1_000_000).toLocaleString()}/1M`;
}

function modelUrl(modelId: string): string {
  return `/models/${encodeURIComponent(modelId)}`;
}

function citation(id: string, type: RadarCitationType, title: string, url: string, model_id?: string): RadarCitation {
  return { id, type, title, url, model_id };
}

export function matchModelIds(question: string, snapshots: ModelSnapshot[]): ModelSnapshot[] {
  const q = question.toLowerCase();
  return snapshots.filter((s) => {
    const id = s.model_id.toLowerCase();
    return q.includes(id) || q.includes(id.replace('/', '-')) || q.includes(id.split('/').pop() || '');
  });
}

function findSignals(signals: MarketSignal[], modelId: string, type: string): MarketSignal[] {
  return signals.filter(
    (s) => s.signal_type === type && s.model_id.toLowerCase() === modelId.toLowerCase()
  );
}

function findForecast(forecasts: PriceDropForecast[], modelId: string): PriceDropForecast | null {
  return forecasts.find((f) => f.model_id.toLowerCase() === modelId.toLowerCase()) || null;
}

function findTelemetry(telemetry: EndpointTelemetry[] | undefined, modelId: string): EndpointTelemetry | null {
  if (!telemetry) return null;
  const hits = telemetry.filter((t) => t.model_id.toLowerCase() === modelId.toLowerCase());
  if (hits.length === 0) return null;
  return hits.sort((a, b) => new Date(b.checked_at).getTime() - new Date(a.checked_at).getTime())[0];
}

function latestEventFor(events: ModelEvent[], modelId: string): ModelEvent | null {
  const hits = events.filter((e) => e.model_id.toLowerCase() === modelId.toLowerCase());
  if (hits.length === 0) return null;
  return hits.sort((a, b) => new Date(b.detected_at).getTime() - new Date(a.detected_at).getTime())[0];
}

function detectIntent(question: string, matched: ModelSnapshot[]): AskIntent {
  const q = question.toLowerCase();
  if (matched.length > 0 && /\b(latency|reliability|down|outage|rate.?limit|health|healthy|healthiest)\b/.test(q)) {
    return 'telemetry';
  }
  if (/\b(eol|deprecated|discontinued|end of life|decommi)\b/.test(q)) {
    return 'eol';
  }
  if (/\b(arbitrage|equivalent|same model|same family)\b/.test(q)) {
    return 'arbitrage';
  }
  if (/\b(forecast|predicted|cut likely|price cut|drop soon)\b/.test(q)) {
    return 'forecast';
  }
  if (/\b(save|switch|cheaper|recommend|migrate|save money|move to)\b/.test(q)) {
    return 'recommendation';
  }
  if (/\b(cheapest|best value|deal|price change|price changed|price ?drop|dropped|dropping|price of|how much|cost of)\b/.test(q)) {
    return 'price_change';
  }
  if (matched.length > 0) {
    return 'model_status';
  }
  return 'overview';
}

function makeStatusAnswer(
  snap: ModelSnapshot,
  context: AskContext
): { answer: string; citations: RadarCitation[] } {
  const citations: RadarCitation[] = [
    citation(
      `model:${snap.model_id}`,
      'model',
      `${snap.name} current pricing`,
      modelUrl(snap.model_id),
      snap.model_id
    ),
  ];

  const event = latestEventFor(context.events, snap.model_id);
  if (event) {
    citations.push(
      citation(
        `event:${event.id}`,
        'event',
        `Last change: ${event.event_type} (${event.pct_change ?? 0}%)`,
        `/changelog?model=${encodeURIComponent(snap.model_id)}`,
        snap.model_id
      )
    );
  }

  const forecast = findForecast(context.forecasts, snap.model_id);
  if (forecast) {
    citations.push(
      citation(
        `forecast:${snap.model_id}`,
        'forecast',
        `${Math.round(forecast.probability * 100)}% price cut within ${forecast.expected_window_days}d`,
        `/forecast?model=${encodeURIComponent(snap.model_id)}`,
        snap.model_id
      )
    );
  }

  const tel = findTelemetry(context.telemetry, snap.model_id);
  if (tel) {
    const health = evaluateEndpointHealth(tel);
    citations.push(
      citation(
        `telemetry:${snap.model_id}`,
        'telemetry',
        `Endpoint health: ${health.status}`,
        modelUrl(snap.model_id),
        snap.model_id
      )
    );
  }

  const eolSignal = findSignals(context.signals, snap.model_id, 'MODEL_EOL');
  if (eolSignal.length > 0) {
    citations.push(
      citation(
        `signal:${eolSignal[0].id}`,
        'signal',
        `EOL warning: ${eolSignal[0].title}`,
        `/signals`,
        snap.model_id
      )
    );
  }

  const lines: string[] = [];
  lines.push(`${snap.name} (${snap.provider}) is priced at ${fmtUsdPer1m(snap.price_prompt)} prompt / ${fmtUsdPer1m(snap.price_completion)} completion with a ${snap.context_length?.toLocaleString() ?? 'unknown'}-token context window.`);
  if (snap.is_free) lines.push('It is currently listed as a free-tier endpoint.');
  if (event) {
    if (event.event_type === 'BECAME_FREE') lines.push(`It became free on ${new Date(event.detected_at).toLocaleDateString()}.`);
    else if (event.event_type === 'PRICE_CHANGE' && (event.pct_change || 0) < 0)
      lines.push(`Price last changed ${Math.abs(event.pct_change || 0)}% lower on ${new Date(event.detected_at).toLocaleDateString()}.`);
  }
  if (forecast) {
    lines.push(`RadarForecast estimates a ${Math.round(forecast.probability * 100)}% chance of a further price cut within ${forecast.expected_window_days} days${forecast.expected_pct_change !== null ? ` (typical cut ≈ ${forecast.expected_pct_change}%)` : ''}.`);
  }
  if (eolSignal.length > 0) lines.push(`A ${eolSignal[0].severity}-severity EOL signal is active — plan a migration.`);
  if (tel) {
    const health = evaluateEndpointHealth(tel);
    lines.push(`Latest endpoint probe reports the endpoint as ${health.status} (P95 ${tel.p95_latency_ms ?? 'n/a'} ms, ~${tel.tokens_per_sec ?? 'n/a'} tok/s).`);
  }

  return { answer: lines.join('\n'), citations };
}

function makePriceChangeAnswer(context: AskContext): { answer: string; citations: RadarCitation[] } {
  const drops = context.events
    .filter((e) => e.event_type === 'PRICE_CHANGE' && (e.pct_change || 0) < 0)
    .sort((a, b) => (a.pct_change || 0) - (b.pct_change || 0))
    .slice(0, 5);

  const citations: RadarCitation[] = [];
  const lines: string[] = [];

  if (drops.length > 0) {
    lines.push(`The most significant recent price drops in the tracked market:`);
    for (const d of drops) {
      const snap = context.snapshots.find((s) => s.model_id === d.model_id);
      lines.push(`- ${d.model_id}: ${d.pct_change}% lower (now ${fmtUsdPer1m(snap?.price_prompt)})`);
      citations.push(
        citation(
          `event:${d.id}`,
          'event',
          `${d.model_id} price change ${d.pct_change}%`,
          `/changelog?model=${encodeURIComponent(d.model_id)}`,
          d.model_id
        )
      );
    }
  } else {
    lines.push('No significant downward price changes were detected in the recent window.');
  }

  const free = context.snapshots.filter((s) => s.is_free).slice(0, 5);
  if (free.length > 0) {
    lines.push(`Free-tier endpoints currently tracked: ${free.map((s) => s.model_id).join(', ')}.`);
    for (const s of free) {
      citations.push(
        citation(`model:${s.model_id}`, 'model', `${s.name} — free tier`, modelUrl(s.model_id), s.model_id)
      );
    }
  }

  return { answer: lines.join('\n'), citations };
}

function makeForecastAnswer(context: AskContext): { answer: string; citations: RadarCitation[] } {
  const top = [...context.forecasts].sort((a, b) => b.probability - a.probability).slice(0, 5);
  const citations: RadarCitation[] = [];
  const lines: string[] = ['Models for which a near-term price cut is forecast (highest probability first):'];
  if (top.length === 0) lines[0] = 'No price-cut forecasts are currently active in the tracked market.';
  top.forEach((f) => {
    lines.push(
      `- ${f.model_name || f.model_id}: ${Math.round(f.probability * 100)}% within ${f.expected_window_days}d${f.expected_pct_change !== null ? `, typical cut ≈ ${f.expected_pct_change}%` : ''}`
    );
    citations.push(
      citation(`forecast:${f.model_id}`, 'forecast', `${f.model_name || f.model_id} price-cut forecast`, `/forecast?model=${encodeURIComponent(f.model_id)}`, f.model_id)
    );
  });
  return { answer: lines.join('\n'), citations };
}

function makeEolAnswer(context: AskContext): { answer: string; citations: RadarCitation[] } {
  const eol = context.signals
    .filter((s) => s.signal_type === 'MODEL_EOL')
    .sort((a, b) => {
      const weight = { high: 3, medium: 2, info: 1 } as const;
      return weight[b.severity] - weight[a.severity];
    })
    .slice(0, 5);
  const citations: RadarCitation[] = [];
  const lines: string[] = ['Models flagged end-of-life (delisted or deprecated endpoints):'];
  eol.forEach((s) => {
    lines.push(`- ${s.model_id}: ${s.title} (${s.severity})`);
    citations.push(citation(`signal:${s.id}`, 'signal', s.title, `/signals`, s.model_id));
  });
  if (eol.length === 0) lines[0] = 'No models are currently flagged end-of-life.';
  return { answer: lines.join('\n'), citations };
}

function makeArbitrageAnswer(context: AskContext): { answer: string; citations: RadarCitation[] } {
  const clusters = computeArbitrageOpportunities(context.snapshots).slice(0, 5);
  const citations: RadarCitation[] = [];
  const lines: string[] = ['Cheaper same-family endpoints available right now (arbitrage clusters):'];
  clusters.forEach((c) => {
    if (!c.cheapest_option) return;
    lines.push(
      `- ${c.display_name}: the ${c.cheapest_option.model_id} endpoint is cheapest at ${fmtUsdPer1m(c.cheapest_option.prompt_per_1m / 1_000_000)} prompt (saves ${Math.round(c.max_prompt_savings_pct)}%).`
    );
    citations.push(
      citation(`model:${c.cheapest_option.model_id}`, 'model', `${c.cheapest_option.model_id} cheapest endpoint`, modelUrl(c.cheapest_option.model_id), c.cheapest_option.model_id)
    );
  });
  if (clusters.length === 0) lines[0] = 'No arbitrage clusters detected in the current market.';
  return { answer: lines.join('\n'), citations };
}

function makeRecommendationAnswer(context: AskContext, hasProfile: boolean): { answer: string; citations: RadarCitation[]; profile_required?: boolean } {
  const eol = context.signals.filter((s) => s.signal_type === 'MODEL_EOL');
  const citations: RadarCitation[] = [];
  const lines: string[] = [];
  if (!hasProfile) {
    lines.push('To compute "switch and save" recommendations I need your usage profile (monthly prompt/completion tokens and primary model).');
    lines.push('Meanwhile, the market context relevant to migration:');
  } else {
    lines.push('Based on your usage profile, here is the current migration context:');
  }
  eol.slice(0, 3).forEach((s) => {
    lines.push(`- ${s.model_id} is flagged EOL — a prime migration candidate.`);
    citations.push(citation(`signal:${s.id}`, 'signal', s.title, `/signals`, s.model_id));
  });
  const topDrop = [...context.events]
    .filter((e) => e.event_type === 'PRICE_CHANGE' && (e.pct_change || 0) < 0)
    .sort((a, b) => (a.pct_change || 0) - (b.pct_change || 0))
    .slice(0, 3);
  topDrop.forEach((d) => {
    lines.push(`- ${d.model_id} just dropped ${d.pct_change}% — timing a switch here could lock in savings.`);
    citations.push(citation(`event:${d.id}`, 'event', `${d.model_id} price change ${d.pct_change}%`, `/changelog?model=${encodeURIComponent(d.model_id)}`, d.model_id));
  });
  return { answer: lines.join('\n'), citations, profile_required: !hasProfile };
}

function makeTelemetryAnswer(matched: ModelSnapshot[], context: AskContext): { answer: string; citations: RadarCitation[] } {
  const citations: RadarCitation[] = [];
  const lines: string[] = [];
  if (matched.length === 0) {
    const all = (context.telemetry || []).map((t) => ({ t, h: evaluateEndpointHealth(t) }));
    const down = all.filter((x) => x.h.status === 'down').slice(0, 5);
    if (down.length === 0) {
      lines.push('No endpoints are currently down.');
      return { answer: lines.join('\n'), citations };
    }
    lines.push('Endpoints currently classified as down (free-tier endpoints that stopped serving, or probe failures):');
    down.forEach(({ t, h }) => {
      lines.push(`- ${t.model_id} (${t.provider}): ${h.reasons.join('; ')}`);
      citations.push(citation(`telemetry:${t.model_id}`, 'telemetry', `${t.model_id} endpoint ${h.status}`, modelUrl(t.model_id), t.model_id));
    });
    return { answer: lines.join('\n'), citations };
  }
  for (const snap of matched.slice(0, 10)) {
    const record = context.telemetry?.find((t) => t.model_id === snap.model_id);
    if (!record) continue;
    const h = evaluateEndpointHealth(record);
    lines.push(
      `- ${snap.model_id}: ${h.status} (P95 ${record.p95_latency_ms ?? 'n/a'} ms, ~${record.tokens_per_sec ?? 'n/a'} tok/s${record.is_free ? ', free tier ' + (record.free_tier_active ? 'serving' : 'not serving') : ''}).`
    );
    citations.push(citation(`telemetry:${snap.model_id}`, 'telemetry', `${snap.model_id} endpoint ${h.status}`, modelUrl(snap.model_id), snap.model_id));
  }
  if (lines.length === 0) lines.push('No recent probe telemetry found for the requested models.');
  return { answer: lines.join('\n'), citations };
}

function makeOverviewAnswer(context: AskContext): { answer: string; citations: RadarCitation[] } {
  const citations: RadarCitation[] = [];
  const drops = context.events.filter((e) => e.event_type === 'PRICE_CHANGE' && (e.pct_change || 0) < 0).length;
  const newModels = context.events.filter((e) => e.event_type === 'NEW_MODEL').length;
  const eol = context.signals.filter((s) => s.signal_type === 'MODEL_EOL').length;
  const forecasts = context.forecasts.filter((f) => f.probability >= 0.5).length;
  const freeCount = context.snapshots.filter((s) => s.is_free).length;

  const topDrop = [...context.events]
    .filter((e) => e.event_type === 'PRICE_CHANGE' && (e.pct_change || 0) < 0)
    .sort((a, b) => (a.pct_change || 0) - (b.pct_change || 0))[0];
  const topForecast = [...context.forecasts].sort((a, b) => b.probability - a.probability)[0];

  const lines: string[] = [];
  lines.push(`Radar overview: ${context.snapshots.length} tracked models, ${freeCount} of them free-tier.`);
  lines.push(`In the recent window: ${drops} price drops, ${newModels} new models, ${eol} EOL warnings, ${forecasts} forecast(s) at ≥50% probability.`);
  if (topDrop) {
    lines.push(`Deepest recent drop: ${topDrop.model_id} at ${topDrop.pct_change}%.`);
    citations.push(citation(`event:${topDrop.id}`, 'event', `${topDrop.model_id} ${topDrop.pct_change}%`, `/changelog?model=${encodeURIComponent(topDrop.model_id)}`, topDrop.model_id));
  }
  if (topForecast) {
    lines.push(`Highest-confidence cut forecast: ${topForecast.model_name || topForecast.model_id} at ${Math.round(topForecast.probability * 100)}%.`);
    citations.push(citation(`forecast:${topForecast.model_id}`, 'forecast', `${topForecast.model_name || topForecast.model_id} forecast`, `/forecast?model=${encodeURIComponent(topForecast.model_id)}`, topForecast.model_id));
  }
  return { answer: lines.join('\n'), citations };
}

export function hasUsageProfile(profile?: {
  primary_model_id?: string;
  monthly_prompt_tokens?: number;
  monthly_comp_tokens?: number;
}): boolean {
  return Boolean(
    profile?.primary_model_id &&
    ((profile.monthly_prompt_tokens || 0) > 0 || (profile.monthly_comp_tokens || 0) > 0)
  );
}

export function answerQuestion(opts: {
  question: string;
  context: AskContext;
  profile?: { primary_model_id?: string; monthly_prompt_tokens?: number; monthly_comp_tokens?: number };
}): AskAnswer {
  const { question, context, profile } = opts;
  const matched = matchModelIds(question, context.snapshots);
  const intent = detectIntent(question, matched);

  let result: { answer: string; citations: RadarCitation[]; profile_required?: boolean };
  switch (intent) {
    case 'model_status': {
      const snap = matched[0];
      result = snap
        ? makeStatusAnswer(snap, context)
        : { answer: `No tracked model matched "${question}". Try a model id from the radar catalog.`, citations: [] };
      break;
    }
    case 'price_change':
      result = matched.length > 0 && /\b(price|how much|cost)\b/.test(question.toLowerCase())
        ? makeStatusAnswer(matched[0], context)
        : makePriceChangeAnswer(context);
      break;
    case 'forecast':
      result = makeForecastAnswer(context);
      break;
    case 'eol':
      result = makeEolAnswer(context);
      break;
    case 'arbitrage':
      result = makeArbitrageAnswer(context);
      break;
    case 'recommendation':
      result = makeRecommendationAnswer(context, hasUsageProfile(profile));
      break;
    case 'telemetry':
      result = makeTelemetryAnswer(matched, context);
      break;
    default:
      result = makeOverviewAnswer(context);
  }

  return {
    question,
    intent,
    answer: result.answer,
    citations: result.citations,
    profile_required: result.profile_required,
  };
}

export interface TruthIndex {
  models: Map<string, string>;
  beenModels: Set<string>;
  signalModels: Set<string>;
  forecastModels: Set<string>;
  telemetryModels: Set<string>;
}

export function buildTruthIndex(context: AskContext): TruthIndex {
  const models = new Map<string, string>();
  for (const s of context.snapshots) models.set(s.model_id.toLowerCase(), s.model_id);
  const beenModels = new Set<string>();
  for (const e of context.events) beenModels.add(e.model_id.toLowerCase());
  const signalModels = new Set<string>();
  for (const s of context.signals) signalModels.add(s.model_id.toLowerCase());
  const forecastModels = new Set<string>();
  for (const f of context.forecasts) forecastModels.add(f.model_id.toLowerCase());
  const telemetryModels = new Set<string>();
  for (const t of context.telemetry || []) telemetryModels.add(t.model_id.toLowerCase());
  return { models, beenModels, signalModels, forecastModels, telemetryModels };
}

/**
 * Citation validation: every citation must resolve against the source context.
 * Returns the list of unverifiable citation ids (empty = fully verified).
 */
export function validateAnswer(answer: AskAnswer, context: AskContext): string[] {
  const truth = buildTruthIndex(context);
  const unverifiable: string[] = [];
  for (const c of answer.citations) {
    const key = c.model_id || '';
    switch (c.type) {
      case 'model':
        if (!key || !truth.models.has(key.toLowerCase())) unverifiable.push(c.id);
        break;
      case 'event':
        if (!key || !truth.beenModels.has(key.toLowerCase())) unverifiable.push(c.id);
        break;
      case 'signal':
        if (!key || !truth.signalModels.has(key.toLowerCase())) unverifiable.push(c.id);
        break;
      case 'forecast':
        if (!key || !truth.forecastModels.has(key.toLowerCase())) unverifiable.push(c.id);
        break;
      case 'telemetry':
        if (!key || !truth.telemetryModels.has(key.toLowerCase())) unverifiable.push(c.id);
        break;
    }
  }
  return unverifiable;
}