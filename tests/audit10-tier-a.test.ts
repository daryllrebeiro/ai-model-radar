import { describe, it, expect, vi, beforeEach } from 'vitest';
import fs from 'fs';
import path from 'path';

const BROWSER_DIR = path.join(process.cwd(), 'extensions', 'browser');
const VSCODE_DIR = path.join(process.cwd(), 'extensions', 'vscode');

// ─── R1 manifest scope ────────────────────────────────────────────────
describe('R1 manifest permission scope', () => {
  it('has no <all_urls> grant; content scripts match a narrow explicit list', () => {
    const raw = fs.readFileSync(path.join(BROWSER_DIR, 'manifest.json'), 'utf-8');
    expect(raw).not.toContain('<all_urls>');
    const manifest = JSON.parse(raw);
    const matches: string[] = manifest.content_scripts[0].matches;
    expect(matches.length).toBeGreaterThan(0);
    expect(matches.length).toBeLessThanOrEqual(10);
    for (const m of matches) {
      expect(m).toMatch(/^https:\/\//);
      expect(m).not.toContain('*://*');
    }
    expect(manifest.permissions).not.toContain('history');
    expect(manifest.permissions).not.toContain('tabs');
    expect(manifest.permissions).not.toContain('webNavigation');
  });

  it('host_permissions cover only the radar backend, not match domains', () => {
    const manifest = JSON.parse(fs.readFileSync(path.join(BROWSER_DIR, 'manifest.json'), 'utf-8'));
    for (const h of manifest.host_permissions as string[]) {
      expect(h).not.toContain('openrouter');
      expect(h).not.toContain('openai.com');
    }
  });
});

// ─── R1 content-script behavior under stub DOM ────────────────────────
function installBrowserStubs(href: string, snapshot: any) {
  const fetchCalls: any[] = [];
  const appended: any[] = [];
  (globalThis as any).chrome = { storage: { local: { get: async () => ({}) } } };
  (globalThis as any).location = { href, pathname: new URL(href).pathname, search: new URL(href).search };
  (globalThis as any).fetch = async (url: any, init: any) => {
    fetchCalls.push({ url, init });
    return { ok: true, json: async () => ({ data: snapshot }) };
  };
  let capturedHtml = '';
  const badge: any = {
    set innerHTML(v: string) { capturedHtml = v; },
    get innerHTML() { return capturedHtml; },
    querySelector: () => ({ addEventListener: () => {} }),
  };
  (globalThis as any).document = {
    createElement: () => badge,
    documentElement: { appendChild: (el: any) => appended.push(el) },
  };
  return {
    fetchCalls,
    appended,
    html: () => capturedHtml,
    cleanup() {
      delete (globalThis as any).chrome;
      delete (globalThis as any).location;
      delete (globalThis as any).fetch;
      delete (globalThis as any).document;
    },
  };
}

async function flush() {
  for (let i = 0; i < 10; i++) await new Promise((r) => setImmediate(r));
}

describe('R1 overlay behavior (stub-DOM functional)', () => {
  beforeEach(() => vi.resetModules());

  it('XSS payload in model name renders inert in the overlay', async () => {
    const stubs = installBrowserStubs('https://openrouter.ai/models/openai/gpt-4o', {
      name: '"><img src=x onerror=alert(1)><script>alert(2)</script>',
      price_prompt: 0.0000025,
      price_completion: 0.00001,
      context_length: 128000,
    });
    try {
      await import('../extensions/browser/content.js');
      await flush();
      expect(stubs.fetchCalls).toHaveLength(1);
      expect(stubs.appended).toHaveLength(1);
      const html = stubs.html();
      expect(html).not.toContain('<script>');
      expect(html).not.toContain('<img');
      expect(html).toContain('&lt;script&gt;');
      expect(html).toContain('&quot;&gt;');
    } finally {
      stubs.cleanup();
    }
  });

  it('non-allowlisted page: zero network calls, zero DOM injection', async () => {
    const stubs = installBrowserStubs('https://evil.example/phish?q=openai/gpt-4o', { name: 'x' });
    try {
      await import('../extensions/browser/content.js');
      await flush();
      expect(stubs.fetchCalls).toHaveLength(0);
      expect(stubs.appended).toHaveLength(0);
    } finally {
      stubs.cleanup();
    }
  });

  it('allowlist module itself rejects lookalikes', async () => {
    const mod: any = await import('../extensions/browser/allowlist.js');
    expect(mod.isAllowedUrl('https://openrouter.ai/models/openai/gpt-4o')).toBe(true);
    expect(mod.isAllowedUrl('https://openrouter.ai/')).toBe(false);
    expect(mod.isAllowedUrl('https://openrouter.ai.evil.com/models/x')).toBe(false);
    expect(mod.isAllowedUrl('http://openrouter.ai/models/x')).toBe(false);
    expect(mod.isAllowedUrl('https://evil.example/')).toBe(false);
  });

  it('only the matched model id leaves the browser (no page content)', async () => {
    const stubs = installBrowserStubs('https://openrouter.ai/models/anthropic/claude-x?model=zzz', {
      name: 'C', price_prompt: 1, price_completion: 2, context_length: 100,
    });
    try {
      await import('../extensions/browser/content.js');
      await flush();
      expect(stubs.fetchCalls).toHaveLength(1);
      const url = String(stubs.fetchCalls[0].url);
      expect(url).toContain(encodeURIComponent('anthropic/claude-x'));
      expect(url).not.toContain('zzz');
      expect(JSON.stringify(stubs.fetchCalls[0].init || {})).not.toContain('document');
    } finally {
      stubs.cleanup();
    }
  });
});

// ─── R2 IDE extension ─────────────────────────────────────────────────
function extractModelIdRegex(): RegExp {
  const src = fs.readFileSync(path.join(VSCODE_DIR, 'extension.ts'), 'utf-8');
  const m = src.match(/const MODEL_ID_RE = (\/.*\/[a-z]*);/);
  expect(m).not.toBeNull();
  // eslint-disable-next-line no-eval
  return eval(m![1]);
}

describe('R2 IDE extension scope', () => {
  it('requests no workspace/fs/network permissions beyond hover + config', () => {
    const pkg = JSON.parse(fs.readFileSync(path.join(VSCODE_DIR, 'package.json'), 'utf-8'));
    const src = fs.readFileSync(path.join(VSCODE_DIR, 'extension.ts'), 'utf-8');
    expect(src).not.toContain('workspace.fs');
    expect(src).not.toContain('findFiles');
    expect(src).not.toContain('readFile');
    expect(src).not.toContain('sendTelemetry');
    expect(src).not.toContain('TelemetryReporter');
    // The single outbound call targets the public models endpoint only.
    const fetches = src.match(/await fetch\(/g) || [];
    expect(fetches).toHaveLength(1);
    expect(src).toContain('/api/v1/models/${encodeURIComponent(modelId)}');
    expect(JSON.stringify(pkg)).not.toContain('workspaceTrust');
    expect(src).toContain('registerHoverProvider');
  });

  it('adjacent secrets are never capturable by the model-id pattern', () => {
    const re = extractModelIdRegex();
    const line = 'const sk = "sk-ant-secret-xyz"; const model = "openai/gpt-4o"; // token=abc';
    const found: string[] = [];
    let m: RegExpExecArray | null;
    re.lastIndex = 0;
    while ((m = re.exec(line)) !== null) found.push(m[2]);
    expect(found).toEqual(['openai/gpt-4o']);
    // A bare secret (no slash) can never match at all.
    re.lastIndex = 0;
    expect(re.exec('"sk-ant-secret-xyz"')).toBeNull();
  });

  it('matched ids cannot break out of the hover markdown link (no hint XSS)', () => {
    const re = extractModelIdRegex();
    const evil = '"x/](javascript:alert(1))"';
    re.lastIndex = 0;
    const m = re.exec(`model = ${evil}`);
    // Either no match, or a match confined to the safe charset (no parens/quotes/spaces).
    if (m) {
      expect(m[2]).not.toMatch(/[()\[\]"\s]/);
      expect(encodeURIComponent(m[2])).toBe(m[2].replace(/[/]/g, '%2F'));
    }
    const src = fs.readFileSync(path.join(VSCODE_DIR, 'extension.ts'), 'utf-8');
    expect(src).toContain('encodeURIComponent(modelId)');
    // Only the matched id is fetched — surrounding code never leaves the editor.
    expect(src.match(/fetchSnapshot\(base, modelId\)/)).not.toBeNull();
  });
});

