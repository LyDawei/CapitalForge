# V2 TODO

Open work for the Agent Audit Console. Each item has enough context to pick up
cold; don't delete items when done — strike them through and move them to a
"Done" section at the bottom so the history stays browsable.

---

## 1. Enforce a JSON output contract on every prompt

**Problem.** A prompt and the validator that parses its output are two halves of
an implicit contract that live in different places. A single typo in a prompt
template (`"rationale"` → `"reasons"`) silently breaks the runner: every cycle
records `schemaValid: false`, the anomaly detector eventually fires
`schema_failure`, and 11 wasted LLM calls per cycle produce garbage data until
someone notices. We have *detection* today, not *prevention*.

**Why it matters.** Prompt iteration is the highest-leverage activity in this
system — it's how the agents get better. The current design makes that
iteration fragile in a way that costs money (real LLM calls when we wire them
up) and corrupts the audit data the rest of the system depends on.

### Phase 1 — Preview-before-save (small, immediate safety)

When the user submits a new prompt version via `POST /api/base-prompts` or
`POST /api/prompts` (the latter doesn't exist yet — would need to be added):

1. Backend runs the prompt once against the smart mock
2. Validates the output with the same Zod schema the runner uses (`validateSpecialist`, `validateHeadTrader`)
3. If invalid, returns `400` with the parse error — version is not saved
4. Optional `?force=true` query param to override (for known-broken test versions)

Estimated effort: ~80 lines of code. Catches the 90% of accidental contract
breaks (renamed fields, missing required fields, dropped JSON-only instruction).

### Phase 2 — Split the prompt template (the real fix)

Each prompt becomes two fields:
- `directiveTemplate` — user-editable. Role, persona, what to analyze, how to think.
- `outputContract` — auto-generated from the Zod schema, append-only, NOT user-editable. Literally the `"Respond JSON only: { ... }"` block with exact field names and types.

The runner concatenates `directive + contract` at render time. Users can
rewrite a specialist's voice, hierarchy framing, kill rules — anything
semantic — but cannot accidentally rename `bullishScore` or drop `rationale`.

Adding a new field becomes a real change: update the Zod schema in code →
contract regenerates → every prompt picks up the new shape automatically.

Schema impact:
- `PromptVersion.template` → split into `directiveTemplate` + cached `outputContract` (or compute contract at render)
- UI Prompts page needs to show both halves and only allow editing the directive
- The base prompt (`BasePromptVersion`) is unaffected — it's already pure
  "discipline framework" with no output contract

Estimated effort: half-day. Migration + runner change + UI tweak.

### Phase 3 — Structured output at the LLM API level (eventual destination)

When real LLM adapters are wired up (`services/llm.openai.ts`,
`services/llm.anthropic.ts`):
- OpenAI: use JSON mode + JSON Schema
- Anthropic: use tool-use as a structured-output gate

The shape isn't suggested by the prompt — it's enforced by the model API.
Phase 1's preview becomes mostly redundant once Phase 3 lands (real LLMs
following an enforced schema almost never break the contract).

Phase 2 still matters even after Phase 3, because it gives operators
guardrails on what prompts they can submit (no accidentally specifying a
contract that doesn't match the schema).

### Recommendation

Do Phase 1 + Phase 2 together. ~1 day. Phase 3 lands naturally when LLM
adapters are wired.

### Open questions

- Should the contract be enforced for `BasePromptVersion` too? The base prompt
  doesn't dictate output shape, so probably not — but should validate that it
  doesn't contradict the per-agent contract (e.g., base says "return prose
  only" while agent says "return JSON").
- Force-override path: API only, or also UI button with a "I know this is
  broken" confirmation modal?

---

## 2. A/B test prompt versions before rollout

**Problem.** Today, when we activate a new prompt version (`upgrade-prompt.ts <agent> <version>`),
it becomes the live prompt for every subsequent cycle. We have no way to know
whether v0.3.0 is actually better than v0.2.0 until weeks of cycle data
accumulate — and by then, if v0.3.0 is worse, we've degraded the trading record
in the process.

**What we want.** Run new prompt versions in parallel with the current active
version, compare results on the same conditions, and only promote when the new
version demonstrates better hit rate / calibration / expectancy.

### Approach options (decide based on what you actually want to test)

**Option A — Shadow runs (in-process A/B, no extra Alpaca account)**
- For each cycle, run BOTH the active prompt and the candidate prompt
- Both produce AgentRun rows, but with distinct `runKind`: `"primary"` vs `"ab_<version>"`
- Only the `primary` TradePlan executes against Alpaca
- The `ab` version's TradePlan is recorded but NOT executed — the counterfactual settler walks it forward against historical bars to compute would-have-been P&L
- Compare hit rates / expectancy after N cycles
- **Pros:** no extra Alpaca account, no real money/paper-money risk, deterministic comparison
- **Cons:** doesn't capture execution effects (slippage, fills); idealized comparison
- **Effort:** ~half day — extend cycle runner to optionally run a candidate, add UI filter for `runKind=ab_*`, dashboard view comparing the two

**Option B — Two paper accounts (real-world A/B)**
- Active version trades against Alpaca paper account #1
- Candidate version trades against Alpaca paper account #2
- Compare actual paper P&L after N days
- **Pros:** captures execution effects (real fills, real slippage); closer to live-trading reality
- **Cons:** requires a second Alpaca paper account (free, but separate signup); doubles per-cycle LLM cost; requires runner to know which Alpaca client to use per prompt version
- **Effort:** ~1 day — second Alpaca client, per-version Alpaca routing, dashboard view

**Option C — Counterfactual replay (pure backtest, no Alpaca involvement)**
- Take historical cycles that already settled under v0.2
- Replay each one with v0.3's prompt, but on the same historical inputs
- Walk v0.3's resulting TradePlan forward against historical bars (same as the settler does)
- Compare v0.3 hit rate on past cycles vs v0.2's actual results
- **Pros:** no Alpaca account at all; can A/B against arbitrarily old history; cheap
- **Cons:** no execution effects; historical performance ≠ future performance; only tests prompt logic, not real-world behavior under the new conditions you'll face
- **Effort:** ~half day — replay script + comparison view

### Recommendation

Start with **Option A (shadow runs)**. It captures the same kind of evidence
you'd get from Option B without any of the account-management overhead. If
shadow runs are showing v0.3 outperforming, then graduate to Option B for a
final validation pass before promotion. Option C is useful as a one-off
sanity-check ("would v0.3 have changed any of last quarter's losers?") but
shouldn't be the primary A/B mechanism.

### Promotion framework — how long is "long enough"?

**The statistics floor.** For a two-proportion test (is v0.3's hit rate
actually higher than v0.2's?) at 80% power and α=0.05:

| To detect this difference | You need this many samples per version |
|---|---|
| 5 percentage points (50% → 55%) | ~200 trades |
| 10 percentage points (50% → 60%) | ~50 trades |
| 20 percentage points (50% → 70%) | ~12 trades |

Real institutional desks operate at 52-58% hit rates, so the "real" delta
between a good prompt and a great prompt is usually in the 3-8 point range —
exactly the range that needs 100-200 samples to call. At ~2 trades/day this is:
- 50 trades ≈ 25 trading days (~5 weeks)
- 100 trades ≈ 50 trading days (~10 weeks)
- 200 trades ≈ 100 trading days (~5 months)

Specialists generate faster signal (~3-4 directional samples/day each) because
they commit on every cycle, not just trade cycles.

**Three-gate promotion framework. Candidate must pass ALL three.**

**Gate 1 — Sanity (first 30 samples, ~1-2 weeks):**
- Schema-validity ≥ 95%
- Latency within 2× of the old version
- Trade rate stays within ±15pp of the old version's (catches "agent now HOLDs
  everything" or "agent now BUYs everything")
- Manual spot-check of 5 cycles — reasoning looks at least as coherent
- **Fail any of these → kill the candidate immediately, no waiting for stats**

**Gate 2 — Time floor (minimum 14-21 calendar days, regardless of sample count):**
- Markets regime-shift; a prompt that crushes bull-trending may bleed in choppy
- Without at least one regime change in the sample, you can't separate prompt
  signal from market signal
- 14-21 days usually gets at least one shift in the broader tape

**Gate 3 — Promotion threshold (depends on agent type):**

| Agent type | Minimum samples | Promotion criteria |
|---|---|---|
| Head Trader | 100 trades | Hit rate ≥ baseline (no regression) AND (hit rate +5pp OR Brier −0.05) |
| Specialists | 60 directional samples | Same as above |
| Audit agents (riskAuditor, devilsAdvocate) | 60 critiques | "Correctness" — when they raised an objection, the trade actually lost; need ≥10pp improvement to promote |
| Critic | 30 critiques | Manual review (low-volume agent) |

**Max shadow duration: 60 days.** If the candidate hasn't clearly won or lost
by then, kill it — the difference is below the noise floor and you can't claim
victory either way. Move on; there are better prompt ideas to try.

**Concrete recommendation for this codebase:**
- Head Trader: minimum **100 trades + 21 calendar days** before promotion
- Specialists: minimum **60 directional samples + 14 calendar days**
- Audit agents: same as specialists but with stricter criterion (objections
  must correlate with losses better than the old version)
- Auto-kill all candidates at 60 days

### Two important nuances (don't skip)

1. **Never A/B more than one agent at a time.** If you change `trendRegime`
   and `headTrader` simultaneously and outcomes improve, you can't attribute
   the improvement to either one. One change per shadow window.
2. **Pause or reset shadow runs during major regime shifts.** If SPY flips from
   bull-trending to bear-trending mid-shadow, the active version had a head
   start under the old regime. Either reset the shadow start time or tag the
   regime shift in the comparison so analysis can split before/after.

### Open questions

- Should promotion be manual (button: "Promote v0.3 to active") or automatic
  (auto-promote when v0.3 passes all three gates)? Manual is safer and matches
  the audit-first ethos. Auto-promotion lets the system self-improve overnight
  but raises trust questions.
- How do we surface "ready for promotion" in the UI? Probably a dashboard card:
  "Candidates that have cleared all gates" with promote buttons.
- What happens to existing in-flight `ab_*` runs when a candidate is killed or
  promoted? The data should stay (audit value), but the runner should stop
  generating new ones for that version.

### What this depends on

- Schema already supports it: `AgentRun.runKind` is a string field, defaults to
  `"primary"`. Add `"ab_<version>"` as another value, no migration needed.
- Frontend filter on the Runs/Cycles pages to slice by `runKind`.
- New "A/B compare" view: side-by-side hit-rate / calibration / sample-size
  for primary vs candidate, with a "promote" button.

---

## 3. Implement the real Alpaca adapter

**Problem.** V2 is currently 100% mock for Alpaca, even when `MODE=paper` and a
real API key is set. The factory in `V2/backend/src/services/alpaca.ts` falls
back to `MockAlpacaService` in all cases — there is no `alpaca.real.ts` yet.
Until this ships, V2 cannot pull real market data and cannot execute trades.
This is the gate between "audit infrastructure" and "real trading system."

**Why it matters.** Everything downstream — backtest harness, real-money
validation, shadow runs against live data, the entire profitability question —
depends on V2 being able to talk to Alpaca for real.

### Scope

**Phase A — Market data adapter (required to do anything real):**
Implement `V2/backend/src/services/alpaca.real.ts` against the Alpaca REST API.
Methods that need to work:
- `getDailyBars(symbol, limit)` — `GET https://data.alpaca.markets/v2/stocks/{symbol}/bars?timeframe=1Day&limit={limit}`
- `getCurrentPrice(symbol)` — latest trade or quote, with fallback to latest bar
- `getBarsAfter(symbol, afterDate, count)` — same bars endpoint with `start` param, used by the settler

Auth: `APCA-API-KEY-ID` + `APCA-API-SECRET-KEY` headers from `env.ts`.

Things to get right:
- Pagination: the bars endpoint returns `next_page_token` when results exceed
  page size. Loop until you have `limit` bars or `next_page_token` is null.
- Rate limiting: free tier caps at ~200 requests/min. Add a simple in-process
  token bucket so accidental burst (e.g., bulk seed of 100 cycles) doesn't
  trip rate limits.
- Error handling: 401 = bad credentials, fail loud. 429 = rate limited, retry
  with backoff. 5xx = transient, retry 3x then fail.
- Timezones: Alpaca returns UTC; ensure our date strings match the `Cycle.date`
  convention (YYYY-MM-DD in market local time).

Factory update: in `getAlpacaService()`, return `RealAlpacaService` when
`MODE === 'paper'` AND `ALPACA_API_KEY` is non-empty. Keep mock as the default
when either condition fails — so a missing key never silently breaks the dev
loop.

Reference implementation: `packages/engine/src/services/alpaca.ts` (V1's real
adapter) already does most of this against the same API. Don't copy verbatim —
the V1 version returns slightly different types and has its own bug history —
but the auth + pagination patterns are valid.

**Effort:** ~half day for the data adapter, plus another half day to validate
against real Alpaca (compare RSI/SMA values for a known symbol against a
charting site to confirm the math is right end-to-end).

**Phase B — Order execution (separate concern, can wait):**
Add `submitOrder(symbol, qty, side)` and `getOrder(orderId)` to the
`AlpacaService` interface, implement against the **paper trading URL**
(`paper-api.alpaca.markets`, NOT the data URL — different host). Wire the
cycle runner to actually call `submitOrder` when a `TradePlan` is created with
action != HOLD.

**⚠️ ARMED STATE WARNING:** Once Phase B ships, the system can move money
(paper-money first, real-money if you ever flip the API endpoint to live).
Strongly recommend keeping a `RUNNER_DRY_RUN=true` env flag that gates the
actual `submitOrder` call so that the runner can record what it *would* have
done in `TradePlan` without executing. Default it to `true`. Only set it to
`false` after backtest results justify going live.

**Effort:** ~half day, but the testing/safety harness around it is the bulk
of the work.

### Open questions

- For the `getCurrentPrice` fallback chain: trade > quote > latest bar? On the
  free IEX-only tier, quotes are 15-minute delayed, so "latest bar close" may
  actually be fresher in some cases. Decide explicitly rather than guess.
- News API integration: `newsEvents` agent currently returns low-confidence
  defaults because no news service is wired. Adding `getNews(symbol, days)`
  would let it actually do its job. Scope this with Phase A or as a separate
  TODO item?
- For Phase B: do partial fills get retried or accepted? Alpaca paper trading
  almost always fills full at the requested price, but real-money execution
  isn't that clean.

### What this depends on / unblocks

- **Depends on:** nothing. Schema and runner already support real data via the
  existing `AlpacaService` interface.
- **Unblocks:** real backtest harness (need real historical data), shadow runs
  with real conditions (TODO item #2), live trading (Phase B), any meaningful
  profitability measurement (the central open question of the project).

### Suggested ordering

1. Build Phase A and validate against real data
2. Run V2 against ~3 months of real market data to see what hit rates look
   like with real prices instead of mock
3. Only then decide if Phase B is worth the safety overhead
4. If Phase B happens, ship `RUNNER_DRY_RUN=true` as default first, manually
   compare what-it-would-have-done against your own paper trades for at least
   a week before flipping the gate

---

## Done

(empty — strike-through completed items here when finished, with date)
