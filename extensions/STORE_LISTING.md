# Store listings (R1 browser + R2 IDE)

## Browser extension (Chrome / Firefox)

- **Name:** AI Model Radar — Price & Context Badge
- **Short description:** Live LLM price + context overlay on model pages, with one-click alternatives comparison.
- **Full description:** Comparing models happens on OpenRouter, provider docs,
  and chat apps — not on a dashboard. This extension detects recognized model
  pages and shows a small dismissible badge (current price, context summary,
  "compare alternatives" link into the AI Model Radar comparator). Read-only:
  it never rewrites page content, never collects browsing history, and only
  contacts the radar's public catalog API. See PRIVACY.md.
- **Category:** Developer Tools / Productivity.

## VS Code extension (R2; JetBrains port follows the same contract)

- **Name:** AI Model Radar — Price & Context Hints
- **Short description:** Inline price/context hints for model ids in code.
- **Full description:** Hover any `provider/model` id in code, configs, or
  env files for current price, context window, and a comparator link.
  Matching is local to the editor; only the matched id is looked up.
  No code rewriting, no codebase telemetry. See `extensions/vscode/README.md`.

## Publish checklist

1. `npm run ext:package` → versioned zips under `dist/`.
2. Attach PRIVACY.md answers to the store privacy questionnaire.
3. Start with the 7-domain allowlist; expand only with a manifest update +
   a changelog entry (never silently).
4. Instrument week-1 overlay→comparator CTR before any store featuring
   spend — kill threshold per the R1 spec.
