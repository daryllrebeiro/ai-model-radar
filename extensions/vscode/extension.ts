// R2 — VS Code extension (Tier A, thin client).
// Read-only inline hints for recognized model ids. Explicit non-goals:
// - NO automatic code rewriting / model swapping.
// - NO telemetry on codebase contents: matching stays local; only the matched
//   model-id string is ever sent to the radar public API (which is public data).
import * as vscode from 'vscode';

// Matches `provider/model` style ids inside string literals / env values.
const MODEL_ID_RE = /(["'`])([a-z0-9-]+\/[a-z0-9._:-]+)\1/gi;

async function fetchSnapshot(base: string, modelId: string) {
  const res = await fetch(`${base}/api/v1/models/${encodeURIComponent(modelId)}`, {
    headers: { Accept: 'application/json' },
  });
  if (!res.ok) return null;
  const body = (await res.json()) as any;
  return body?.data ?? body?.current ?? null;
}

export function activate(ctx: vscode.ExtensionContext) {
  const provider = vscode.languages.registerHoverProvider(
    ['python', 'typescript', 'javascript', 'json', 'yaml'],
    {
      async provideHover(doc, pos) {
        const line = doc.lineAt(pos.line).text;
        MODEL_ID_RE.lastIndex = 0;
        const m = MODEL_ID_RE.exec(line);
        if (!m) return undefined;
        const modelId = m[2];
        const base =
          vscode.workspace.getConfiguration('aiModelRadar').get<string>('baseUrl') ||
          'https://ai-model-radar.example';
        const snap = await fetchSnapshot(base, modelId).catch(() => null);
        if (!snap) return undefined;
        const price =
          snap.price_prompt === 0 && snap.price_completion === 0
            ? 'FREE'
            : `$${snap.price_prompt ?? '?'} in / $${snap.price_completion ?? '?'} out (per 1M)`;
        const md = new vscode.MarkdownString(
          `**${snap.name || modelId}**\n\n${price} · ${snap.context_length ?? '—'} ctx\n\n` +
            `[Compare alternatives](${base}/compare?models=${encodeURIComponent(modelId)}&utm_source=vscode-ext)`
        );
        md.isTrusted = true;
        // Hover-link clicks are the R2 success metric (hint→comparator CTR).
        return new vscode.Hover(md);
      },
    }
  );
  ctx.subscriptions.push(provider);
}

export function deactivate() {}
