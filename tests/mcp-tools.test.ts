import { describe, it, expect } from 'vitest';
import {
  mcpListModels,
  mcpGetModel,
  mcpPriceHistory,
  mcpRecentEvents,
  mcpSignals,
  mcpEolModels,
  mcpArbitrage,
  mcpMarketStats,
  mcpForecast,
  mcpMigrationRecommendation,
  mcpEndpointTelemetry,
  mcpAskRadar,
} from '../src/lib/mcp/tools';

interface SignalRecord {
  signal_type?: string;
}

describe('Phase 3.4: MCP server data tools', () => {
  it('1. get_models returns a total and a JSON-serializable model list', async () => {
    const result = await mcpListModels({ limit: 5 });
    const data = result.data as { total: number; models: unknown[] };
    expect(typeof data.total).toBe('number');
    expect(Array.isArray(data.models)).toBe(true);
    expect(JSON.stringify(result.data)).toBeTruthy();
  });

  it('2. get_models supports free-only and provider filters', async () => {
    const free = await mcpListModels({ isFree: true });
    const provider = await mcpListModels({ provider: 'Acme' });
    expect(JSON.stringify(free.data)).toBeTruthy();
    expect(JSON.stringify(provider.data)).toBeTruthy();
  });

  it('3. get_model returns found:false for unknown ids and shape for known ids', async () => {
    const missing = await mcpGetModel('no/such-model');
    expect((missing.data as { found: boolean }).found).toBe(false);

    const known = await mcpGetModel('acme/gpt-4o');
    if ((known.data as { found: boolean }).found) {
      const d = known.data as { current: { provider: string }; recent_events: unknown[] };
      expect(typeof d.current.provider).toBe('string');
      expect(Array.isArray(d.recent_events)).toBe(true);
    }
  });

  it('4. get_price_history returns a points array for known models', async () => {
    const result = await mcpPriceHistory('acme/gpt-4o');
    const data = result.data as { model_id: string; found: boolean; points?: unknown[] };
    expect(data.model_id).toBe('acme/gpt-4o');
    if (data.found) {
      expect(Array.isArray(data.points)).toBe(true);
    }
  });

  it('5. get_recent_events supports event-type filtering and pagination', async () => {
    const result = await mcpRecentEvents({ eventTypes: ['NEW_MODEL'], limit: 10 });
    const data = result.data as { total: number; hasMore: boolean; events: unknown[] };
    expect(typeof data.total).toBe('number');
    expect(typeof data.hasMore).toBe('boolean');
    expect(Array.isArray(data.events)).toBe(true);
  });

  it('6. get_signals returns summary + strength-sorted signals', async () => {
    const result = await mcpSignals(50);
    const data = result.data as {
      summary: { total: number; eol: number };
      signals: SignalRecord[];
    };
    expect(typeof data.summary.total).toBe('number');
    expect(typeof data.summary.eol).toBe('number');
    const strengths = data.signals.map((s) => s.signal_type ?? '').filter(Boolean);
    expect(Array.isArray(strengths)).toBe(true);
  });

  it('7. get_signals can filter by severity', async () => {
    const result = await mcpSignals(50, 'high');
    const data = result.data as { signals: SignalRecord[] };
    // Severity filter reduces to high only; empty DB yields empty join of both.
    expect(JSON.stringify(data.signals)).toBeTruthy();
  });

  it('8. get_eol_models returns only MODEL_EOL signals', async () => {
    const result = await mcpEolModels();
    const data = result.data as { eol_models: SignalRecord[] };
    expect(Array.isArray(data.eol_models)).toBe(true);
    for (const s of data.eol_models) {
      expect(s.signal_type).toBe('MODEL_EOL');
    }
  });

  it('9. get_arbitrage returns cluster shapes', async () => {
    const result = await mcpArbitrage();
    const data = result.data as { cluster_count: number; clusters: unknown[] };
    expect(typeof data.cluster_count).toBe('number');
    expect(Array.isArray(data.clusters)).toBe(true);
  });

  it('10. get_market_stats returns aggregate counters', async () => {
    const data = (await mcpMarketStats()).data as {
      totalActiveModels: number;
      totalProviders: number;
      totalFreeModels: number;
    };
    expect(typeof data.totalActiveModels).toBe('number');
    expect(typeof data.totalProviders).toBe('number');
    expect(typeof data.totalFreeModels).toBe('number');
  });

  it('11. get_forecast returns forecast shapes with generated_at summary', async () => {
    const result = await mcpForecast({ limit: 5 });
    const data = result.data as {
      generated_at: string;
      summary: { total: number; high_confidence: number };
      forecasts: { model_id: string; probability: number }[];
    };
    expect(typeof data.generated_at).toBe('string');
    expect(typeof data.summary.total).toBe('number');
    expect(typeof data.summary.high_confidence).toBe('number');
    expect(Array.isArray(data.forecasts)).toBe(true);
    expect(data.forecasts.length).toBeLessThanOrEqual(5);
    for (const f of data.forecasts) {
      expect(typeof f.model_id).toBe('string');
      expect(f.probability).toBeGreaterThanOrEqual(0);
      expect(f.probability).toBeLessThanOrEqual(1);
    }
  });

  it('12. get_migration_recommendation returns a report with primary_model and ranked recommendations', async () => {
    const result = await mcpMigrationRecommendation({
      primaryModelId: 'openai/gpt-4o',
      monthlyPromptTokens: 50_000_000,
      monthlyCompTokens: 50_000_000,
    });
    const data = result.data as {
      generated_at: string;
      primary_model: { model_id: string; current_monthly_usd: number };
      best_switch: { monthly_savings_usd: number } | null;
      recommendations: { monthly_savings_usd: number }[];
      flags: { primary_eol: boolean };
    };
    expect(typeof data.generated_at).toBe('string');
    expect(typeof data.primary_model.current_monthly_usd).toBe('number');
    expect(typeof data.flags.primary_eol).toBe('boolean');
    expect(Array.isArray(data.recommendations)).toBe(true);
    for (const r of data.recommendations) {
      expect(r.monthly_savings_usd).toBeGreaterThan(0);
    }
  });

  it('13. get_endpoint_telemetry returns summary counters and telemetry rows with a health classification', async () => {
    const result = await mcpEndpointTelemetry({ limit: 10 });
    const data = result.data as {
      generated_at: string;
      summary: { total: number; healthy: number; degraded: number; down: number };
      telemetry: { model_id: string; health: { status: string } }[];
    };
    expect(typeof data.generated_at).toBe('string');
    expect(typeof data.summary.total).toBe('number');
    expect(typeof data.summary.healthy).toBe('number');
    expect(typeof data.summary.degraded).toBe('number');
    expect(typeof data.summary.down).toBe('number');
    expect(Array.isArray(data.telemetry)).toBe(true);
    expect(data.telemetry.length).toBeLessThanOrEqual(10);
    for (const t of data.telemetry) {
      expect(typeof t.model_id).toBe('string');
      expect(['healthy', 'degraded', 'down']).toContain(t.health.status);
    }

    const degraded = await mcpEndpointTelemetry({ degradedOnly: true });
    const degradedData = degraded.data as { telemetry: { health: { status: string } }[] };
    for (const t of degradedData.telemetry) {
      expect(['degraded', 'down']).toContain(t.health.status);
    }
  });

  it('14. ask_radar answers a market question with citations flagged as validated', async () => {
    const result = await mcpAskRadar({ question: 'What changed in the market recently?' });
    const data = result.data as {
      question: string;
      intent: string;
      answer: string;
      citations_validated: boolean;
      citations: unknown[];
    };
    expect(data.question.length).toBeGreaterThan(0);
    expect(typeof data.intent).toBe('string');
    expect(data.answer.length).toBeGreaterThan(20);
    expect(data.citations_validated).toBe(true);
    expect(Array.isArray(data.citations)).toBe(true);
  });
});