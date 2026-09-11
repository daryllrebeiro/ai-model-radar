# AI Model Radar — Browser Extension Privacy (R1 store review)

This is the privacy narrative for Chrome Web Store / Firefox Add-ons review.
It describes exactly what the extension in `extensions/browser/` does.

## What it does

On a narrow, explicit allowlist of model-related pages (OpenRouter model
pages, provider docs, major chat UIs — see `allowlist.js`), the extension
shows a small dismissible badge: the model's current price, a one-line
context/modality summary, and a "compare alternatives" link.

## Data collection: minimal by construction

- **Matched model id only.** The single network request per matched page is
  `GET {radarBase}/api/v1/models/{modelId}` — a public catalog lookup.
- **No browsing history.** Pages outside `allowlist.js` trigger zero code:
  no fetch, no DOM injection (regression-tested).
- **No page content.** Surrounding DOM, keystrokes, form inputs, and chat
  transcripts are never read — the content script parses only the URL.
- **No page modification.** The overlay is a new appended node; prices and
  content on the host page are never rewritten.
- **No affiliate injection, no redirects.** The only outbound link is the
  comparator deep-link (`?utm_source=browser-ext` for funnel measurement).
- **Local settings only.** `chrome.storage.local` holds one key: the
  user-configurable radar base URL (`radarBase`).

## Permissions justification (manifest.json)

| Permission | Why |
|---|---|
| `storage` | Persist the user-configured radar base URL locally |
| `host_permissions` (radar backend only) | The catalog lookup endpoint |
| content-script `matches` (7 URL patterns) | The allowlist — deliberately NOT `<all_urls>` |

No `history`, `tabs`, `webNavigation`, cookies, or credentials are requested.
All API reads are unauthenticated public-catalog reads.
