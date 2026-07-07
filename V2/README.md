# CapitalForge V2 — Agent Audit Console

A clean rewrite focused on **observing, auditing, and improving** the AI agents that
make trading decisions. Not a Docker-first project — every piece runs locally with
Node, Postgres, and `npm`.

> Why a rewrite? V1 and the existing `packages/` monorepo are about *making* trades.
> V2 is about *understanding* the agents that make them. Different goal, cleaner
> schema, no legacy baggage.

> **Postgres runs in Docker** (`cd V2 && docker compose up -d postgres`). The
> backend and frontend still run locally via `npm run dev`; only the database is
> containerized, so data lives in the managed `cf_v2_pgdata` volume instead of a
> local Postgres install. The container (`capitalforge-v2-db`) owns host port 5432.
>
> ⚠️ Run compose **from `V2/`**, not the repo root — the root `docker-compose.yml`
> is the legacy `packages/` monorepo stack. Operational commands and a full
> troubleshooting runbook (the "file cannot be accessed by the system" / WSL boot
> failure and its fix) live in **[`DOCKER.md`](DOCKER.md)**.

---

## Stack

| Layer       | Tech                                                          | Port |
|-------------|---------------------------------------------------------------|------|
| Database    | PostgreSQL 16 + Prisma 7                                      | 5432 |
| Backend     | Node.js 18+, Fastify 5, TypeScript, Zod                       | 4000 |
| Frontend    | Vite 6, React 18, React Router 6, TanStack Query 5, Recharts  | 4001 |
| Market data | Alpaca (paper) — reused from V1                                | —    |
| LLM         | OpenAI / Anthropic (provider-agnostic adapter)                 | —    |

Postgres in Docker (DB only). No Turborepo. Just `npm` workspaces for the app.

---

## Why audit-first?

The hard problem with multi-agent LLM systems is not *running* them — it's knowing
whether they're getting better or worse over time. Models drift. Prompts change.
Markets regime-shift. Without instrumentation, you cannot tell silent decay from
noise.

V2 records **every LLM invocation** as an `AgentRun` with:

- `inputHash` — fingerprint of the rendered prompt for replay & stability checks
- `promptVersionId` — which version of the template produced this
- `modelName`, `temperature` — provider + config snapshot
- `latencyMs`, `tokensIn`, `tokensOut`, `costUSD`
- `rawResponse`, `parsedOutput`, `schemaValid`, `parseError`

From this single table, every audit view in the UI is a query.

---

## Audit dimensions surfaced in the UI

1. **Prompt lineage** — every `AgentRun` ties to a `PromptVersion`. Diff viewer
   across versions. Performance metrics per version side-by-side.
2. **Hit rate & expectancy** — by agent, by regime, by setup, by prompt-version.
3. **Calibration** — Brier score + reliability curve. Does a stated 0.8 confidence
   actually win 80% of the time?
4. **Disagreement & influence** — agreement matrix between specialists. How often
   does the head trader side with each specialist? Counterfactual: would the
   action have changed if this specialist were absent?
5. **Schema validity** — JSON-parse / Zod-validation failure rate per agent per
   prompt-version.
6. **Latency, tokens, cost** — p50/p95/p99 per agent + per model.
7. **Drift** — rolling 30-day hit-rate per prompt-version. Catches silent decay.
8. **Stability** — replay the same input with the same prompt and the same model;
   record output variance. (A specialist that gives wildly different scores for
   the same input has a problem.)
9. **Tool-use efficacy** — for tool-using agents (head trader): which tools, how
   often, did the call change the action vs. the no-tool baseline?
10. **Adversarial critique** — `riskAuditor` and `devilsAdvocate` track agents
    explicitly. When their objections are loud and the trade loses, that's
    confirmation; when they're loud and the trade wins, that's calibration
    feedback for them.

---

## Agents in V2

Carried over from V1's V2 head-trader-and-specialists pattern (see
`packages/shared/src/registry.ts` for prompts), plus five new ones aimed at
keeping the head trader honest:

### Specialists (run in parallel per cycle)

| Name              | Role                                                     | New? |
|-------------------|----------------------------------------------------------|------|
| `trendRegime`     | Bull/bear, trending/choppy, Stage 1–4                     |      |
| `setupPattern`    | Named swing setups + A/B/C grade                          |      |
| `momentum`        | RSI/MACD with accelerating/steady/fading/exhausted state  |      |
| `meanReversion`   | Extension-from-mean + revert probability                  |      |
| `volumeFlow`      | Accumulation vs distribution                              |      |
| `newsEvents`      | Catalyst + earnings-window + sentiment                    |      |
| `macroContext`    | Rates, dollar, sector rotation, breadth                   | ✨   |
| `liquiditySlippage` | Bid/ask spread, $-volume, fill realism at size          | ✨   |

### Decision layer

| Name              | Role                                                     | New? |
|-------------------|----------------------------------------------------------|------|
| `headTrader`      | Reads all specialists, calls tools, emits `TradePlan`     |      |
| `riskAuditor`     | Independent reviewer scores plan's risk discipline        | ✨   |
| `devilsAdvocate`  | Adversarial red-team argues *against* the plan            | ✨   |

### Post-cycle

| Name              | Role                                                     | New? |
|-------------------|----------------------------------------------------------|------|
| `critic`          | Reviews reasoning trace after outcome is known, writes critiques to feed prompt iteration | ✨ |

The `critic` is the key audit loop: when a trade closes, it re-reads the entire
reasoning trace with the outcome known and notes what the head trader missed or
overweighted. Those critiques are queryable and feed prompt iteration.

---

## Getting started

```bash
# from V2/
npm install
cp .env.example .env                                 # fill in DATABASE_URL, ALPACA_*, LLM_*
docker compose up -d                                 # start Postgres (container owns :5432)
npm run prisma:migrate -w @cf2/backend               # apply schema
npm run prisma:seed -w @cf2/backend                  # seed agent registry + prompt versions
npm run dev                                          # starts backend (:4000) + frontend (:4001)
```

Open http://localhost:4001 — the dashboard lands first.

**Deploying** (full containerized stack — DB + backend + frontend, with the
daily scheduler): see **[DEPLOY.md](DEPLOY.md)**. TL;DR:
`docker compose -f docker-compose.prod.yml up -d --build`.

---

## Layout

```
V2/
├── prisma/                Prisma schema (single source of DB truth)
│   ├── schema.prisma
│   └── seed.ts
├── backend/               Fastify API
│   └── src/
│       ├── server.ts        entrypoint
│       ├── env.ts           zod-validated env
│       ├── db.ts            Prisma client singleton
│       ├── routes/          one file per resource
│       ├── services/        Alpaca, LLM, metrics
│       └── audit/           calibration, drift, agreement, influence, anomalies
└── frontend/              Vite + React UI
    └── src/
        ├── routes/          one file per page
        ├── components/      charts, tables, layout
        ├── api/             typed query hooks
        └── lib/             api client, formatters
```

---

## Run-cycle vs analyze

V2 is read-only against the agent system by default. To populate it you can:

1. **Point at the V1 database** — set `DATABASE_URL` to the same Postgres as
   `packages/engine`. The schemas live in separate Prisma projects but share
   tables via `model` mappings; the V2 schema only adds tables, never alters V1's.
2. **Or run V2 standalone** — V2 ships its own runner (`scripts/run-cycle.ts`)
   that exercises the V2 audit-instrumented pipeline against a fresh DB. Same
   agents, but every LLM call is recorded with full audit fields.

Pick standalone while you're learning the pieces; switch later.

---

## Iterating on agent prompts

Prompts are versioned in the DB (`PromptVersion`, one row per agent per version,
exactly one `isActive`). The runner reads the active version at cycle time, so a
new prompt only takes effect once it's **activated in the DB** — editing the
`.ts` file is not enough.

```bash
# from V2/ — register + activate a new version (deactivates prior ones)
npx tsx scripts/upgrade-prompt.ts headTrader 0.4.0
npx tsx scripts/upgrade-prompt.ts all 0.2.0        # bump every agent at once

# verify what's live
docker exec capitalforge-v2-db psql -U postgres -d capitalforge_v2 -tA -c \
  'select a.name, pv.version from "PromptVersion" pv join "Agent" a on a.id=pv."agentId" where pv."isActive";'
```

New prompt versions live in `backend/src/prompts/<agent>.v<x.y.z>.ts` and are
wired into the `REGISTRY` array in `scripts/upgrade-prompt.ts`.

> **Active head trader: v0.4.0.** Serializes the *full* specialist payload
> (`bullishScore, confidence, flags, rationale, keyLevels, extras`) into the
> prompt so the head trader can actually read the `extras.*` fields its veto /
> conflict rules reference — earlier versions were told to enforce rules over data
> the runner wasn't sending. Pairs with the matching change in
> `backend/src/runner/cycleRunner.ts`.

## Backfill (accumulate sample size)

Runs cycles over a date range × symbol list so the audit pipeline gets real
sample size in one batch. **Resumable** — skips `(date, symbol)` pairs that
already have a completed `Cycle`, so a crash just picks up where it left off.

```bash
# from V2/ — real LLM (MODE=paper + OPENAI_API_KEY). ~$0.05–0.09 per cycle.
npx tsx scripts/backfill.ts --symbols AMD,NVDA --start 2026-06-01 --end 2026-06-08
npx tsx scripts/backfill.ts --symbols AMD,NVDA --start 2026-06-01 --end 2026-06-08 --dry-run
```

Cost scales with cycle count (8 specialists + head trader + reviewers + critic per
cycle). Use `--dry-run` first to see the plan and how many pairs are already done.

> **Known cosmetic bug:** `Deliberation.modelName` is hardcoded to `mock-smart-1`
> even when real gpt-4o ran — the correct model is recorded on the `AgentRun` row.
> Don't trust `Deliberation.modelName`; query `AgentRun.modelName`/`provider`.
