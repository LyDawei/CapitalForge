# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project Overview

CapitalForge is an AI-powered swing trading system that uses four LLM agents (momentum, mean reversion, confirmation, news/events) to analyze technical indicators and current events, then make trading decisions via Alpaca's paper trading API.

## Build & Development Commands

```bash
npm run build          # TypeScript compilation (tsc → dist/)
npm run dev            # Run with ts-node (development)
npm start              # Run compiled JS (production)
npm test               # Run Jest tests
npm run test:coverage  # Run tests with coverage
npm run run-cycle      # Manually trigger a daily trading cycle (accepts --date YYYY-MM-DD)
npm run prisma:generate # Generate Prisma client
npm run prisma:migrate  # Run database migrations
npm run prisma:studio   # Open Prisma Studio GUI
```

Run a single test file: `npx jest src/config.test.ts`

## Architecture

### Daily Cycle (14-step process)

The core loop runs once per trading day (9:35 AM ET, weekdays) via cron, or manually with `--run-now` / `npm run run-cycle`. For each symbol in `TRADING_SYMBOLS`:

1. Fetch 50+ daily bars from Alpaca → calculate technicals (RSI, SMA20/50, MACD, volume)
2. Run 4 LLM agents **in parallel** — each returns `{bullishScore: [-1,1], confidence: [0,1], rationale[]}`
3. Aggregate scores using confidence-weighted average → BUY (>0.4) / SELL (<-0.4) / HOLD
4. Risk manager checks sandbox constraints (max 1 position, drawdown limit, position sizing)
5. Execute trade if allowed → update sandbox state → persist everything to DB

Entry points: `src/index.ts` (cron scheduler) and `scripts/runCycle.ts` (manual trigger).

### Key Modules

- **`src/core/orchestrator.ts`** — Runs the full 14-step daily cycle. Central coordination point.
- **`src/core/aggregator.ts`** — Weighted score aggregation with ±0.4 decision thresholds.
- **`src/core/riskManager.ts`** — Enforces one-position limit, max drawdown halt (20%), fixed 20% position sizing. Manages sandbox (simulated portfolio) state.
- **`src/core/technicals.ts`** — Wraps `technicalindicators` library for RSI(14), SMA(20/50), MACD(12,26,9).
- **`src/agents/{momentum,meanReversion,confirmation,newsEvents}.ts`** — Four independent LLM agents with specialized prompts. All share the same `AgentOutput` Zod schema. The newsEvents agent also receives `NewsData` (Alpaca news + web search results).
- **`src/services/news.ts`** / **`news.mock.ts`** — News service fetching from Alpaca News API + OpenAI web search.
- **`src/services/alpaca.ts`** / **`alpaca.mock.ts`** — Broker API (real uses Alpaca Data API v2; mock generates deterministic prices).
- **`src/services/llm.ts`** / **`llm.mock.ts`** — LLM API (real uses OpenAI GPT-4o; mock generates scores from technicals deterministically).
- **`src/services/db.ts`** — Prisma client singleton for all DB operations.
- **`src/config.ts`** — Zod-validated config from env vars, singleton via `getConfig()`.
- **`src/types.ts`** — All shared TypeScript interfaces and Zod schemas.
- **`src/prompts.ts`** — LLM prompt templates for each agent.

### Service Abstraction Pattern

Services use interfaces (`AlpacaService`, `LLMService`, `NewsService`) with real and mock implementations. The `MODE` env var (`mock` | `paper`) determines which implementations are instantiated in `index.ts`. This allows deterministic testing without API calls.

### Database (Prisma + PostgreSQL)

Schema in `prisma/schema.prisma` with 7 models. Key relationship: `DailyCycle` (unique on `[date, symbol]`) has child records for `AgentEvaluation[]`, `AggregatedDecision`, and `Trade`. `SandboxState` tracks the simulated portfolio day-by-day. `PromptVersion` stores prompt templates for audit.

### Shared Wallet / Sandbox

A single wallet ($2000 default) is shared across all symbols. The sandbox is loaded once at the start of each daily cycle run and threaded through each symbol sequentially — each symbol sees the real cash balance after the previous symbol's trade. Only one position can be held at a time (enforced in `riskManager.ts`). Sandbox snapshots are persisted to `SandboxState` after each symbol so state survives crashes.

## Environment Setup

Copy `.env.example` and fill in: `DATABASE_URL`, `ALPACA_API_KEY`, `ALPACA_API_SECRET`, `OPENAI_API_KEY`. Set `MODE=mock` for testing without real APIs. Docker Compose provides PostgreSQL + the app.

## Tech Stack

- Node.js >=18, TypeScript 5.7 (strict mode, ES2022, CommonJS)
- Prisma 7.x ORM, PostgreSQL 16
- OpenAI SDK (GPT-4o), Zod for runtime validation
- Jest + ts-jest for testing
- Docker + Docker Compose for deployment

## Self-Correction Rules

When you make a mistake during a session (wrong assumption, broken code, failed build, incorrect edit, etc.):

1. **Fix the mistake immediately.**
2. **Append a new rule below** describing what went wrong and how to avoid it. Use the format:
   ```
   ### RULE-NNN: Short title
   **Mistake:** What happened.
   **Fix:** What to do instead.
   ```
3. Number rules sequentially starting from RULE-001.

This section is a living log. Rules accumulate over time so future instances never repeat the same mistakes.

---

<!-- Add new rules below this line -->

### RULE-001: Type `fetch` response.json() return in strict mode
**Mistake:** Called `response.json()` and used the result directly, causing TS18046 "'data' is of type 'unknown'" in strict TypeScript.
**Fix:** Always type the result of `.json()` explicitly (e.g., `const data: any = await response.json()`) when working with untyped external API responses.

### RULE-002: Prisma 7.x requires adapter — no `url` in schema or `datasourceUrl` in constructor
**Mistake:** Tried `url = env("DATABASE_URL")` in schema.prisma (rejected by Prisma 7), then `datasourceUrl` in PrismaClient constructor (not in the types). Both fail.
**Fix:** Prisma 7 requires `@prisma/adapter-pg` + `pg`. Use `new PrismaPg({ connectionString })` to create an adapter, then pass it as `new PrismaClient({ adapter })`. The `prisma.config.ts` with `defineConfig({ datasource: { url } })` is only for CLI tools (migrate, generate), not runtime.
