#!/usr/bin/env node
/**
 * AI Model Radar — Model Context Protocol (MCP) server (stdio transport).
 *
 * Exposes the live radar database to MCP clients (Claude Desktop, Cursor, opencode
 * MCP support, etc.) as queryable tools plus a `model://{model_id}` resource template.
 *
 * TRUST BOUNDARY: stdio only, local-trust. This server enforces no caller
 * identity — tool arguments such as governance `email` are convenience
 * filters, not access controls. Anyone who can launch this process can
 * already read DATABASE_URL from the environment, so there is no privilege
 * boundary to bypass here. NEVER expose these tools over a network transport
 * (SSE/HTTP); a remote caller would inherit full database read access with
 * no authentication. If a network transport is ever added, bind every tool
 * to an authenticated session exactly like its REST counterpart.
 *
 * Run with:  npm run mcp:serve  (or: npx tsx scripts/mcp-server.ts)
 * Client config example:
 *   "mcpServers": {
 *     "ai-model-radar": { "command": "npx", "args": ["tsx", "scripts/mcp-server.ts"] }
 *   }
 */
import { McpServer, ResourceTemplate } from '@modelcontextprotocol/sdk/server/mcp.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import { z } from 'zod';
import {
  mcpArbitrage,
  mcpAskRadar,
  mcpEndpointTelemetry,
  mcpEolModels,
  mcpForecast,
  mcpGetModel,
  mcpGovernanceStatus,
  mcpListModels,
  mcpMarketStats,
  mcpMigrationRecommendation,
  mcpPriceHistory,
  mcpRecentEvents,
  mcpSignals,
} from '../src/lib/mcp/tools';

const textContent = (data: unknown) => ({
  content: [{ type: 'text' as const, text: JSON.stringify(data, null, 2) }],
});

function buildServer(): McpServer {
  const server = new McpServer({
    name: 'ai-model-radar',
    version: '1.0.0',
  });

  server.tool(
    'get_models',
    'Current AI model catalog: live prices in USD per 1M tokens, provider, context length, and free-tier status.',
    {
      provider: z.string().optional().describe('Filter by provider name, e.g. "Anthropic".'),
      isFree: z.boolean().optional().describe('Return only free (zero-cost) endpoints.'),
      search: z.string().optional().describe('Case-insensitive match on model name, model id, or provider.'),
      limit: z.number().int().min(1).max(500).optional().describe('Maximum number of models to return (default 50).'),
    },
    async ({ provider, isFree, search, limit }) => textContent((await mcpListModels({ provider, isFree, search, limit })).data)
  );

  server.tool(
    'get_model',
    'Full detail for a single model: current price, specs, recent price-history snapshots, and changelog events.',
    {
      modelId: z.string().describe('Model id, e.g. "anthropic/claude-3-7-sonnet" or "openai/gpt-4o".'),
      historyLimit: z.number().int().min(1).max(500).optional().describe('Max price-history points (default 50).'),
    },
    async ({ modelId, historyLimit }) => textContent((await mcpGetModel(modelId, historyLimit)).data)
  );

  server.tool(
    'get_price_history',
    'Time series of price snapshots for a model (prompt/completion in USD per 1M tokens, context length, free status).',
    {
      modelId: z.string().describe('Model id, e.g. "deepseek/deepseek-chat".'),
      limit: z.number().int().min(1).max(1000).optional().describe('Maximum number of points (default 100).'),
    },
    async ({ modelId, limit }) => textContent((await mcpPriceHistory(modelId, limit)).data)
  );

  server.tool(
    'get_recent_events',
    'Changelog events: new model releases, price drops (PRICE_CHANGE), free-tier flips, context-length changes, and delisting.',
    {
      eventTypes: z.array(z.string()).optional().describe('Filter event types, e.g. ["PRICE_CHANGE", "NEW_MODEL"].'),
      provider: z.string().optional().describe('Filter by provider.'),
      search: z.string().optional().describe('Case-insensitive match on model id/name.'),
      limit: z.number().int().min(1).max(500).optional().describe('Maximum number of events (default 50).'),
    },
    async ({ eventTypes, provider, search, limit }) => textContent((await mcpRecentEvents({ eventTypes, provider, search, limit })).data)
  );

  server.tool(
    'get_signals',
    'Statistical market signals incl. MODEL_EOL (end of life), price anomalies, price wars, and context breakthroughs, sorted by strength.',
    {
      severity: z.enum(['high', 'medium', 'info']).optional().describe('Filter by severity.'),
      limit: z.number().int().min(1).max(100).optional().describe('Maximum number of signals (default 20).'),
    },
    async ({ severity, limit }) => textContent((await mcpSignals(limit, severity)).data)
  );

  server.tool(
    'get_eol_models',
    'End Of Life (MODEL_EOL) signals: models delisted from the catalog that have not returned — migration targets.',
    {
      limit: z.number().int().min(1).max(100).optional().describe('Maximum number of EOL models (default 50).'),
    },
    async ({ limit }) => textContent((await mcpEolModels(limit)).data)
  );

  server.tool(
    'get_arbitrage',
    'Cross-provider price arbitrage clusters: same model family priced differently per endpoint, with savings percentages.',
    {
      limit: z.number().int().min(1).max(200).optional().describe('Maximum number of clusters (default 25).'),
    },
    async ({ limit }) => textContent((await mcpArbitrage(limit)).data)
  );

  server.tool(
    'get_market_stats',
    'Aggregate market snapshot: total active models, providers, free models, and recent price-drop/new-model counts.',
    {},
    async () => textContent((await mcpMarketStats()).data)
  );

  server.tool(
    'get_forecast',
    'RadarForecast: statistically predicted price cuts per model — probability, expected window in days, typical cut magnitude, and supporting evidence.',
    {
      minProbability: z.number().min(0).max(1).optional().describe('Only return forecasts at or above this probability (default 0.35).'),
      limit: z.number().int().min(1).max(50).optional().describe('Maximum number of forecasts (default 15).'),
    },
    async ({ minProbability, limit }) => textContent((await mcpForecast({ limit, minProbability })).data)
  );

  server.tool(
    'get_migration_recommendation',
    'Usage-aware "switch and save $N/mo" recommendations: given your monthly token volumes and primary model, returns ranked cheaper alternatives with EOL/forecast risk factors.',
    {
      primaryModelId: z.string().describe('The model id you currently use most, e.g. anthropic/claude-3-7-sonnet.'),
      monthlyPromptTokens: z.number().nonnegative().describe('Monthly prompt (input) tokens across your whole workload.'),
      monthlyCompTokens: z.number().nonnegative().describe('Monthly completion (output) tokens across your whole workload.'),
      cacheHitRatio: z.number().min(0).max(1).optional().describe('Fraction of prompt tokens served from provider prompt cache (default 0).'),
      batchDiscount: z.number().min(0).max(1).optional().describe('Batch API discount fraction, e.g. 0.5 = 50% off (default 0).'),
    },
    async (args) => textContent((await mcpMigrationRecommendation(args)).data)
  );

  server.tool(
    'get_endpoint_telemetry',
    'Live endpoint intelligence: P95 latency, estimated tokens/sec, 429 rate-limiting and free-tier availability per tracked endpoint, with a healthy/degraded/down classification.',
    {
      modelId: z.string().optional().describe('Only return telemetry for this model id.'),
      provider: z.string().optional().describe('Filter by provider.'),
      degradedOnly: z.boolean().optional().describe('Only return degraded or down endpoints.'),
      limit: z.number().int().min(1).max(200).optional().describe('Maximum number of records (default 50).'),
    },
    async ({ modelId, provider, degradedOnly, limit }) => textContent((await mcpEndpointTelemetry({ modelId, provider, limit, degradedOnly })).data)
  );

  server.tool(
    'get_budget_status',
    'Budget governance: per-rule projected monthly spend vs budget (ok/approaching/over), "shadow AI" spend on untracked endpoints, and pending migration-switch approvals.',
    {
      email: z.string().email().optional().describe('Restrict to rules owned by or scoped to this user (default: all rules).'),
      limit: z.number().int().min(1).max(100).optional().describe('Max families/findings (default 20).'),
    },
    async (args) => textContent((await mcpGovernanceStatus(args)).data)
  );

  server.tool(
    'ask_radar',
    'Ask the Radar: conversational Q&A over the full radar dataset — snapshots, changelog events, signals, forecasts and live endpoint telemetry. Deterministic retrieval with citations that resolve back to the cited records. Optionally pass a usage profile for "how can I save money / what should I switch to" questions.',
    {
      question: z.string().min(3).describe('Natural-language question, e.g. "which models are due for a price cut?" or "is openai/gpt-4o healthy right now?".'),
      primaryModelId: z.string().optional().describe('Your primary model id, for migration/savings questions.'),
      monthlyPromptTokens: z.number().nonnegative().optional().describe('Your monthly prompt tokens, for migration/savings questions.'),
      monthlyCompTokens: z.number().nonnegative().optional().describe('Your monthly completion tokens, for migration/savings questions.'),
    },
    async (args) => textContent((await mcpAskRadar({
      question: args.question,
      primary_model_id: args.primaryModelId,
      monthly_prompt_tokens: args.monthlyPromptTokens,
      monthly_comp_tokens: args.monthlyCompTokens,
    })).data)
  );

  server.registerResource(
    'radar-model',
    new ResourceTemplate('model://{+modelId}', {
      list: async () => {
        const list = await mcpListModels({ limit: 500 });
        const models = (list.data as { models: { model_id: string }[] }).models;
        return {
          resources: models.map((m) => ({
            uri: `model://${m.model_id}`,
            name: m.model_id,
            mimeType: 'application/json',
            description: 'Live radar detail and changelog for the model.',
          })),
        };
      },
    }),
    {
      title: 'AI model detail',
      description: 'Current price, specs, snapshot history and changelog events for a tracked model.',
      mimeType: 'application/json',
    },
    async (uri, variables) => {
      const modelId = String(variables.modelId);
      return {
        contents: [
          {
            uri: uri.href,
            mimeType: 'application/json',
            text: JSON.stringify((await mcpGetModel(modelId)).data, null, 2),
          },
        ],
      };
    }
  );

  return server;
}

async function main(): Promise<void> {
  const server = buildServer();
  const transport = new StdioServerTransport();
  await server.connect(transport);
}

main().catch((err) => {
  console.error('MCP server failed:', err);
  process.exit(1);
});