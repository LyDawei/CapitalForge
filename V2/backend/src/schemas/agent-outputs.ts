/**
 * Single source of truth for every agent's output shape.
 *
 * Each agent gets:
 *   - a Zod schema (`*Schema`) — used by the runner to validate live LLM output
 *     and by the preview endpoint to block prompts whose output won't parse.
 *   - a canonical output-contract string (`*Contract`) — the
 *     "REQUIRED OUTPUT — JSON only: { ... }" block that gets appended to every
 *     prompt at render time. Users cannot edit this; it lives here in code.
 *
 * Phase 2 of the prompt-output-contract work in TODO.md: splitting the prompt
 * template into a user-editable directive and an auto-included contract makes
 * it structurally impossible to silently break the runner by renaming a field
 * in a prompt edit. The contract belongs to the schema, not to the prompt.
 */
import { z } from 'zod';

// ---------------------------------------------------------------------------
// Shared base shape — every specialist-style agent emits these five fields.
// ---------------------------------------------------------------------------
const SpecialistBaseSchema = z
  .object({
    bullishScore: z.number().min(-1).max(1),
    confidence: z.number().min(0).max(1),
    rationale: z.array(z.string()).min(2),
    flags: z.array(z.string()).default([]),
    keyLevels: z
      .object({
        support: z.number().nullable(),
        resistance: z.number().nullable(),
      })
      .partial()
      .nullable()
      .optional(),
    extras: z.record(z.any()).optional(),
  })
  .passthrough();

// ---------------------------------------------------------------------------
// Specialist + audit-agent schemas. Today all specialist outputs share the
// base shape — extras are loose (Record<string, any>) so the runner stays
// flexible. We can tighten extras per-agent in a later iteration without
// touching the runner.
// ---------------------------------------------------------------------------
export const TrendRegimeSchema = SpecialistBaseSchema;
export const SetupPatternSchema = SpecialistBaseSchema;
export const MomentumSchema = SpecialistBaseSchema;
export const MeanReversionSchema = SpecialistBaseSchema;
export const VolumeFlowSchema = SpecialistBaseSchema;
export const NewsEventsSchema = SpecialistBaseSchema;
export const MacroContextSchema = SpecialistBaseSchema;
export const LiquiditySlippageSchema = SpecialistBaseSchema;
export const RiskAuditorSchema = SpecialistBaseSchema;
export const DevilsAdvocateSchema = SpecialistBaseSchema;

// ---------------------------------------------------------------------------
// Head trader — completely different shape.
// ---------------------------------------------------------------------------
export const HeadTraderSchema = z
  .object({
    action: z.enum(['BUY', 'SELL', 'HOLD', 'CLOSE']),
    conviction: z.number().min(0).max(1),
    setupName: z.string().nullable().optional(),
    entry: z.number().optional(),
    stop: z.number().nullable().optional(),
    target1: z.number().nullable().optional(),
    target2: z.number().nullable().optional(),
    riskPctOfEquity: z.number().min(0).optional(),
    timeStopBars: z.number().int().nullable().optional(),
    expectedRMultiple: z.number().optional(),
    invalidationCriteria: z.array(z.string()).optional(),
    weightedFactors: z
      .array(
        z.object({
          specialist: z.string(),
          weight: z.number(),
          contribution: z.string(),
        }),
      )
      .optional(),
    reasoningTrace: z
      .array(
        z.object({
          round: z.number().int(),
          thought: z.string(),
          toolUsed: z.string().nullable().optional(),
        }),
      )
      .optional(),
  })
  .passthrough();

// ---------------------------------------------------------------------------
// Critic — post-cycle reviewer, emits a structured critique, not a specialist
// shape.
// ---------------------------------------------------------------------------
export const CriticSchema = z
  .object({
    severity: z.enum(['info', 'warn', 'error']),
    body: z.string().min(10),
    tags: z.array(z.string()).default([]),
  })
  .passthrough();

// ---------------------------------------------------------------------------
// Agent → schema lookup. Used by the runner and by the preview endpoint.
// ---------------------------------------------------------------------------
const SCHEMAS: Record<string, z.ZodTypeAny> = {
  trendRegime: TrendRegimeSchema,
  setupPattern: SetupPatternSchema,
  momentum: MomentumSchema,
  meanReversion: MeanReversionSchema,
  volumeFlow: VolumeFlowSchema,
  newsEvents: NewsEventsSchema,
  macroContext: MacroContextSchema,
  liquiditySlippage: LiquiditySlippageSchema,
  headTrader: HeadTraderSchema,
  riskAuditor: RiskAuditorSchema,
  devilsAdvocate: DevilsAdvocateSchema,
  critic: CriticSchema,
};

export function schemaFor(agentName: string): z.ZodTypeAny | null {
  return SCHEMAS[agentName] ?? null;
}

// ---------------------------------------------------------------------------
// Validator — used everywhere the runner and the preview endpoint validate
// raw LLM text. Returns the same { ok, data | error } shape the runner already
// uses so swapping the inline validators is mechanical.
// ---------------------------------------------------------------------------
export type ValidationResult = { ok: true; data: any } | { ok: false; error: string };

export function validateAgentOutput(agentName: string, raw: string): ValidationResult {
  const schema = schemaFor(agentName);
  if (!schema) return { ok: false, error: `Unknown agent: ${agentName}` };
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch (e: any) {
    return { ok: false, error: `JSON parse failed: ${e.message}` };
  }
  const result = schema.safeParse(parsed);
  if (!result.success) {
    const issues = result.error.issues
      .map((i) => `${i.path.join('.') || '(root)'}: ${i.message}`)
      .join('; ');
    return { ok: false, error: issues };
  }
  return { ok: true, data: result.data };
}

// ===========================================================================
// Output contracts — the canonical "REQUIRED OUTPUT — JSON only:" block per
// agent. Appended to every prompt at render time. Users cannot edit these.
// Keep these in sync with the Zod schemas above.
// ===========================================================================

const SPECIALIST_BASE_CONTRACT = `REQUIRED OUTPUT — JSON only:
{
  "bullishScore": <number from -1.0 to +1.0>,
  "confidence": <number from 0.0 to 1.0>,
  "rationale": [
    "<observation 1 referencing specific inputs>",
    "<observation 2 referencing specific inputs>"
  ],
  "flags": ["<setup-specific tag>", "..."],
  "extras": { <agent-specific structured fields — see directive above> }
}`;

const TREND_REGIME_CONTRACT = `REQUIRED OUTPUT — JSON only:
{
  "bullishScore": <number from -1.0 to +1.0>,
  "confidence": <number from 0.0 to 1.0>,
  "rationale": ["<observation 1>", "<observation 2>"],
  "flags": [],
  "extras": {
    "regime": "bull_trending | bull_choppy | bear_trending | bear_choppy",
    "stage": <1 | 2 | 3 | 4>,
    "killRulesTriggered": ["<string>", "..."]
  }
}`;

const SETUP_PATTERN_CONTRACT = `REQUIRED OUTPUT — JSON only:
{
  "bullishScore": <number from -1.0 to +1.0>,
  "confidence": <number from 0.0 to 1.0>,
  "rationale": ["<observation 1>", "<observation 2>"],
  "flags": ["pullback" | "breakout" | "breakdown" | "base" | "gap" | "oversold" | ...],
  "extras": {
    "setupName": "<recognized setup or null>",
    "qualityGrade": "A | B | C | none",
    "triggerPrice": <number | null>,
    "idealEntryZone": { "low": <number>, "high": <number> } | null
  }
}`;

const MOMENTUM_CONTRACT = `REQUIRED OUTPUT — JSON only:
{
  "bullishScore": <number from -1.0 to +1.0>,
  "confidence": <number from 0.0 to 1.0>,
  "rationale": [
    "<observation 1 referencing specific inputs>",
    "<observation 2 referencing specific inputs>"
  ],
  "flags": ["overbought" | "oversold" | "divergence" | "blowoff" | "compression" | ...],
  "extras": {
    "momentumState": "accelerating | steady | fading | exhausted",
    "momentumScore": <0..1>,
    "exhaustionRisk": <0..1>,
    "continuationProbability": <0..1>,
    "divergenceDetected": <true | false>,
    "defensivePostureRecommended": <true | false>
  }
}`;

const MEAN_REVERSION_CONTRACT = `REQUIRED OUTPUT — JSON only:
{
  "bullishScore": <number from -1.0 to +1.0>,
  "confidence": <number from 0.0 to 1.0>,
  "rationale": ["<observation 1>", "<observation 2>"],
  "flags": ["overbought" | "oversold" | "stretched" | ...],
  "extras": {
    "extensionATR": <number>,
    "revertProbability": <0..1>,
    "regimeCompatible": <true | false>
  }
}`;

const VOLUME_FLOW_CONTRACT = `REQUIRED OUTPUT — JSON only:
{
  "bullishScore": <number from -1.0 to +1.0>,
  "confidence": <number from 0.0 to 1.0>,
  "rationale": ["<observation 1>", "<observation 2>"],
  "flags": ["volume_surge" | "volume_dry" | "distribution" | ...],
  "extras": {
    "accumulationScore": <number from -1.0 to +1.0>,
    "volumeRatio": <number>,
    "surgeDays": <integer>,
    "breakoutConfirmation": <true | false>
  }
}`;

const NEWS_EVENTS_CONTRACT = `REQUIRED OUTPUT — JSON only:
{
  "bullishScore": <number from -1.0 to +1.0>,
  "confidence": <number from 0.0 to 1.0>,
  "rationale": ["<observation 1>", "<observation 2>"],
  "flags": ["earnings_window" | "macro_event" | "fda" | ...],
  "extras": {
    "catalystImminent": <true | false>,
    "earningsWithinDays": <integer | null>,
    "sentimentNet": <number from -1.0 to +1.0>,
    "forcedHoldRecommended": <true | false>
  }
}`;

const MACRO_CONTEXT_CONTRACT = `REQUIRED OUTPUT — JSON only:
{
  "bullishScore": <number from -1.0 to +1.0>,
  "confidence": <number from 0.0 to 1.0>,
  "rationale": ["<observation 1>", "<observation 2>"],
  "flags": [],
  "extras": {
    "breadthState": "expanding | mixed | deteriorating",
    "sectorRsRank": <1..11>,
    "tailwindScore": <0..1>,
    "headwindScore": <0..1>
  }
}`;

const LIQUIDITY_SLIPPAGE_CONTRACT = `REQUIRED OUTPUT — JSON only:
{
  "bullishScore": 0,
  "confidence": <number from 0.0 to 1.0>,
  "rationale": ["<observation 1>", "<observation 2>"],
  "flags": [],
  "extras": {
    "tradableScore": <0..1>,
    "tradable": <true | false>,
    "expectedSlippageBps": <number>,
    "maxSuggestedPositionSize": <number | null>
  }
}`;

const HEAD_TRADER_CONTRACT = `REQUIRED OUTPUT — JSON only:
{
  "action": "BUY | SELL | HOLD | CLOSE",
  "conviction": <number from 0.0 to 1.0>,
  "setupName": "<from setupPattern.extras.setupName or null>",
  "entry": <number>,
  "stop": <number | null — REQUIRED for BUY/SELL>,
  "target1": <number | null>,
  "target2": <number | null>,
  "riskPctOfEquity": <number, ≤ riskConfig.maxRiskPctPerTrade>,
  "timeStopBars": <integer | null>,
  "expectedRMultiple": <number — your honest expected R outcome, can be negative>,
  "invalidationCriteria": ["<plain English condition>", "..."],
  "weightedFactors": [
    { "specialist": "trendRegime", "weight": <0..1>, "contribution": "..." }
  ],
  "reasoningTrace": [
    { "round": 1, "thought": "<your synthesis step>", "toolUsed": null }
  ]
}`;

const RISK_AUDITOR_CONTRACT = `REQUIRED OUTPUT — JSON only:
{
  "bullishScore": 0,
  "confidence": <number from 0.0 to 1.0>,
  "rationale": ["<observation 1>", "<observation 2>"],
  "flags": [],
  "extras": {
    "riskGrade": "A | B | C | F",
    "vetoRecommended": <true | false>,
    "objections": ["<specific objection>", "..."]
  }
}`;

const DEVILS_ADVOCATE_CONTRACT = `REQUIRED OUTPUT — JSON only:
{
  "bullishScore": 0,
  "confidence": <number from 0.0 to 1.0>,
  "rationale": ["<observation 1>", "<observation 2>"],
  "flags": [],
  "extras": {
    "opposeScore": <0..1>,
    "topRisks": ["<failure mode>", "<failure mode>", "<failure mode>"]
  }
}`;

const CRITIC_CONTRACT = `REQUIRED OUTPUT — JSON only:
{
  "severity": "info | warn | error",
  "body": "<2-5 sentences>",
  "tags": ["<structured tag>", "..."]
}`;

const CONTRACTS: Record<string, string> = {
  trendRegime: TREND_REGIME_CONTRACT,
  setupPattern: SETUP_PATTERN_CONTRACT,
  momentum: MOMENTUM_CONTRACT,
  meanReversion: MEAN_REVERSION_CONTRACT,
  volumeFlow: VOLUME_FLOW_CONTRACT,
  newsEvents: NEWS_EVENTS_CONTRACT,
  macroContext: MACRO_CONTEXT_CONTRACT,
  liquiditySlippage: LIQUIDITY_SLIPPAGE_CONTRACT,
  headTrader: HEAD_TRADER_CONTRACT,
  riskAuditor: RISK_AUDITOR_CONTRACT,
  devilsAdvocate: DEVILS_ADVOCATE_CONTRACT,
  critic: CRITIC_CONTRACT,
};

export function outputContractFor(agentName: string): string {
  return CONTRACTS[agentName] ?? SPECIALIST_BASE_CONTRACT;
}

export function hasContract(agentName: string): boolean {
  return agentName in CONTRACTS;
}

export const ALL_AGENT_NAMES = Object.keys(CONTRACTS);
