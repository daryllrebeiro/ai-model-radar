# GitHub Labs Ingestion: Authentication & Rate Limiting Policy

This document details the authentication options, rate limits, error handling, and operational tradeoffs for AI Model Radar's GitHub Labs ingestion service (`src/lib/ingestion/github-labs.ts`).

---

## 1. Authentication Modes & Tradeoffs

| Mode | Rate Limit Quota | Isolation & Risk Profile | Recommended Use |
| :--- | :--- | :--- | :--- |
| **No Token** (`GITHUB_TOKEN` unset) | **60 req/hr** | **Shared Quota**: Shared across all tenants egressing from the same cloud hosting IP. At 6 repos hourly (6–12 req/hr), baseline usage is within limits, but bursts from third-party neighbors on shared egress IPs can cause intermittent `HTTP 403 (rate limit exceeded)`. | Dev/Testing or low-stakes deployments where occasional gaps on `/labs` are acceptable. |
| **With Token** (`GITHUB_TOKEN` set) | **5,000 req/hr** | **Dedicated Quota**: Dedicated personal or machine access token with zero tenant crossover. Predictable and isolated. | Production environments requiring uninterrupted `/labs` changelog tracking. |

---

## 2. Decision & Design Principles

1. **Token is Optional**: The platform boots cleanly without throwing errors if `GITHUB_TOKEN` is omitted, emitting a one-time startup advisory warning.
2. **Zero Synthetic Data Fallback**: When rate limited (`HTTP 403` or `HTTP 429`), the ingestion worker records a `failed` run with the actual status code and `x-ratelimit-remaining` headers in `ingestion_runs`. It **never** fabricates fake activity items or timestamps.
3. **Domain Isolation**: A GitHub rate-limit bounce affects only the `/labs` view; OpenRouter and HuggingFace poll cycles continue independently.
4. **Configurable Polling Cadence**: Set `GITHUB_POLL_INTERVAL_MINUTES=60` (or another integer) to adjust the hourly schedule without code modifications.

---

## 3. How to Configure `GITHUB_TOKEN`

1. Go to **GitHub Settings → Developer Settings → Personal Access Tokens → Fine-grained tokens** (or Classic tokens).
2. Generate a token with public read access (no special repo permissions required for public repositories).
3. Set the environment variable:
   ```env
   GITHUB_TOKEN=ghp_yourGeneratedTokenHere
   GITHUB_POLL_INTERVAL_MINUTES=60
   ```
4. Verify quota and headroom:
   ```bash
   curl -H "Authorization: Bearer $GITHUB_TOKEN" https://api.github.com/rate_limit
   ```
