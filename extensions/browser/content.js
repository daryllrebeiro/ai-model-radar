// R1 content script — overlay-only. Explicit non-goals enforced here:
// - NEVER rewrites prices on the page itself (fragile + confusing on drift).
// - NEVER injects affiliate links or redirects.
// - NEVER reads pages outside allowlist.js.
import { isAllowedUrl } from './allowlist.js';
import { fetchModelSnapshot, getComparatorUrl } from './api-client.js';

function detectModelId() {
  // Conservative: full OpenRouter slug from path (provider/model — never
  // truncate at the first slash), else a `model=` query param.
  const m = location.pathname.match(/\/models\/([^?#]+)/);
  if (m) return decodeURIComponent(m[1].replace(/\/$/, ''));
  const q = new URLSearchParams(location.search).get('model');
  return q || null;
}

async function main() {
  if (!isAllowedUrl(location.href)) return;
  const modelId = detectModelId();
  if (!modelId) return;

  const snap = await fetchModelSnapshot(modelId).catch(() => null);
  if (!snap) return;

  const badge = document.createElement('div');
  badge.id = 'amr-overlay-badge';
  badge.innerHTML = `
    <div class="amr-card">
      <span class="amr-title">${escapeHtml(snap.name || modelId)}</span>
      <span class="amr-sub">${fmtPrice(snap.price_prompt)} in / ${fmtPrice(snap.price_completion)} out · ${fmtCtx(snap.context_length)}</span>
      <a class="amr-cta" href="${await getComparatorUrl([modelId])}" target="_blank" rel="noopener">Compare alternatives</a>
      <button class="amr-x" aria-label="Dismiss">×</button>
    </div>`;
  badge.querySelector('.amr-x').addEventListener('click', () => badge.remove());
  // Click-through on .amr-cta is the R1 success metric (overlay→comparator CTR).
  document.documentElement.appendChild(badge);
}

function escapeHtml(s) {
  return String(s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
}
function fmtPrice(p) {
  return p === 0 ? 'FREE' : p != null ? `$${Number(p).toFixed(4)}/1M` : '—';
}
function fmtCtx(c) {
  return c ? `${Math.round(c / 1024)}k ctx` : 'ctx —';
}

main();
