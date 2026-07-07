# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project Overview

> **⚠️ Active surface (May 2026): `V2/` at repo root, not `packages/`.** The
> sections below describe the original `packages/` monorepo (V1 + an earlier
> in-monorepo "V2 engine"). Current work has moved to a separate **Agent Audit
> Console** under `V2/` — its own Prisma project, Fastify backend on :4000, Vite
> UI on :4001, no Docker/Turborepo. See `V2/README.md` + `V2/TODO.md` for the
> live picture and the dated "Last Worked On" entry below for where it stands.
> The `packages/` tree still builds but is no longer the focus.

CapitalForge is an AI-powered swing trading system. Two engine versions live side-by-side:

- **V1 (legacy, scheduled for removal once V2 is validated)** — four LLM agents (momentum, mean reversion, confirmation, news/events) running in parallel; confidence-weighted aggregation with ±0.4 thresholds; fixed 20% position sizing.
- **V2 (current target)** — six specialists (`trendRegime`, `setupPattern`, `momentum`, `meanReversion`, `volumeFlow`, `newsEvents`) running in parallel, plus a `headTrader` agent that reads all six and emits a complete `TradePlan` (action, conviction, entry, stop, target1/2, riskPctOfEquity, invalidationCriteria, reasoningTrace). Risk manager V2 enforces conviction-weighted sizing + drawdown ladder.

Switch between them with `ENGINE_VERSION=v1` (default) or `ENGINE_VERSION=v2`.

The repo is a **monorepo** under `packages/`:
- `@capitalforge/shared` — Zod schemas + `AGENT_REGISTRY` (single source of truth for agent metadata)
- `@capitalforge/engine` — cron + V1/V2 orchestrators, services, Prisma schema/migrations, settler
- `@capitalforge/api` — Fastify + Zod HTTP API on :3001
- `@capitalforge/ui` — Vite + React SPA on :3000

Trades execute via Alpaca paper trading; the simulated wallet (`SandboxState`) is shared across symbols.

## Last Worked On

Append-only log of work sessions, **most recent first**. Each entry: what shipped, what's mid-flight, what's next. Update at the end of each working session so future Claude (and David) can resume without spelunking.

> **Process rule (2026-07-07):** log this section **before every commit**, not just
> at session end. No commit without a matching "Last Worked On" entry first.

### 2026-07-07 — headTrader v0.4.0 activated + validated; Docker DB rescued; docs

**Shipped:**
- **headTrader v0.4.0 active** (`backend/src/prompts/headTrader.v0.4.0.ts` +
  matching `cycleRunner.ts` change). The runner now serializes the **full**
  specialist payload (`bullishScore, confidence, flags, rationale, keyLevels,
  extras`) into the head-trader prompt instead of just `(score, conf, flags)`.
  Prior versions' veto/conflict rules referenced `extras.*` fields the model
  never received — the rules were unenforceable. v0.4.0's INPUTS/READ-THIS-FIRST
  describe the JSON shape and name the key extras fields. Registered + activated
  via `scripts/upgrade-prompt.ts headTrader 0.4.0` (verified `isActive`, priors
  off). Decision logic/sizing unchanged — pure "feed the model what we already
  told it to reason over."
- **Validated on real gpt-4o.** Smoke backfill AMD+NVDA, 2026-06-01→06-08, 12
  cycles, `gpt-4o-2024-08-06`, prompt v0.4.0, **12/12 schema-valid**, ~$0.09/cycle.
  Confirmed the fix works: the head trader now **reasons over the extras by name**
  (cites `extensionATR`, momentum exhaustion, volume accumulation, setup grade).
  All 12 resolved HOLD — but *well-reasoned* HOLDs (bull trend vs. exhausted/
  overbought/extended, no setup → correctly below the 0.40 floor), not the old
  blind all-HOLD. DB now at 117 cycles.
- **Secret hygiene:** scrubbed real FRED/FINNHUB keys out of tracked
  `.env.example` (placeholders now; live keys stay in gitignored `V2/.env`). Never
  committed, so not in history.
- **Frontend:** `api()` helper now auto-encodes object bodies as JSON
  (`client.ts`), callers simplified (`Watchlist.tsx`).
- **Docs:** new `V2/DOCKER.md` (Postgres-in-Docker runbook + the socket/WSL boot-
  failure troubleshooting, below) and refreshed `V2/README.md` (v0.4.0 state,
  `upgrade-prompt` + `backfill` command docs, pointer to DOCKER.md).

**The Docker saga (root-caused — see `V2/DOCKER.md`):** Docker Desktop refused to
boot, cycling through *"initializing <service>: remove …`.sock`: The file cannot
be accessed by the system"* (Win error 1920). Two compounding faults: (1) orphaned
AF_UNIX sockets from unclean exits that **nothing** can delete — not `del`,
`fsutil`, `\\?\`, `robocopy /MIR`, or even a full reboot — and Docker crashes on
boot trying to `remove()` them, orphaning more; (2) a stuck `docker_data.vhdx`
(`WSL_E_USER_VHD_ALREADY_ATTACHED`). The missing step every restart:
**`wsl --shutdown`** (kills the VM + detaches the VHD — process-kills don't).
Working recovery = quit Docker → `wsl --shutdown` → rename the canonical socket
dirs so Docker recreates them fresh → boot fully without interrupting. Also bumped
VM memory 2 GB→4 GB (the accidental repo-root monorepo `docker compose up` OOM'd
buildkit and started the crash cascade — **run compose from `V2/`**).

**Mid-flight / don't over-read:**
- n=12, **all HOLD** — no BUY this window, so v0.4.0's *commit* path is
  un-exercised under the new prompt (v0.3.0 already proved commit works). June
  AMD/NVDA were uniformly extended/overbought; HOLD was arguably correct.
- gpt-4o anchors HOLD conviction at **exactly 0.350** every cycle (reasoning
  varies, the number doesn't) — conviction carries little info on HOLDs.
- Cosmetic bug still open: `Deliberation.modelName='mock-smart-1'` hardcode in
  `cycleRunner.ts` even when real gpt-4o ran (correct model is on `AgentRun`).

**Next:**
1. **BUY-seeking window** — backfill a clean pullback-in-uptrend period to confirm
   v0.4.0 still commits (and that the extras feed doesn't over-suppress).
2. **Wider backfill for sample size** — the standing item; more names, longer
   window, both regimes, toward the ~60-sample bar before believing any hit rate.
3. Fix the `mock-smart-1` cosmetic bug while next in `cycleRunner.ts`.
4. Still deferred: shadow-plan settlement (`TradePlan.cycleId` `@unique` refactor)
   and Phase B order execution behind `RUNNER_DRY_RUN`.

### 2026-05-29 — Postgres in Docker + headTrader v0.3.0 breaks the all-HOLD logjam

**Shipped:**
- **Postgres containerized** (`V2/docker-compose.yml`, DB-only — backend/frontend
  still run locally). Migrated the existing DB off the local `postgresql-x64-16`
  install into the `cf_v2_pgdata` volume via `pg_dump`/`pg_restore` with zero
  data loss (63 cycles + 756 AgentRuns verified intact). Container owns host
  port 5432, so `DATABASE_URL` is unchanged. Local service set to Manual startup.
  `.env.example` creds aligned to `postgres/postgres`; README "No Docker" claims
  corrected; `*.dump` gitignored. Commit `ca50bd6`.
- **headTrader v0.3.0** (`backend/src/prompts/headTrader.v0.3.0.ts`, active).
  Diagnosed the 100%-HOLD problem from the reasoning traces — it was three things,
  not just timidity: (1) genuinely weak specialist signals on calm large-caps
  (HOLD was often *right*); (2) a hard `conviction<0.5` binary with no small-size
  path; (3) an empty-feed false veto — `liquiditySlippage` returned
  `tradable=false @ confidence 0.00` on **AAPL** (a mega-cap) and that hard-vetoed
  the cycle. v0.3.0: conviction floor 0.5→0.4 with a **0.40–0.50 quarter-size
  starter tier**; no-thesis HOLD now needs absence of BOTH a setup AND directional
  agreement (a pullback-in-uptrend counts); **discount any specialist veto/signal
  at confidence <0.3** (kills the false veto from inside the head trader); trimmed
  the anti-overtrading sermon. Hard safety vetoes kept. Commit `2be93d4`.

**Validation (this is the headline):** funded the wallet $0→$2000 (it was empty —
own blocker, since sizing = walletBalance × riskPct), flipped `strategyBias`
`mean_reversion → trend_following` (right lens for momentum names), and ran a
real-gpt-4o smoke backfill: **TSLA + AMD, 2026-04-22→05-20, 42 cycles, ~$2.50.**
Result — **the all-HOLD logjam is broken.** 4 BUY plans (all AMD, conviction
0.50–0.55, exactly the new starter tier), all settled `target1_hit` for +$101.34
(wallet → $2101.34). The **TradePlan→TradeOutcome→wallet loop flowed data for the
first time.** TSLA produced 0 trades (signals stayed sub-0.40).

**Mid-flight / don't over-read:** 4 trades, **4/4 winners, all exactly ~1R
target1_hit** — suspiciously clean and n=4. Mechanism validated; **profitability
completely unproven.** Two things to be skeptical of: (a) 4/4 with no stop/time-stop
hits smells like the settler's forward-walk may be structurally favorable (or AMD
just trended up that month) — worth checking whether any stop was genuinely
threatened; (b) n=4 says nothing — the `V2/TODO.md` promotion framework wants ~60
directional samples / 100 trades before claiming an edge.

**Next:** wider backfill (more names, longer window, both regimes) to get sample
size up before believing any hit rate — bigger spend, separate decision. Then the
deferred items become meaningful: shadow-plan settlement (the `TradePlan.cycleId`
`@unique` refactor) and Phase B order execution behind `RUNNER_DRY_RUN`. Also still
open: the `macroContext`-prose-in-`flags` leak and the cosmetic
`Deliberation.modelName='mock-smart-1'` hardcode in `cycleRunner.ts`.

### 2026-05-29 — orientation pass on the `V2/` Agent Audit Console

No code shipped this session — verified where V2 actually stands after the
5/20–5/21 commit batch (the entries below this one describe the superseded
`packages/` V2 engine; the real work has lived in `V2/` since ~5/18). Source of
truth for V2 is now `V2/TODO.md` + `V2/README.md`.

**What the `V2/` console is now:** audit-first rewrite at repo root. 8 specialists
(`trendRegime`, `setupPattern`, `momentum`, `meanReversion`, `volumeFlow`,
`newsEvents`, + new `macroContext`, `liquiditySlippage`), `headTrader`, two
adversarial reviewers (`riskAuditor`, `devilsAdvocate`), post-cycle `critic`, and
a `growthScout` watchlist-proposal pipeline. Every LLM call recorded as an
`AgentRun` (inputHash, promptVersion, model, latency, tokens, cost, rawResponse,
parsedOutput, schemaValid). Real adapters live: OpenAI (`llm.openai.ts`,
gpt-4o head trader / gpt-4o-mini specialists), real Alpaca data + NBBO + asset
info + account/positions, Finnhub news/fundamentals, FRED macro — all with a
`FeedFetch` audit trail. All four `V2/TODO.md` items shipped (JSON output
contract, A/B shadow runs, real Alpaca data adapter Phase A, persistent wallet
ledger).

**Validation status — the headline.** A real-LLM backfill ran: 63 cycles,
AAPL/NVDA/SPY × 21 trading days (2026-04-22 → 2026-05-20), gpt-4o, $4.24 spent,
**0/756 schema failures** (the contract + OpenAI JSON path is rock solid). BUT
**every one of the 63 cycles resolved to HOLD** (avg conviction 0.348), so:
- **0 TradePlans → 0 TradeOutcomes → 0 critique-on-outcome data.**
- The entire profitability / hit-rate / calibration apparatus has **no data to
  chew on yet.** The central question the console exists to answer is still
  unanswered — not because the plumbing is broken (it isn't), but because the
  head trader never commits.
- This kills the old "tune the mock technicals" theory (CLAUDE.md, 4/27): it's
  HOLD-everything even on **real** data with **real** gpt-4o. The head trader is
  conservative to a fault on calm large-caps over a quiet month.

**Mid-flight / known gaps:**
- Phase B (order execution, `submitOrder`) intentionally deferred behind the
  `RUNNER_DRY_RUN` safety gate — but it's moot until cycles produce non-HOLD plans.
- Shadow head-trader A/B can't settle TradePlan-level outcomes yet:
  `TradePlan.cycleId` / `Deliberation.cycleId` are `@unique`, so only one plan
  per cycle persists. Relaxing that touches 8+ files (carve-out noted in TODO #2).
- Cosmetic bug: `cycleRunner.ts` hardcodes `Deliberation.modelName = 'mock-smart-1'`
  even when the real gpt-4o adapter ran (the `AgentRun` row has the correct model).

**Next — get the agents to actually decide something:**
1. Diagnose the all-HOLD: read the headTrader v0.2.0 prompt + conviction gate.
   Is the BUY bar too high, or are the specialist signals genuinely mid-range?
2. Re-run a backfill over a **trending** window and/or **higher-beta** symbols so
   there's real directional signal to commit on — then see if TradePlans appear.
3. Only once outcomes accumulate do the downstream items (shadow-plan settlement,
   Phase B execution) become meaningful. Fix the `modelName` cosmetic bug en route.

### 2026-04-27 — V2 engine + monorepo + UI dashboard, M0 → M3 + agent perf tracking
*(superseded — describes the old `packages/`-monorepo V2 engine, not the `V2/` console)*

**Shipped:**
- Monorepo restructure: `packages/{shared,engine,api,ui}` with npm workspaces + Turborepo. V1 cron still runs.
- Postgres + Prisma 7 working with `prisma.config.ts` at the engine package root (NOT inside `prisma/`).
- V2 schema additions: `SpecialistAnalysis`, `Deliberation`, `ToolCall`, `TradePlan`, `SectorMap`, `AgentNote`. Migrations applied (`20260427185623_v2_engine_init`, `20260427193917_agent_notes`).
- V2 engine M2 + M3: six specialists + head trader (single-shot, no tools yet) producing TradePlans persisted as `status=proposed`.
- Risk manager V2 with sizing + drawdown ladder (10% halve / 15% close-only / 20% halt) + 2% per-trade cap. 27 unit tests pass.
- HTTP API: `/api/health`, `/api/cycles`, `/api/cycles/:id` (full V2 relations), `/api/portfolio/state|equity-curve|snapshots|outcomes`, `/api/symbols`, `/api/agents`, `/api/agents/:name`, `/api/agents/:name/performance`, `/api/prompts`, `/api/notes` (CRUD), `/api/admin/settle-plans`. Swagger at `/api/docs`.
- UI pages: Dashboard (portfolio + outcomes + recent cycles + Settle button), Cycles list (filterable, paginated), Cycle detail (technicals + 6 specialists + deliberation trace + tool calls + trade plan + V1 evals), Agents list, Agent detail (config + performance + notes CRUD + prompt-version history).
- Settlement simulator (`packages/engine/src/v2/engine/settlePlans.ts`) walks `proposed` BUY plans forward through subsequent bars, deterministically detects stop / target / time-stop, populates `realizedPnl` + `closeReason`. Uses `AlpacaService.getBarsAfter()` (added to interface).
- Smoke test green: 3 V2 cycles for SPY/AAPL/NVDA with full DB writes; UI surfaces all data.

**Mid-flight / not yet done:**
- All V2 cycles to date have come out HOLD because mock-alpaca technicals stay mid-range. Need to either (a) tune mock variability or (b) seed a synthetic BUY plan to populate the win-rate UI.
- The intermediate `getBarsAfter` lookup is implemented for the real Alpaca too, but unverified against the live Alpaca data API since we're in mock mode.

**Next (M4+):**
- M4 — head-trader tool calling: `ToolRegistry`, 10 tools (`get_indicator`, `get_recent_news`, `get_sector_performance`, `get_relative_strength`, `get_correlations`, `get_position_history`, `get_market_regime`, `get_earnings_calendar`, `get_atr_stop_suggestion`, `submit_decision`). Switch `LLMService` to `chatWithTools()`. Persist `ToolCall` rows. Mock LLM scripted tool simulator.
- M5 — TradePlan lifecycle wired into orchestrator (auto-close at start of each cycle for any open plans whose stop/target/time-stop hits the latest bar).
- M6 — Risk manager V2 full features: concentration (max 3 positions), 5% aggregate-risk cap, 40% sector cap, regime gate, no-rebuy cooldown.
- M9 — Backtest harness (V1 vs V2 on a basket of symbols, deterministic mock LLM).

**Pending decisions:**
- LLM provider: currently OpenAI; user open to adding Anthropic adapter (Claude Sonnet 4.6 head trader + Haiku 4.5 specialists). See `memory/project_llm_provider.md`.
- V1 deletion timing — wait until backtest harness shows V2 ≥ V1 on the basket.

## Build & Development Commands

All commands run from the repo root unless noted.

```bash
# Root (turbo-driven across all workspaces)
npm install                         # install all workspaces
npm run build                       # turbo run build --filter=@capitalforge/*
npm test                            # turbo run test --filter=@capitalforge/*
npm run dev                         # turbo run dev --parallel (engine cron + api + ui)
npm run prisma:generate             # delegates to engine package
npm run prisma:migrate              # delegates to engine package
npm run prisma:studio               # delegates to engine package
npm run run-cycle -- --date YYYY-MM-DD       # manual cycle trigger (engine)
npm run docker:up                   # docker compose up -d (postgres + engine + api + ui)
npm run docker:down

# Engine-only
npm run dev -w @capitalforge/engine                # cron loop + ts-node
npm run run-cycle -w @capitalforge/engine -- --date 2026-04-26
npm run settle-plans -w @capitalforge/engine       # counterfactual outcome settler

# API-only
npm run dev -w @capitalforge/api                   # Fastify on :3001 (Swagger UI at /api/docs)

# UI-only
npm run dev -w @capitalforge/ui                    # Vite on :3000
```

Run a single test file: `npx jest packages/engine/src/config.test.ts` (from root).

Switch engines: `ENGINE_VERSION=v2` in `.env` or shell. `MODE=mock` keeps everything deterministic without API keys.

## Architecture

### V2 Daily Cycle (per symbol)

1. Fetch ≥65 daily bars → compute RSI(14), SMA(20/50), MACD(12,26,9), volume vs 30-day avg.
2. Persist `DailyCycle` (engineVersion=v2).
3. Mark sandbox to market.
4. Run **six specialists in parallel** — each emits `{bullishScore, confidence, rationale, flags, keyLevels?, extras?}` validated against `SpecialistOutputSchema`. Persist to `SpecialistAnalysis`.
5. **Head trader** receives all 6 specialist outputs + market context + sandbox state. Single LLM call (M3) → emits a complete `TradePlan` validated against `TradePlanSchema`. Persist `Deliberation` + `TradePlan` (status=`proposed`). M4 adds tool-calling rounds.
6. **Risk manager V2** clamps the plan: caps `riskPctOfEquity` at 2%, halves at 10% drawdown, forces HOLD at 15%+, hard-halts at 20%. Computes `shares = floor((equity × riskPct) / (entry − stop))`.
7. Persist with sandbox snapshot. Trade execution lands in M5/M6.

### Key V2 Modules

- `packages/engine/src/v2/engine/orchestratorV2.ts` — V2 cycle driver, implements `OrchestratorAPI` (also implemented by V1's `Orchestrator`).
- `packages/engine/src/v2/engine/headTrader.ts` — single-shot deliberation + `parseTradePlan()`. M4 will replace with tool-using loop.
- `packages/engine/src/v2/engine/riskManagerV2.ts` — `applySizing()` pure function with drawdown ladder + cash-floor + cap.
- `packages/engine/src/v2/engine/settlePlans.ts` — counterfactual settler. Walks proposed BUY plans forward via `AlpacaService.getBarsAfter()`. Stop-hit / target-hit / time-stop detection.
- `packages/engine/src/v2/specialists/{base,trendRegime,setupPattern,momentum,meanReversion,volumeFlow,newsEvents}.ts` — `Specialist` interface + 6 implementations + `SPECIALIST_ROSTER`.
- `packages/engine/src/v2/prompts/headTrader.ts` — head-trader prompt builder + `computeMeta()` block (machine-readable summary that mock LLM parses; real LLM can ignore it).
- `packages/engine/src/services/llm.ts` — `LLMService` interface adds `completeRaw(prompt)` for V2; V1 still uses `complete()`.
- `packages/engine/src/services/llm.mock.ts` — extended with `[SPECIALIST=name]` and `[HEAD_TRADER]` markers for deterministic mock outputs.
- `packages/engine/src/admin.ts` — public library surface (settler + service factories) consumed by `@capitalforge/api`. Engine's `package.json` `main` points here, NOT the cron entry.
- `packages/shared/src/registry.ts` — `AGENT_REGISTRY` is the single source of truth for agent metadata. Both engine (uses prompt versions) and api/ui (display config) read from here.
- `packages/shared/src/schemas/v2/{specialist,deliberation,toolCall,tradePlan}.ts` — V2 Zod schemas.

### V1 (legacy)

V1 lives at `packages/engine/src/{agents,core,prompts.ts,types.ts}`. All V1 entries in `AGENT_REGISTRY` are tagged `engineVersion: 'v1'`. Don't add features to V1; bug-fix only if a V2 comparison depends on it.

### Database (Prisma 7 + PostgreSQL 16)

Schema at `packages/engine/prisma/schema.prisma`. Generator output is configured to root `node_modules/.prisma/client` so engine + api both consume the same client.

V1 tables: `DailyCycle`, `AgentEvaluation`, `AggregatedDecision`, `Trade`, `SandboxState`, `PromptVersion`.
V2 tables (additive): `SpecialistAnalysis`, `Deliberation`, `ToolCall`, `TradePlan`, `SectorMap`, `AgentNote`.
`DailyCycle.engineVersion` distinguishes which children to expect.

### Service Abstraction

`AlpacaService`, `LLMService`, `NewsService` — interfaces with real + mock implementations. `MODE=mock|paper` selects which. Mock implementations are deterministic for reproducible tests.

### Shared Wallet / Sandbox

A single `$2000` (default) wallet is shared across all symbols. The sandbox is loaded once per cycle batch and threaded through each symbol sequentially. V1 enforces 1-position-max in `riskManager.ts`. V2 will enforce 3-positions-max + concentration limits in M6.

## Environment Setup

Copy `.env.example` to `.env`. For mock mode the API keys can be placeholders. Postgres connects via `localhost:5432` from host; `docker-compose.yml` overrides to the internal hostname for in-container services.

## Tech Stack

- Node.js ≥18, TypeScript 5.7 (strict, ES2022, CommonJS for engine/api; ESNext bundler for UI)
- npm workspaces + Turborepo
- Prisma 7.x + `@prisma/adapter-pg` + `pg`, PostgreSQL 16
- OpenAI SDK (GPT-4o today; Anthropic adapter on the side-quest list), Zod everywhere
- Fastify 5 + `@fastify/swagger` + `fastify-type-provider-zod`
- Vite 6 + React 18 + React Router 6 + TanStack Query 5 + Recharts (planned)
- Jest + ts-jest
- Docker + Docker Compose

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

### RULE-003: `prisma.config.ts` must live at the package root, NOT inside `prisma/`
**Mistake:** Placed `prisma.config.ts` at `packages/engine/prisma/prisma.config.ts` (next to the schema). Prisma CLI silently ignored it; `prisma migrate dev` errored "datasource.url is required" even though my code set it.
**Fix:** Put `prisma.config.ts` at the package root (e.g. `packages/engine/prisma.config.ts`, sibling to `package.json`). Prisma's c12-based loader looks at the project root, not the schema directory.

### RULE-004: `@prisma/config` exports `defineConfig` as a NAMED export
**Mistake:** Wrote `import defineConfig from '@prisma/config'` (default). Got `(0 , import_config2.default) is not a function` at config-load time.
**Fix:** `import { defineConfig } from '@prisma/config'`. Same goes for `env()` if you use it.

### RULE-005: Side-effect imports may not run before `defineConfig` reads `process.env`
**Mistake:** Tried `import 'dotenv/config';` at the top of `prisma.config.ts` to load env before `defineConfig({ datasource: { url: process.env.DATABASE_URL } })`. Sometimes process.env was empty by the time defineConfig saw it.
**Fix:** Inline the dotenv call as a regular expression — `dotenv.config({ path: path.resolve(__dirname, '../..', '.env') })` — at the very top of the module body, before importing `@prisma/config`. Then read `process.env.DATABASE_URL` and throw if missing so failure is loud.

### RULE-006: Cross-package source imports break tsc `rootDir`
**Mistake:** From the api package, did `import { settleProposedPlans } from '../../../engine/src/v2/...'`. TS6059: "File ... is not under 'rootDir'". Each leaf package's `rootDir` is its own `src/`.
**Fix:** Add the source package as a workspace dependency (`"@capitalforge/engine": "*"`) and import via the package name. Engine's `package.json` `main` should point to a thin admin/library entry (`packages/engine/src/admin.ts`) that re-exports only the symbols other packages may consume — NOT the cron entry.

### RULE-007: `turbo run` needs an explicit filter to span all workspaces
**Mistake:** `npm run build` invoked `turbo run build` and only built one package. Turbo silently scoped to "current package" with no filter.
**Fix:** In root `package.json`, write `"build": "turbo run build --filter=@capitalforge/*"` (and same for `test`, `dev`, `lint`). Turbo also requires a `packageManager` field in the root `package.json` to resolve workspaces.

### RULE-008: Prisma generator client output must be explicit in a monorepo
**Mistake:** Default `prisma generate` placed the client in `packages/engine/node_modules/.prisma/client`, which `@capitalforge/api` couldn't resolve.
**Fix:** Set `output = "../../../node_modules/.prisma/client"` on the `generator client` block so the client lands in the root `node_modules`. Both engine and api then resolve `@prisma/client` to the same generated artifact.

### RULE-009: Mock Alpaca needs to oversample calendar days for trading-day counts
**Mistake:** Mock generated `limit` calendar days then skipped weekends, returning ~70% of `limit` trading days. Technical indicators failed with "Insufficient data: need at least 50 bars, got 42".
**Fix:** In `generateDeterministicBars`, oversample: `calendarDays = Math.ceil(limit * 1.5) + 10` so post-weekend filtering still leaves ≥`limit` bars. Same pattern in `generateBarsAfter`.

### RULE-010: V2 SpecialistOutputSchema requires ≥2 rationale entries
**Mistake:** Mock specialist generators occasionally returned a single-string rationale, failing `z.array(z.string()).min(2).max(6)` validation downstream.
**Fix:** Every code path in mock specialist generators MUST push ≥2 rationale strings. When in doubt, add a second supporting line ("trail existing position", "wait for confirmation", etc.). The schema enforces minimum signal richness on purpose.

### RULE-011: Each leaf package needs its own dotenv load if it ships its own entry
**Mistake:** Engine's `src/index.ts` did `dotenv.config()` which only loads `packages/engine/.env`. The monorepo `.env` lives at root, so config validation failed in `npm run dev -w @capitalforge/engine` until env was duplicated.
**Fix:** Use `dotenv.config({ path: path.resolve(__dirname, '../../../.env') })` from any package entry that needs the root `.env`. Single source of truth at repo root; per-package overrides only when truly needed.
