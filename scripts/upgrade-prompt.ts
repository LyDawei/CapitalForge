/**
 * Generic agent-prompt upgrade script. Inserts a new PromptVersion for an
 * agent, deactivates all prior versions, activates the new one, and updates
 * Agent.activePromptVersionId for the denormalized lookup.
 *
 * Each upgrade lives in a typed registry so we get TS-checked references to
 * the exported prompt constants — no string paths, no dynamic imports.
 *
 * Usage:
 *   npx tsx scripts/upgrade-prompt.ts trendRegime 0.2.0
 *   npx tsx scripts/upgrade-prompt.ts all 0.2.0    # upgrade every agent to v0.2.0
 */
import * as path from 'path';
import * as dotenv from 'dotenv';
dotenv.config({ path: path.resolve(__dirname, '..', '.env') });

import { TREND_REGIME_PROMPT_V_0_2_0 } from '../backend/src/prompts/trendRegime.v0.2.0';
import { SETUP_PATTERN_PROMPT_V_0_2_0 } from '../backend/src/prompts/setupPattern.v0.2.0';
import { MOMENTUM_PROMPT_V_0_2_0 } from '../backend/src/prompts/momentum.v0.2.0';
import { MEAN_REVERSION_PROMPT_V_0_2_0 } from '../backend/src/prompts/meanReversion.v0.2.0';
import { VOLUME_FLOW_PROMPT_V_0_2_0 } from '../backend/src/prompts/volumeFlow.v0.2.0';
import { NEWS_EVENTS_PROMPT_V_0_2_0 } from '../backend/src/prompts/newsEvents.v0.2.0';
import { MACRO_CONTEXT_PROMPT_V_0_2_0 } from '../backend/src/prompts/macroContext.v0.2.0';
import { LIQUIDITY_SLIPPAGE_PROMPT_V_0_2_0 } from '../backend/src/prompts/liquiditySlippage.v0.2.0';
import { HEAD_TRADER_PROMPT_V_0_2_0 } from '../backend/src/prompts/headTrader.v0.2.0';
import { RISK_AUDITOR_PROMPT_V_0_2_0 } from '../backend/src/prompts/riskAuditor.v0.2.0';
import { DEVILS_ADVOCATE_PROMPT_V_0_2_0 } from '../backend/src/prompts/devilsAdvocate.v0.2.0';
import { CRITIC_PROMPT_V_0_2_0 } from '../backend/src/prompts/critic.v0.2.0';
import { NEWS_EVENTS_PROMPT_V_0_3_0 } from '../backend/src/prompts/newsEvents.v0.3.0';
import { MACRO_CONTEXT_PROMPT_V_0_3_0 } from '../backend/src/prompts/macroContext.v0.3.0';
import { LIQUIDITY_SLIPPAGE_PROMPT_V_0_3_0 } from '../backend/src/prompts/liquiditySlippage.v0.3.0';
import { RISK_AUDITOR_PROMPT_V_0_3_0 } from '../backend/src/prompts/riskAuditor.v0.3.0';
import { HEAD_TRADER_PROMPT_V_0_3_0 } from '../backend/src/prompts/headTrader.v0.3.0';
import { HEAD_TRADER_PROMPT_V_0_4_0 } from '../backend/src/prompts/headTrader.v0.4.0';
import { outputContractFor } from '../backend/src/schemas/agent-outputs';

interface Upgrade {
  agentName: string;
  version: string;
  // The user-editable directive. Output contract is auto-derived from the
  // agent's Zod schema via `outputContractFor(agentName)` at upsert time.
  directiveTemplate: string;
  changelog: string;
}

const COMMON_V020_CHANGELOG =
  'v0.2.0: explicit input contract (only claim what we have), kill rules formalized, removed reasoningTrace at specialist level (head trader field only), removed priority claims (head trader weights), forced JSON output to SpecialistAnalysis contract, structured per-agent fields moved to extras.';

const REGISTRY: Upgrade[] = [
  { agentName: 'trendRegime',       version: '0.2.0', directiveTemplate: TREND_REGIME_PROMPT_V_0_2_0,       changelog: COMMON_V020_CHANGELOG + ' Adds SMA200 + ATR(14) usage.' },
  { agentName: 'setupPattern',      version: '0.2.0', directiveTemplate: SETUP_PATTERN_PROMPT_V_0_2_0,      changelog: COMMON_V020_CHANGELOG + ' Adds VCP / compression breakout / higher-low continuation. Adds triggerPrice + idealEntryZone in extras.' },
  { agentName: 'momentum',          version: '0.2.0', directiveTemplate: MOMENTUM_PROMPT_V_0_2_0,           changelog: COMMON_V020_CHANGELOG + ' Adds ATR-expansion check, parabolic-exhaustion rule, defensivePostureRecommended.' },
  { agentName: 'meanReversion',     version: '0.2.0', directiveTemplate: MEAN_REVERSION_PROMPT_V_0_2_0,     changelog: COMMON_V020_CHANGELOG + ' Adds regime compatibility (estimated locally), Stage 2/4 anti-counter-trend rule.' },
  { agentName: 'volumeFlow',        version: '0.2.0', directiveTemplate: VOLUME_FLOW_PROMPT_V_0_2_0,        changelog: COMMON_V020_CHANGELOG + ' Sharper price×volume table, breakoutConfirmation as boolean, accumulationScore = bullishScore.' },
  { agentName: 'newsEvents',        version: '0.2.0', directiveTemplate: NEWS_EVENTS_PROMPT_V_0_2_0,        changelog: COMMON_V020_CHANGELOG + ' Adds forcedHoldRecommended (head trader veto). Documents missing news-service inputs — agent returns low confidence rather than fabricates.' },
  { agentName: 'macroContext',      version: '0.2.0', directiveTemplate: MACRO_CONTEXT_PROMPT_V_0_2_0,      changelog: COMMON_V020_CHANGELOG + ' Adds tailwind/headwind dual scores. Documents missing market-context inputs — agent returns low confidence rather than fabricates.' },
  { agentName: 'liquiditySlippage', version: '0.2.0', directiveTemplate: LIQUIDITY_SLIPPAGE_PROMPT_V_0_2_0, changelog: COMMON_V020_CHANGELOG + ' Adds tradable boolean veto + maxSuggestedPositionSize for head trader/risk auditor.' },
  { agentName: 'headTrader',        version: '0.2.0', directiveTemplate: HEAD_TRADER_PROMPT_V_0_2_0,        changelog: 'v0.2.0: now reads new specialist extras (forcedHoldRecommended, defensivePostureRecommended, tradable, killRulesTriggered) as hard vetoes. Adds expectedRMultiple + weightedFactors to output. Dynamic specialist weighting by strategy bias.' },
  { agentName: 'riskAuditor',       version: '0.2.0', directiveTemplate: RISK_AUDITOR_PROMPT_V_0_2_0,       changelog: COMMON_V020_CHANGELOG + ' First-class vetoRecommended boolean. Granular stop / sizing / concentration / R-multiple checks.' },
  { agentName: 'devilsAdvocate',    version: '0.2.0', directiveTemplate: DEVILS_ADVOCATE_PROMPT_V_0_2_0,    changelog: COMMON_V020_CHANGELOG + ' "Avoid generic pessimism" + evidence standard. Granular failure scenarios + weak signals + hidden risks.' },
  { agentName: 'critic',            version: '0.2.0', directiveTemplate: CRITIC_PROMPT_V_0_2_0,             changelog: COMMON_V020_CHANGELOG + ' Adds outcomeAssessment + rootCauseAnalysis + lessonTags + promptImprovementSuggestions for closed-loop learning. NOTE: critic invocation by the runner is still TBD.' },

  // v0.3.0 — real feeds wired. The "no service" branches are gone; both
  // agents now interpret actual Alpaca / Finnhub / FRED data flowing through
  // the FeedFetch + FeedConsumption audit pipeline.
  { agentName: 'newsEvents',        version: '0.3.0', directiveTemplate: NEWS_EVENTS_PROMPT_V_0_3_0,        changelog: 'v0.3.0: real Alpaca news + Finnhub company news + Finnhub earnings + US macro calendar wired. Forced-hold rule binds on real earnings/FOMC proximity. Evidence-standard rationale required.' },
  { agentName: 'macroContext',      version: '0.3.0', directiveTemplate: MACRO_CONTEXT_PROMPT_V_0_3_0,      changelog: 'v0.3.0: real SPY/QQQ regime via Alpaca + 11 sector ETF performance ranking + FRED 10Y/VIX/dollar series wired. Tailwind/headwind scores computed from actual feed values. Evidence-standard rationale required.' },
  { agentName: 'liquiditySlippage', version: '0.3.0', directiveTemplate: LIQUIDITY_SLIPPAGE_PROMPT_V_0_3_0, changelog: 'v0.3.0: real NBBO quote (bid/ask/depth/age) + asset info (shortable/tradable/easyToBorrow) wired. Spread now read in actual bps. IEX free-tier delay acknowledged. Veto thresholds bind on real values.' },
  { agentName: 'riskAuditor',       version: '0.3.0', directiveTemplate: RISK_AUDITOR_PROMPT_V_0_3_0,       changelog: 'v0.3.0: explicit HOLD short-circuit (riskGrade=N/A, no objections) — first-real-LLM smoke caught the agent grading non-plans as F. Reworded invalidation kill rule to describe the concreteness standard without spelling out leak-prone example words.' },
  { agentName: 'headTrader',        version: '0.3.0', directiveTemplate: HEAD_TRADER_PROMPT_V_0_3_0,        changelog: 'v0.3.0: first-backfill came out 100% HOLD. Lower conviction floor 0.5->0.4 with a 0.40-0.50 quarter-size starter tier; reword setup-grade veto into a thesis test (directional agreement counts, named A/B pattern not required); discount any specialist veto/signal at confidence <0.3 (kills empty-feed false vetoes like liquiditySlippage tradable=false @0.00 conf on AAPL); trim anti-overtrading framing to one balanced line. Hard safety vetoes retained.' },

  // v0.4.0 — pairs with cycleRunner change that now serializes the full
  // specialist payload (bullishScore, confidence, flags, rationale, keyLevels,
  // extras) into the head trader prompt. Prior versions referenced extras
  // fields by name in their veto rules, but the runner was only sending
  // (score, conf, flags) — the model couldn't actually read what it was being
  // told to enforce.
  { agentName: 'headTrader',        version: '0.4.0', directiveTemplate: HEAD_TRADER_PROMPT_V_0_4_0,        changelog: 'v0.4.0: INPUTS PROVIDED rewritten to describe the full JSON shape the runner now serializes (bullishScore, confidence, flags, rationale, keyLevels, extras with named per-specialist fields). New READ THIS FIRST directive: extras blocks are the authoritative signal; the (score, conf) pair is a summary. Decision logic / sizing / data-quality discount unchanged — this is a "feed the model what it needs to do what we already told it to do" patch, not a behavior change.' },
];

function findUpgrade(agentName: string, version: string): Upgrade | undefined {
  return REGISTRY.find((u) => u.agentName === agentName && u.version === version);
}

async function applyUpgrade(prisma: any, upgrade: Upgrade): Promise<boolean> {
  const agent = await prisma.agent.findUnique({ where: { name: upgrade.agentName } });
  if (!agent) {
    console.error(`  ✗ Agent ${upgrade.agentName} not found.`);
    return false;
  }
  const contract = outputContractFor(upgrade.agentName);
  const pv = await prisma.promptVersion.upsert({
    where: { agentId_version: { agentId: agent.id, version: upgrade.version } },
    update: {
      directiveTemplate: upgrade.directiveTemplate,
      outputContract: contract,
      changelog: upgrade.changelog,
      isActive: true,
    },
    create: {
      agentId: agent.id,
      version: upgrade.version,
      directiveTemplate: upgrade.directiveTemplate,
      outputContract: contract,
      changelog: upgrade.changelog,
      isActive: true,
    },
  });
  await prisma.promptVersion.updateMany({
    where: { agentId: agent.id, NOT: { id: pv.id } },
    data: { isActive: false },
  });
  await prisma.agent.update({ where: { id: agent.id }, data: { activePromptVersionId: pv.id } });
  console.log(`  ✓ ${agent.displayName.padEnd(28)} → v${upgrade.version}`);
  return true;
}

async function main() {
  const [target, version] = process.argv.slice(2);
  if (!target || !version) {
    console.error('Usage: upgrade-prompt.ts <agentName | all> <version>');
    process.exit(1);
  }

  const { prisma } = await import('../backend/src/db');

  if (target === 'all') {
    const upgrades = REGISTRY.filter((u) => u.version === version);
    if (upgrades.length === 0) {
      console.error(`No upgrades registered for version ${version}.`);
      process.exit(1);
    }
    console.log(`Applying ${upgrades.length} upgrades to v${version}:`);
    for (const u of upgrades) {
      await applyUpgrade(prisma, u);
    }
  } else {
    const upgrade = findUpgrade(target, version);
    if (!upgrade) {
      console.error(`No registered upgrade for ${target} @ ${version}. Add it to scripts/upgrade-prompt.ts.`);
      process.exit(1);
    }
    await applyUpgrade(prisma, upgrade);
  }

  await prisma.$disconnect();
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
