#!/usr/bin/env node

import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';

export interface CliConfig {
  apiKey?: string;
  endpoint?: string;
  watchlist?: string[];
}

const CONFIG_DIR = path.join(os.homedir(), '.model-radar');
const CONFIG_PATH = path.join(CONFIG_DIR, 'config.json');

export function loadCliConfig(): CliConfig {
  try {
    if (fs.existsSync(CONFIG_PATH)) {
      const raw = fs.readFileSync(CONFIG_PATH, 'utf-8');
      return JSON.parse(raw);
    }
  } catch {
    // ignore read error
  }
  return {};
}

export function saveCliConfig(config: CliConfig): void {
  try {
    if (!fs.existsSync(CONFIG_DIR)) {
      fs.mkdirSync(CONFIG_DIR, { recursive: true });
    }
    fs.writeFileSync(CONFIG_PATH, JSON.stringify(config, null, 2), 'utf-8');
  } catch (err) {
    console.error('Failed to save CLI config:', err);
  }
}

export function resolveApiKey(flags: Record<string, string>): string | undefined {
  return (
    flags['api-key'] ||
    flags['apiKey'] ||
    process.env.AMR_API_KEY ||
    process.env.MODEL_RADAR_KEY ||
    loadCliConfig().apiKey
  );
}

export function resolveEndpoint(flags: Record<string, string>): string {
  return (
    flags['endpoint'] ||
    process.env.AMR_ENDPOINT ||
    loadCliConfig().endpoint ||
    'https://ai-model-radar.com'
  ).replace(/\/$/, '');
}

export function parseArgs(args: string[]): {
  command: string;
  positionals: string[];
  flags: Record<string, string>;
  isJson: boolean;
} {
  const flags: Record<string, string> = {};
  const positionals: string[] = [];
  let isJson = false;

  for (let i = 0; i < args.length; i++) {
    const arg = args[i];
    if (arg === '--json' || arg === '-j') {
      isJson = true;
      flags['json'] = 'true';
    } else if (arg.startsWith('--')) {
      const key = arg.slice(2);
      if (key.includes('=')) {
        const [k, v] = key.split('=');
        flags[k] = v;
      } else if (i + 1 < args.length && !args[i + 1].startsWith('-')) {
        flags[key] = args[++i];
      } else {
        flags[key] = 'true';
      }
    } else if (arg.startsWith('-')) {
      const key = arg.slice(1);
      if (i + 1 < args.length && !args[i + 1].startsWith('-')) {
        flags[key] = args[++i];
      } else {
        flags[key] = 'true';
      }
    } else {
      positionals.push(arg);
    }
  }

  const command = positionals[0] || 'help';
  return {
    command,
    positionals: positionals.slice(1),
    flags,
    isJson,
  };
}

export async function executeCli(args: string[]): Promise<string> {
  const { command, positionals, flags, isJson } = parseArgs(args);
  const endpoint = resolveEndpoint(flags);
  const apiKey = resolveApiKey(flags);

  const headers: Record<string, string> = {
    'User-Agent': 'ai-model-radar-cli/1.0.0',
    'Accept': 'application/json',
  };
  if (apiKey) {
    headers['Authorization'] = `Bearer ${apiKey}`;
  }

  switch (command) {
    case 'events': {
      const limit = flags['limit'] || '10';
      const provider = flags['provider'] || '';
      const url = `${endpoint}/api/v1/events?limit=${limit}${provider ? `&provider=${encodeURIComponent(provider)}` : ''}`;
      
      const res = await fetch(url, { headers });
      if (!res.ok) {
        throw new Error(`API returned HTTP ${res.status}: ${await res.text()}`);
      }
      const data: any = await res.json();
      const events = data.events || data;

      if (isJson) {
        return JSON.stringify(events, null, 2);
      }

      if (!Array.isArray(events) || events.length === 0) {
        return 'No recent events recorded.';
      }

      let out = `⚡ AI Model Radar — Latest Events (${events.length})\n`;
      out += '─'.repeat(70) + '\n';
      for (const e of events) {
        const time = new Date(e.detected_at).toLocaleString();
        const pct = e.pct_change ? ` (${e.pct_change > 0 ? '+' : ''}${e.pct_change}%)` : '';
        out += `[${e.event_type}] ${e.model_name || e.model_id}${pct}\n`;
        out += `  Provider: ${e.provider || 'AI Hub'} | Time: ${time}\n`;
      }
      return out.trim();
    }

    case 'deals':
    case 'arbitrage': {
      const url = `${endpoint}/api/v1/arbitrage`;
      const res = await fetch(url, { headers });
      if (!res.ok) {
        throw new Error(`API returned HTTP ${res.status}: ${await res.text()}`);
      }
      const data: any = await res.json();
      const deals = data.opportunities || data.clusters || data;

      if (isJson) {
        return JSON.stringify(deals, null, 2);
      }

      if (!Array.isArray(deals) || deals.length === 0) {
        return 'No active provider arbitrage spreads detected right now.';
      }

      let out = `💰 Top Provider Arbitrage Spreads\n`;
      out += '─'.repeat(70) + '\n';
      for (const d of deals.slice(0, 10)) {
        const savings = d.max_prompt_savings_pct || d.spread_pct || 0;
        const name = d.display_name || d.model_name || d.family_key || d.model_id;
        const cheap = d.cheapest_option?.provider || d.cheapest_provider || 'Cheapest';
        const exp = d.expensive_option?.provider || d.expensive_provider || 'Standard';
        out += `• ${name}: Save up to ${Math.round(savings)}% via ${cheap} vs ${exp}\n`;
      }
      return out.trim();
    }

    case 'models': {
      const limit = flags['limit'] || '20';
      const search = flags['search'] || flags['q'] || '';
      const url = `${endpoint}/api/v1/models?limit=${limit}${search ? `&search=${encodeURIComponent(search)}` : ''}`;
      
      const res = await fetch(url, { headers });
      if (!res.ok) {
        throw new Error(`API returned HTTP ${res.status}: ${await res.text()}`);
      }
      const data: any = await res.json();
      const models = data.models || data;

      if (isJson) {
        return JSON.stringify(models, null, 2);
      }

      if (!Array.isArray(models) || models.length === 0) {
        return 'No models matched search criteria.';
      }

      let out = `🤖 Tracked Models (${models.length})\n`;
      out += '─'.repeat(75) + '\n';
      out += `${'MODEL ID'.padEnd(35)} | ${'PROVIDER'.padEnd(14)} | ${'PROMPT / 1M'.padEnd(10)} | COMPLETION / 1M\n`;
      out += '─'.repeat(75) + '\n';
      for (const m of models) {
        const pPrompt = m.price_prompt !== null ? `$${(m.price_prompt * 1_000_000).toFixed(2)}` : (m.is_free ? 'FREE' : '—');
        const pComp = m.price_completion !== null ? `$${(m.price_completion * 1_000_000).toFixed(2)}` : (m.is_free ? 'FREE' : '—');
        const id = m.model_id.length > 33 ? m.model_id.slice(0, 32) + '…' : m.model_id;
        out += `${id.padEnd(35)} | ${(m.provider || '').padEnd(14)} | ${pPrompt.padEnd(10)} | ${pComp}\n`;
      }
      return out.trim();
    }

    case 'compare': {
      if (positionals.length < 2) {
        throw new Error('Usage: radar compare <model1> <model2> [model3] [model4]');
      }
      const modelsToCompare = positionals.slice(0, 4);
      const url = `${endpoint}/api/v1/models?limit=100`;
      const res = await fetch(url, { headers });
      if (!res.ok) {
        throw new Error(`API returned HTTP ${res.status}: ${await res.text()}`);
      }
      const data: any = await res.json();
      const allModels = data.models || data;

      const matched = modelsToCompare.map((id) => {
        const item = (allModels || []).find(
          (m: any) =>
            m.model_id.toLowerCase() === id.toLowerCase() ||
            m.model_id.toLowerCase().includes(id.toLowerCase()) ||
            m.name.toLowerCase().includes(id.toLowerCase())
        );
        return {
          queryId: id,
          found: item || null,
        };
      });

      if (isJson) {
        return JSON.stringify(matched, null, 2);
      }

      let out = `⚖️ AI Model Comparator — Side-by-Side\n`;
      out += '─'.repeat(75) + '\n';
      for (const m of matched) {
        if (!m.found) {
          out += `[${m.queryId}]: Model not found in registry\n\n`;
          continue;
        }
        const item = m.found;
        const pPrompt = item.price_prompt !== null ? `$${(item.price_prompt * 1_000_000).toFixed(2)} / 1M` : (item.is_free ? 'FREE' : '—');
        const pComp = item.price_completion !== null ? `$${(item.price_completion * 1_000_000).toFixed(2)} / 1M` : (item.is_free ? 'FREE' : '—');
        const ctx = item.context_length ? `${Math.round(item.context_length / 1024)}k tokens` : '128k';

        out += `📌 ${item.name} (${item.model_id})\n`;
        out += `   Provider:    ${item.provider}\n`;
        out += `   Input Price: ${pPrompt}\n`;
        out += `   Output Price:${pComp}\n`;
        out += `   Context:     ${ctx}\n`;
        out += `   Modality:    ${item.modality || 'Text + Multimodal'}\n\n`;
      }
      return out.trim();
    }

    case 'auth': {
      const key = positionals[0] || flags['key'];
      if (!key) {
        throw new Error('Usage: radar auth <your-amr-api-key>');
      }
      const existing = loadCliConfig();
      saveCliConfig({ ...existing, apiKey: key });
      return `✓ API key successfully saved to ${CONFIG_PATH}`;
    }

    case 'help':
    default: {
      return `
AI Model Radar CLI — Real-time AI Model & Pricing Intelligence

USAGE:
  npx ai-model-radar <command> [options]

COMMANDS:
  events                  List recent price drops and model release events
  compare <m1> <m2>       Compare 2-4 models side-by-side on price and context
  deals                   List top provider pricing arbitrage opportunities
  models                  Search and browse tracked model pricing
  auth <key>              Configure your API key locally (~/.model-radar/config.json)

OPTIONS:
  --json, -j              Output raw JSON response
  --limit <n>             Number of items to retrieve (default: 10)
  --provider <name>       Filter events by provider (e.g. OpenAI, Anthropic)
  --api-key <key>         Supply API key inline or use AMR_API_KEY env
  --endpoint <url>        Target custom instance URL

EXAMPLES:
  npx ai-model-radar events --limit 5
  npx ai-model-radar compare claude-3-7-sonnet deepseek-r1
  npx ai-model-radar deals
  npx ai-model-radar models --search llama
`.trim();
    }
  }
}

// Direct invocation handler
if (require.main === module) {
  const args = process.argv.slice(2);
  executeCli(args)
    .then((out) => {
      console.log(out);
      process.exit(0);
    })
    .catch((err) => {
      console.error(`Error: ${err.message}`);
      process.exit(1);
    });
}
