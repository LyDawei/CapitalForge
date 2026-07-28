# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project Overview

CapitalForge is an AI-powered trading **audit console** — a system for
observing, auditing, and improving the AI agents that make trading decisions,
not just running them blind. Eight specialists (`trendRegime`, `setupPattern`,
`momentum`, `meanReversion`, `volumeFlow`, `newsEvents`, `macroContext`,
`liquiditySlippage`) run in parallel per cycle; a `headTrader` agent reads all
eight and emits a `TradePlan`; two adversarial reviewers (`riskAuditor`,
`devilsAdvocate`) and a post-cycle `critic` check its work; a `growthScout`
pipeline proposes watchlist additions. Every LLM call is recorded as an
`AgentRun` (inputHash, promptVersion, model, latency, tokens, cost,
rawResponse, parsedOutput, schemaValid) so drift, calibration, and hit-rate are
queryable rather than anecdotal.

> **2026-07-28: this *is* the whole project now.** What used to be a separate
> `V2/` console living alongside a legacy `packages/` npm-workspaces monorepo
> (V1's four-agent system, plus an earlier abandoned mid-2026 rewrite) has been
> promoted — lifted out of `V2/` to become the repo root, with `packages/` and
> all V1 code deleted outright. Older "Last Worked On" entries below that
> reference `V2/`-prefixed paths predate this move; the content is unchanged,
> just living at repo root now instead of nested under `V2/`.

Not a Docker-first project for day-to-day dev — Postgres runs in Docker
(`docker compose up -d postgres`), backend (Fastify, :4000) and frontend
(Vite, :4001) run locally via `npm run dev`. See **README.md** for the
stack/audit-dimensions overview, **TODO.md** for the live roadmap and
promotion-readiness bar, **DEPLOY.md** for the Pi5/production cutover runbook,
and **DOCKER.md** for the Postgres-in-Docker operational runbook.

## Last Worked On

Append-only log of work sessions, **most recent first**. Each entry: what shipped, what's mid-flight, what's next. Update at the end of each working session so future Claude (and David) can resume without spelunking.

> **Process rule (2026-07-07):** log this section **before every commit**, not just
> at session end. No commit without a matching "Last Worked On" entry first.

### 2026-07-28 (c) — dashboard/app-wide charts + plain-language tooltips

**Ask:** the frontend (especially the Dashboard) showed a lot of raw numbers with
no visual representation; separately, David (a software engineer, not a finance
person) flagged that several metrics — the specialist agreement matrix
specifically — weren't self-explanatory.

**Shipped — charts** (Recharts `^2.13.0` was already a dependency, used
previously in exactly one place, `CalibrationChart.tsx`; no backend changes
needed anywhere):
- **Dashboard**: wallet balance line chart (`WalletBalanceChart.tsx`, exact
  running balance reconstructed backward from the wallet's authoritative
  `SUM()` balance — no new endpoint), cycle activity diverging bar chart
  (`CycleActivityChart.tsx`, BUY/SELL per day), per-agent hit-rate horizontal
  bar chart (`PredictionHitRateChart.tsx`), and a compact specialist-agreement
  heatmap reusing `AgreementMatrix.tsx`.
- **Agent Detail**: drift multi-line chart (`DriftChart.tsx`, rolling hit-rate
  per prompt version — data was already fetched, previously only shown as a
  truncated table) and a stability scatter (`StabilityScatterChart.tsx`,
  score/confidence variance under replay — same story, fetched but never
  rendered).
- **Trades**: win/loss/breakeven KPI tiles + cumulative P&L line chart
  (`TradesPnlChart.tsx`).
- **Bug fixed along the way**: `AgreementMatrix.tsx`'s color scale was a
  red→green lerp implying good/bad polarity; agreement is actually a 0–100%
  magnitude, so it's now a sequential blue ramp with a scale legend.
- Chart colors were validated against the app's real dark panel surface
  (`#131722`) using the `dataviz` skill's `validate_palette.js`, not eyeballed.

**Shipped — plain-language explanations:** new `InfoTooltip.tsx` (hover `(i)`
icon, dark-theme styled, `align` prop to avoid clipping near table edges —
needed a fix for the Trades page's rightmost "R" column) added next to every
non-obvious metric across Dashboard, Cycles, Cycle Detail, Trades, and Agent
Detail (conviction, R-multiple, risk %, schema fail rate, Brier score,
influence, stability stdev, specialist agreement).

**Two real bugs caught during review, both fixed:**
1. A pre-existing React key-prop warning in `AgreementMatrix.tsx` (unkeyed
   `<>` fragment per matrix row).
2. **Recharts' default tooltip *item* text renders black**, invisible on this
   dark theme, unless `itemStyle`/`labelStyle` are set explicitly — surfaced
   visibly only on the Agent Hit Rate chart (its `<Bar>` has no own `fill`,
   colors come from per-`Cell` overrides, so Recharts had nothing to inherit
   from and fell back to black) but was a latent bug in every chart's
   copy-pasted `contentStyle`, including the pre-existing `CalibrationChart`.
   Fixed in all 7 chart components.

**Also corrected:** the agreement-matrix caption/tooltip copy was actively
misleading — it read "high = redundant, low = orthogonal," implying 0% is the
independence baseline. It isn't: **~50% is the "no relationship" point**
(independent signals agree by chance about half the time); near 0% means
*systematically opposite* calls, which is its own strong relationship, not
healthy diversity. Copy fixed in both `Audit.tsx` and the Dashboard's compact
card tooltip to explain this correctly, plus that there's no universal target
— expected agreement is pair-specific (e.g. momentum↔trendRegime running high
is two trend-following lenses correctly agreeing, not redundancy to fix).

**Verified:** `tsc --noEmit` clean, `npm test` 115/115 passing (no backend
touched), frontend production build succeeds. Visually verified every chart
and tooltip via a temporary headless-Chromium/Playwright install (browser
tools weren't enabled this session) against real dev data — installed and
fully removed afterward, not a new project dependency.

**Not done:** no backend changes were needed or made. Wallet balance chart's
x-axis currently shows repeated dates because all 112 existing wallet
transactions share one real-world timestamp (from when a backfill script ran)
despite representing trades across different simulated dates — a data
characteristic that will resolve naturally as the scheduler accrues real
day-by-day activity, not a chart bug.

### 2026-07-28 (b) — confirmed V1 already off in prod; removed leftover image

**Ask:** shut down V1 since only V2 is wanted now. Investigated this host
(`baymax`, the Pi5 — confirmed via `uname`/hostname, not a separate deploy
target) before touching anything: `docker ps -a`, `docker compose ls`,
`crontab -l`, `systemctl list-units`, `ps aux`, and `ss -tlnp` all agree —
**V1 has no footprint here.** No `capitalforge-engine`/`-api`/`-ui` containers
(running or exited), no V1 node process, no crontab/systemd timer, nothing
listening on :3000/:3001 (V1's ports).

**Bigger finding: V2's prod stack was already live.** `docker compose ls`
shows project `v2` running 3 containers (`capitalforge-v2-db`,
`-backend`, `-frontend`) via `docker-compose.prod.yml`, up for **3 days** on
:4000/:4001/:5432 — i.e. the Pi5 cutover that the 2026-07-07(b) entry listed as
a **Next** item, and that this session's earlier "Known follow-up" note
assumed was still pending, had in fact *already happened* before today,
untracked in this log. (Compose still remembers the file at its pre-move path,
`/home/lydawei/CapitalForge/V2/docker-compose.prod.yml` — cosmetic only, the
running containers are unaffected; a future redeploy from this repo will
naturally pick up the new root path.)

**Action taken:** removed the one real V1 leftover found — a dangling, 4-month-old,
zero-containers-attached `capitalforge-app:latest` image (`docker rmi`). Nothing
else to shut down; V1 was already fully off.

**Correction to this session's earlier note:** the "Known follow-up (not part
of this file-restructuring pass)" paragraph below (in the entry directly under
this one) says the Pi5 cutover was "not yet executed" — that was true when
written, based on the doc trail, but turned out to be stale by the time this
host was actually checked. V1 retirement in production is done.

### 2026-07-28 — V2 promoted to repo root; `packages/` (V1) deleted

**What happened:** per David's decision, `V2/`'s Agent Audit Console is now
*the* product. Lifted every file out of `V2/` to the repo root via `git mv`
(history preserved — `git log --follow` still works on moved files), including
in-flight uncommitted work (`prisma/migrations/20260724000001_broker_order_tracking/`,
`scripts/deployment/`, modified `cycleRunner.ts`/`alpaca.*.ts`). Deleted
outright: the entire `packages/` npm-workspaces tree (V1's four-agent system
plus the earlier, already-abandoned `packages/engine` V2 rewrite), root
Turborepo/Docker/Prisma scaffolding that only existed to support it
(`turbo.json`, `Dockerfile.{engine,api,ui}`, root `docker-compose.yml`, root
`prisma/` — a third, orphaned pre-monorepo migration history), and stale docs
(`AGENTS.md`, `ARCHITECTURE.md` — both described the long-gone flat
pre-monorepo `src/` layout). CLAUDE.md's Project Overview / Build Commands /
Architecture / Tech Stack sections were rewritten to describe the now-flat
repo; this "Last Worked On" log and the Self-Correction Rules below were left
untouched.

**Not done here — separate concern:** the Pi5 production host still runs V1
today via its own checked-out Docker Compose stack. This session only removed
V1 from the *git repo*; the actual production cutover is still `DEPLOY.md`'s
Pi5 runbook (`scripts/deployment/`), not yet executed. Don't read this entry
as "V1 is off in prod" — it isn't, yet.

**Also worth flagging:** V2's own validation bar (per `TODO.md`, ~60
directional samples before trusting any edge) has not been cleared — current
data is a single 42-cycle backfill window with 4 BUY trades (4/4 winners, but
n=4, explicitly noted elsewhere as "profitability completely unproven").
Promoting V2 to be *the* codebase is a separate decision from V2 being
*validated*; this session did the former only.

### 2026-07-07 (c) — secret-scan follow-up: default Postgres password (false positive)

**Trigger:** a secret-scan email (public repo) flagged `feature/V2` commit
`467f666`, file `docker-compose.prod.yml`. **Diagnosis: false positive** — the
match was the literal `postgres` in
`postgresql://postgres:${POSTGRES_PASSWORD:-postgres}@…` (default Postgres
password, internal-network only, env-overridable). No real credential.

**What I verified first (full git secret sweep):** OpenAI + Alpaca keys → 0 git
objects ever (they live only in gitignored `V2/.env`). Real FRED/FINNHUB keys →
existed only as an **orphaned, uncommitted `git add` blob** (root `.env.example`
staged with real keys at some point, never committed to any branch, never
pushed). Purged it via `git reflog expire --expire-unreachable=now --all` +
`git gc --prune=now` (verified 0 objects after). No `.env` ever tracked. Native
GitHub secret-scanning is disabled on the repo, so the email was a
partner/3rd-party scanner.

**Fix (hygiene, since public repo):** removed the literal default password from
both tracked compose files — now `${POSTGRES_PASSWORD:?…}` (required, no literal
fallback) + `${POSTGRES_PASSWORD}` in the URI. Password sourced from
`POSTGRES_PASSWORD` in gitignored `V2/.env` (value kept `postgres` to match the
existing `cf_v2_pgdata` volume, fixed at init — changing it would break auth).
Documented in `.env.example`. Both composes verified to still interpolate.

**Still recommended (not done — needs David):** rotate FRED + Finnhub keys as
cheap insurance (free; public repo). They were never pushed from this repo, but
rotation is the only real remediation if they ever leaked another way.

**Also this session — the git divergence:** `feature/V2` had been rewritten
out-of-band (an external tool left a paused interactive rebase in
`.git/rebase-merge`; all SHAs differed from origin with identical messages). My
push rebased 2 real commits (deploy + a Settings.tsx percent-slider fix that was
on master/UI-bugs but missing from feature/V2) onto origin tip; verified tree
byte-identical to my work before pushing. No force-push, nothing lost.

### 2026-07-07 (b) — deployability: in-process scheduler + full-stack containers + DEPLOY.md

**Context:** groundwork for deploying V2 to a Pi5, **replacing** V1 (which
already runs there via Docker Compose with a built-in cron). Goal: same
`docker compose up` workflow David already knows.

**Shipped:**
- **In-process daily scheduler** (`backend/src/runner/scheduler.ts`, wired into
  `server.ts`). Mirrors V1's built-in cron — no host crontab/systemd timer. On
  fire it runs one cycle per symbol in the active strategy's watchlist
  (`StrategyConfig.watchlist`, latest row) **sequentially** (shared wallet),
  overlap-guarded. Gated by env: `ENABLE_SCHEDULER` (default false — dev/CI
  never auto-fire paid cycles), `SCHEDULE_CRON` (default `30 16 * * 1-5`),
  `SCHEDULE_TZ` (default `America/New_York`, so host locale is irrelevant), and
  `RUNNER_DRY_RUN` (default true — forward-looking gate for Phase B order exec;
  cycles are analysis-only today). New `envBool` helper in `env.ts` (avoids the
  `z.coerce.boolean("false") === true` trap). Verified at runtime: armed /
  disabled / invalid-cron paths all log correctly.
- **Full-stack containerization** (Pi5 arm64-ready):
  - `backend/Dockerfile` (+ `docker-entrypoint.sh` runs `prisma migrate deploy`
    then `node dist/server.js`; dummy `DATABASE_URL` satisfies `prisma.config.ts`
    during build since generate never connects).
  - `frontend/Dockerfile` + `nginx.conf` — builds the SPA with an **empty**
    `VITE_API_BASE_URL` (client keeps `""` because it uses `?? default`, only
    nulls fall back) so `/api` calls are same-origin; nginx serves `dist/` and
    proxies `/api`+`/docs` to `backend:4000`. One origin, no CORS.
  - `docker-compose.prod.yml` — postgres + backend + frontend; reuses the
    existing `v2_cf_v2_pgdata` volume; overrides `DATABASE_URL` to the in-network
    host and defaults `ENABLE_SCHEDULER=true`. `.dockerignore` keeps host
    `node_modules` (x86 binaries) out of the image.
  - `node-cron` added to backend deps.
- **Verified the whole stack end-to-end in containers** (on the Windows dev box,
  amd64): built both images, brought the stack up against the real volume —
  entrypoint migrated (no-op, 12 migrations present), API ready, scheduler armed
  with real `.env`, nginx `:4001/api/health` proxied to the backend, 118 cycles
  intact through the proxy. Then torn down and reverted to the dev DB-only stack
  (didn't leave an armed scheduler running — it'd fire a paid cycle at 4:30pm ET).
- **Docs:** new `V2/DEPLOY.md` (dev-vs-prod, Windows rehearsal, Pi5 cutover
  replacing V1, `pg_dump`/`pg_restore` data migration, arm64 notes, day-2 ops,
  scheduler); README "Getting started" points to it; `.env.example` documents
  the scheduler vars.

**Mid-flight / notes:**
- Prod stack tested on amd64, **not yet on real arm64** — the Pi5 build is the
  first true ARM exercise. Low risk: base images are multi-arch and Prisma's pg
  driver adapter means no query-engine binary to port, but it's unproven metal.
- Scheduler `runDailyCycle` core is the exact `runCycle` the validated backfill
  uses, but a full scheduled fire (whole watchlist, real LLM spend) wasn't
  triggered — only the arm/disable wiring was runtime-verified.
- Backend image is ~1.3 GB (keeps devDeps so backfills/seeds/prompt-upgrades run
  in-container). Fine for a Pi5+SSD; trim later if it matters.

**Next:**
1. Actually deploy on the Pi5 (build arm64, `pg_dump`→`pg_restore` the 118
   cycles, cut over from V1). DEPLOY.md is the runbook.
2. Standing validation items unchanged: BUY-seeking window to confirm v0.4.0
   commits, then wider backfill for sample size.
3. Still-open cosmetic: `Deliberation.modelName='mock-smart-1'` hardcode.

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

All commands run from the repo root.

```bash
npm install                    # install both workspaces (backend, frontend)
npm run dev                    # backend (tsx watch, :4000) + frontend (Vite, :4001) in parallel
npm run dev:backend            # backend only
npm run dev:frontend           # frontend only
npm run build                  # backend tsc + frontend vite build
npm test                       # backend Jest suite
npm run prisma:generate        # generate Prisma client (backend)
npm run prisma:migrate         # apply local DB migrations (backend)
npm run prisma:studio          # Prisma Studio
npm run prisma:seed            # seed script
npm run run-cycle              # manual single-cycle trigger
npm run seed-cycles            # seed backfilled cycles

docker compose up -d postgres  # Postgres only — backend/frontend still run locally
```

Run a single backend test file: `npx jest backend/src/runner/technicals.test.ts` (from root).

Switch LLM provider/model via `.env` (`LLM_PROVIDER`, `LLM_MODEL`,
`LLM_MODEL_SPECIALIST`). `MODE=mock` keeps everything deterministic without
real API keys.

## Architecture

Source of truth is **README.md** (stack, audit dimensions, schema) and
**TODO.md** (roadmap, promotion-readiness criteria). Key source directories:

- `backend/src/runner/` — `cycleRunner.ts` (per-symbol daily cycle driver),
  `agentRunner.ts` + `agentFeeds.ts` (LLM invocation + audit-trail recording),
  `scheduler.ts` (in-process daily cron, gated by `ENABLE_SCHEDULER`),
  `settler.ts` (counterfactual TradePlan outcome settlement), `growthScout.ts`
  (watchlist-proposal pipeline).
- `backend/src/prompts/` — versioned prompt templates per agent
  (`<agent>.v<major>.<minor>.<patch>.ts`); registered/activated via
  `scripts/upgrade-prompt.ts`.
- `backend/src/audit/` — drift, calibration, agreement, influence, stability,
  anomaly detection over `AgentRun` history.
- `backend/src/routes/` — Fastify route handlers, one file per resource.
- `backend/src/services/` — external integrations: `alpaca.real.ts`/`alpaca.ts`
  (market data + orders), `finnhub.ts` (news/fundamentals), `fred.ts` (macro),
  `llm.openai.ts`/`llm.ts` (provider-agnostic LLM adapter), `wallet.ts`
  (persistent sandbox wallet ledger).
- `prisma/schema.prisma` — DB schema (Prisma 7 + `@prisma/adapter-pg`).
- `frontend/src/routes/` — one file per UI page (Dashboard, Cycles, CycleDetail,
  Agents, AgentDetail, Prompts, Audit, Trades, Wallet, Watchlist, Feeds,
  Settings).

## Environment Setup

Copy `.env.example` to `.env`. For mock mode (`MODE=mock`), API keys can be
placeholders. Postgres runs in Docker (`docker compose up -d postgres`) and
owns host port 5432 — see **DOCKER.md** for the full runbook and
troubleshooting if Docker Desktop won't boot.

## Tech Stack

- Node.js ≥18, TypeScript 5.7 (strict)
- npm workspaces (`backend`, `frontend`) — no Turborepo, no `packages/`
- Prisma 7.x + `@prisma/adapter-pg` + `pg`, PostgreSQL 16
- LLM: OpenAI (gpt-4o head trader / gpt-4o-mini specialists) and Anthropic,
  provider-agnostic via `LLM_PROVIDER`. Zod everywhere.
- Fastify 5 + `@fastify/swagger` (Swagger UI at `/docs`) + `fastify-type-provider-zod`
- Vite 6 + React 18 + React Router 6 + TanStack Query 5 + Recharts
- Jest + ts-jest
- Docker Compose for Postgres (dev) and full-stack (prod, `docker-compose.prod.yml`)

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
