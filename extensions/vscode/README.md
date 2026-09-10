# R2 — IDE extension (Tier A, thin client)

In-editor price/context hints for recognized model-id strings.
Read-only information surface, not a refactoring tool.

- Pattern-matches known `provider/model` ids in API args, configs, env values.
- Hover hint with price/context + comparator link (`?utm_source=vscode-ext`).
- No auto-rewrite, no model swapping.
- No codebase telemetry: matching is local; only the matched model-id is
  queried against the public API.

## Success metric

Marketplace installs + **hint→comparator click-through**.
Kill rule: CTR ~0 after 30 days → sunset.

## JetBrains

Same contract: pattern-match locally, hover hint, comparator deep-link.
No separate backend.
