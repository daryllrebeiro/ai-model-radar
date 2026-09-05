#!/usr/bin/env node
/**
 * AI Model Radar — Model Context Protocol (MCP) server (stdio transport).
 *
 * Exposes the live radar database to MCP clients (Claude Desktop, Cursor, opencode
 * MCP support, etc.) as queryable tools plus a `model://{model_id}` resource template.
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
  mcpEolModels,
  mcpGetModel,
  mcpListModels,
  mcpMarketStats,
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