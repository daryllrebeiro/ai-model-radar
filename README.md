# AI Model Radar 📡

**A real-time changelog and intelligence feed for the AI model market.**
One feed of every price drop, free tier addition, new release, context expansion, and delisting — with full historical tracking across providers.

---

## 🎯 Complete Roadmap Matrix (Phases V0 – V4)

- **Event-Sourced Feed (`/`)**: Append-only log of 6 distinct market event types (`NEW_MODEL`, `MODEL_REMOVED`, `PRICE_CHANGE`, `BECAME_FREE`, `LEFT_FREE`, `CONTEXT_CHANGED`) with filter chips, search, and live pulse stats.
- **Provider Price Arbitrage Matrix (`/arbitrage`)**: Multi-provider comparison matrix calculating price spreads, savings percentages, and context limits across identical model architectures on OpenRouter.
- **Verified Benchmark Matrix (`/benchmarks`)**: Sourced public benchmark evaluations (Chatbot Arena Elo, SWE-bench Verified, HumanEval, MATH-500, GPQA Diamond) with client-side customizable priority sliders.
- **AI Stack Advisor & Cost Calculator (`/advisor`)**: Interactive monthly token throughput calculator recommending Performance, Best Value, and Free tiers with annual dollar savings.
- **Market Signals & Anomalies (`/signals`)**: Evidence-based anomaly detector surfacing extreme pricing deviations, rapid price wars, and mega-context breakthroughs.
- **GitHub Lab Activity Monitor (`/labs`)**: Verifiable repository updates, tokenizer changes, and commit logs across OpenAI, Anthropic, DeepSeek, Google DeepMind, Meta, and Mistral.
- **Personalized Alerts & Digest Center (`/alerts`)**: Configurable threshold rules (min drop %, free models, target providers) with live preview and webhook dispatch.
- **Hugging Face Community Radar (`/community`)**: Stream of trending open-weight models, download spikes, likes, and repo releases from Hugging Face Hub (separated from pricing diffs).
- **Public Developer Read API (`/api/v1/*`) & Interactive Docs (`/docs`)**: Versioned developer endpoints with rate limit headers and live documentation.
- **Client-Side Watchlists & Filters**: Zero-auth star/watch capability persisted in `localStorage` with reactive feed filtering and shareable URL query syncing (`/?watchlist=true`).
- **Public Syndication Feeds**:
  - **RSS 2.0 XML**: [`/feed.xml`](http://localhost:3000/feed.xml) for RSS readers and webhooks.
  - **JSON Feed 1.1**: [`/api/feed/json`](http://localhost:3000/api/feed/json) for automation scripts.
- **Model Detail Pages (`/models/:id`)**: Specifications, interactive **Recharts** price history line charts ($/1M tokens), and dedicated model event timeline.
- **Deals & Free Hub (`/deals`)**: 7-day and 30-day biggest price drop leaderboards and grid of all active 100% free models.
- **Dual Storage Engine**: Production-ready PostgreSQL (Neon / Supabase / AWS RDS) with automatic local zero-config fallback.

---

## 🚀 Quick Start

### 1. Install Dependencies
```bash
npm install
```

### 2. Seed Realistic 30-Day Historical Data
```bash
npm run seed:mock
```

### 3. Start Development Server
```bash
npm run dev
```
Open [http://localhost:3000](http://localhost:3000) in your browser.

---

## 🛠️ CLI & Scripts

- **`npm run ingest:poll`**: Runs a live OpenRouter poll, diffs against previous database state, and records new events.
- **`npm run seed:mock`**: Seeds 30 days of realistic historical market events across OpenAI, Anthropic, Google, DeepSeek, Meta, Mistral, and Qwen.
- **`npm test`**: Runs the 17 Vitest unit tests covering diff rules, arbitrage calculations, community models, benchmarks, signals, advisor, and alert rules.
- **`npm run build`**: Builds production Next.js application bundle across all 13 routes and 12 API endpoints.

---

## ⚙️ Environment Variables

Create `.env.local` if using custom configurations or external PostgreSQL:

```env
# Optional: PostgreSQL Database URL (Supabase, Neon, etc.)
# If omitted, local database storage is used out-of-the-box.
DATABASE_URL=postgresql://postgres:postgres@localhost:5432/ai_model_radar

# Optional: Custom OpenRouter endpoint (defaults to https://openrouter.ai/api/v1/models)
OPENROUTER_API_URL=https://openrouter.ai/api/v1/models

# Optional: Bearer token for /api/cron/poll in production
CRON_SECRET=your_secure_cron_token_here

# Optional: Public site URL for RSS feed guid links
NEXT_PUBLIC_SITE_URL=https://ai-model-radar.vercel.app
```