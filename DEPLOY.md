# V2 — deployment runbook

Two ways to run V2:

| Mode | Command | What runs where |
|------|---------|-----------------|
| **Dev** | `docker compose up -d postgres` + `npm run dev` | Postgres in Docker; backend/frontend local with hot reload. |
| **Prod** | `docker compose -f docker-compose.prod.yml up -d --build` | Everything containerized: Postgres + backend (API + scheduler) + frontend (nginx). |

The prod stack is the deployment target (your Pi5). It mirrors how V1 runs — a
single `docker compose up` — and adds the one thing V2 was missing: an
in-process daily scheduler (see [the scheduler](#the-scheduler)).

```
                    ┌────────────────────────────────────┐
  browser ──:4001──►│ frontend (nginx)                   │
                    │   /        → static SPA            │
                    │   /api,/docs → proxy ─┐            │
                    └───────────────────────┼────────────┘
                                            ▼
                    ┌────────────────────────────────────┐
                    │ backend (Fastify :4000)            │
                    │   + in-process daily scheduler     │
                    └───────────────────┬────────────────┘
                                        ▼
                    ┌────────────────────────────────────┐
                    │ postgres :5432  (vol cf_v2_pgdata) │
                    └────────────────────────────────────┘
```

---

## 1. Rehearse the prod stack on your dev box

Prove the containerized stack before touching the Pi. Same command runs on both.

```bash
cd V2
cp .env.example .env          # fill in OPENAI/ALPACA/FRED/FINNHUB keys,
                              # set MODE=paper and LLM_PROVIDER=openai for real runs
docker compose -f docker-compose.prod.yml up -d --build
```

- Dashboard: <http://localhost:4001>
- API / Swagger: <http://localhost:4000/docs>

**First-time-only, on a fresh (empty) database — seed the agent registry:**
```bash
docker compose -f docker-compose.prod.yml exec backend npm run prisma:seed
```
(The backend entrypoint runs `prisma migrate deploy` automatically on every
boot, so the *schema* is always current — but seeding the agents/prompts is a
deliberate one-time action. Skip this if you're restoring existing data in
§3.)

Tear down (data persists in the volume):
```bash
docker compose -f docker-compose.prod.yml down
```

---

## 2. Move it to the Pi5 (replacing V1)

The Pi already runs V1 via Docker Compose, so the muscle memory is identical.
V2 uses ports **4000/4001** vs V1's 3000/3001, so the two can coexist during
cutover — no rush to kill V1 the instant V2 comes up.

```bash
# on the Pi
cd ~/CapitalForge          # wherever the repo lives
git pull
cd V2
cp .env.example .env        # put your real keys here; chmod 600 .env
docker compose -f docker-compose.prod.yml up -d --build
```

`docker compose` pulls the **arm64** variants of `node:20-bookworm-slim`,
`postgres:16-alpine`, and `nginx:1.27-alpine` automatically — the Dockerfiles
are arch-agnostic. Prisma's `pg` driver adapter means there's **no
platform-specific query engine** to fight on ARM (the usual Node-on-Pi
headache); you're clear of it.

Then either **seed fresh** (§1) or **restore your dev data** (§3, recommended —
keeps your 117 cycles, wallet ledger, and the active headTrader v0.4.0).

**Decommission V1** once V2 has run a few clean cycles:
```bash
cd ~/CapitalForge/packages   # or wherever V1's compose lives
docker compose down
```

### Pi5 notes
- **SSD, not SD card.** Postgres will shred an SD card; boot/run from USB-SSD.
- **Add swap** (`sudo dphys-swapfile`… or a swapfile) — the first `npm ci` +
  `vite build` inside Docker is memory-hungry. Pi5 8GB handles it comfortably;
  4GB wants swap headroom.
- Building on the Pi is slower than amd64 but fine on a Pi5. If it ever drags,
  build once and let the layer cache carry subsequent redeploys.

---

## 3. Migrate your existing data (optional but recommended)

Carries the current 117 cycles + wallet + **active v0.4.0 prompt state** over,
so you don't reseed or re-activate anything. Do this *before* the backend first
boots on the Pi, so it restores into an empty DB.

**On the dev box (Docker DB running):**
```bash
docker exec capitalforge-v2-db pg_dump -U postgres -d capitalforge_v2 -Fc -f /tmp/cf.dump
docker cp capitalforge-v2-db:/tmp/cf.dump ./cf_v2.dump
scp cf_v2.dump pi@<pi-host>:~/CapitalForge/V2/
```

**On the Pi — bring up ONLY Postgres, restore, then start the rest:**
```bash
cd ~/CapitalForge/V2
docker compose -f docker-compose.prod.yml up -d postgres      # empty, fresh DB
docker cp cf_v2.dump capitalforge-v2-db:/tmp/cf.dump
docker exec capitalforge-v2-db pg_restore -U postgres -d capitalforge_v2 /tmp/cf.dump
docker compose -f docker-compose.prod.yml up -d               # backend sees migrations
                                                              # already applied → no-op → starts
```
The dump includes Prisma's `_prisma_migrations` table, so the entrypoint's
`migrate deploy` is a no-op on the restored DB. (`*.dump` is gitignored.)

---

## The scheduler

The prod stack sets `ENABLE_SCHEDULER=true` by default, so the appliance runs a
daily cycle over the active strategy's watchlist with no cron/systemd needed —
it lives inside the backend process (like V1's).

- **When:** `SCHEDULE_CRON`, default `30 16 * * 1-5` (4:30pm, Mon–Fri),
  interpreted in `SCHEDULE_TZ` (default `America/New_York`) — so the Pi's own
  clock/timezone is irrelevant.
- **Override** either in `.env`.
- **Turn off:** `ENABLE_SCHEDULER=false` in `.env`.
- **Single instance only:** run exactly one backend with the scheduler armed. It
  overlap-guards itself (a slow run won't stack on the next tick) but two
  processes would both fire.

Confirm it's armed in the logs:
```bash
docker compose -f docker-compose.prod.yml logs backend | grep scheduler
# → [scheduler] armed: "30 16 * * 1-5" (America/New_York); MODE=paper, ... dryRun=true
```

> `RUNNER_DRY_RUN=true` (default) is a forward-looking safety gate for when
> order execution (Alpaca `submitOrder`, Phase B) lands. Cycles today are
> analysis-only — they produce `TradePlan`s, never orders — so nothing places a
> trade regardless. Leave it true until backtests justify arming.

---

## Day-2 operations

All run against the live backend container:

```bash
C=("docker" "compose" "-f" "docker-compose.prod.yml")

# tail logs
"${C[@]}" logs -f backend

# run a manual backfill (accumulate sample size)
"${C[@]}" exec backend npm run backfill -- --symbols AMD,NVDA --start 2026-06-01 --end 2026-06-08

# activate a new prompt version
"${C[@]}" exec backend npx tsx ../scripts/upgrade-prompt.ts headTrader 0.4.0

# fire one cycle by hand
"${C[@]}" exec backend npx tsx ../scripts/run-cycle.ts --symbol AMD --date 2026-06-08

# redeploy after a git pull
git pull && "${C[@]}" up -d --build
```

Postgres troubleshooting (the socket/WSL failure mode is **Windows-only** — the
Pi is Linux and immune) lives in [DOCKER.md](DOCKER.md).
