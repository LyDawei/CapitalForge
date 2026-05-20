import { prisma } from '../db';
import { getAlpacaService } from '../services/alpaca';
import { bookTradeSettlement } from '../services/wallet';
import { runAgent } from './agentRunner';
import { validateAgentOutput } from '../schemas/agent-outputs';

/**
 * Settles proposed TradePlans that haven't been settled yet. Walks each plan
 * forward through bars after the entry date. Detects stop-hit, target-hit, or
 * time-stop and writes a TradeOutcome row.
 *
 * On settlement of each plan: also fires the post-cycle critic. The critic
 * reads the head trader's full reasoning trace, the TradePlan, and the realized
 * TradeOutcome, then writes a Critique row capturing what was missed or
 * overweighted. This closes the audit loop — every closed trade produces
 * learnable signal for the next prompt iteration.
 */
export async function settleProposedPlans(): Promise<number> {
  const plans = await prisma.tradePlan.findMany({
    where: { status: 'proposed', action: { in: ['BUY', 'SELL'] } },
    include: {
      cycle: {
        select: {
          date: true,
          deliberation: { select: { reasoningTrace: true, finalAction: true, conviction: true } },
        },
      },
    },
  });

  if (plans.length === 0) return 0;

  // Load the critic agent + its active prompt + the active base prompt ONCE
  // for the whole settlement batch so we don't query Agent on every iteration.
  const criticContext = await loadCriticContext();

  const alpaca = getAlpacaService();
  let settled = 0;

  for (const plan of plans) {
    const bars = await alpaca.getBarsAfter(plan.symbol, plan.cycle.date, plan.timeStopBars ?? 10);
    if (bars.length === 0) continue;

    let closeReason: string | null = null;
    let exitPrice = 0;
    let heldBars = 0;
    let mfe = 0;
    let mae = 0;

    const isLong = plan.action === 'BUY';

    for (let i = 0; i < bars.length; i++) {
      const bar = bars[i]!;
      heldBars = i + 1;

      // Track MFE / MAE
      const excursion = isLong ? bar.high - plan.entry : plan.entry - bar.low;
      const drawdown = isLong ? plan.entry - bar.low : bar.high - plan.entry;
      if (excursion > mfe) mfe = excursion;
      if (drawdown > mae) mae = drawdown;

      // Stop check
      if (plan.stop !== null) {
        if (isLong && bar.low <= plan.stop) {
          closeReason = 'stop_hit';
          exitPrice = plan.stop;
          break;
        }
        if (!isLong && bar.high >= plan.stop) {
          closeReason = 'stop_hit';
          exitPrice = plan.stop;
          break;
        }
      }

      // Target1 check
      if (plan.target1 !== null) {
        if (isLong && bar.high >= plan.target1) {
          closeReason = 'target1_hit';
          exitPrice = plan.target1;
          break;
        }
        if (!isLong && bar.low <= plan.target1) {
          closeReason = 'target1_hit';
          exitPrice = plan.target1;
          break;
        }
      }

      // Target2 check
      if (plan.target2 !== null) {
        if (isLong && bar.high >= plan.target2) {
          closeReason = 'target_hit';
          exitPrice = plan.target2;
          break;
        }
        if (!isLong && bar.low <= plan.target2) {
          closeReason = 'target_hit';
          exitPrice = plan.target2;
          break;
        }
      }
    }

    // Time stop — if no target or stop was hit
    if (!closeReason) {
      closeReason = 'time_stop';
      exitPrice = bars[bars.length - 1]!.close;
      heldBars = bars.length;
    }

    const realizedPnl = isLong
      ? (exitPrice - plan.entry) * plan.shares
      : (plan.entry - exitPrice) * plan.shares;

    const rMultiple =
      plan.stop !== null && plan.stop !== plan.entry
        ? (exitPrice - plan.entry) / Math.abs(plan.entry - plan.stop) * (isLong ? 1 : -1)
        : null;

    await prisma.tradePlan.update({
      where: { id: plan.id },
      data: {
        status: 'closed',
        closeReason: closeReason as any,
        closedAt: new Date(),
        realizedPnl,
        heldBars,
      },
    });

    await prisma.tradeOutcome.create({
      data: {
        tradePlanId: plan.id,
        closeReason: closeReason as any,
        realizedPnl,
        rMultiple,
        mfe: +mfe.toFixed(2),
        mae: +mae.toFixed(2),
        heldBars,
      },
    });

    // Settle the realized P&L into the wallet ledger. Idempotent on
    // tradePlanId — re-running the settler won't double-book.
    await bookTradeSettlement(plan.id, realizedPnl, plan.symbol, closeReason);

    // Fire the post-cycle critic. Best-effort: if it fails (LLM error, schema
    // miss, missing deliberation row) we log and keep going — the settlement
    // itself is the load-bearing part of this loop and shouldn't be blocked
    // by an audit-only side effect.
    try {
      await runCriticForPlan(criticContext, plan, {
        closeReason,
        realizedPnl,
        rMultiple,
        heldBars,
        mfe: +mfe.toFixed(2),
        mae: +mae.toFixed(2),
      });
    } catch (err: any) {
      // eslint-disable-next-line no-console
      console.warn(`[settler] critic failed for plan ${plan.id}: ${err.message}`);
    }

    settled++;
  }

  return settled;
}

// ---------------------------------------------------------------------------
// Critic invocation
// ---------------------------------------------------------------------------
interface CriticContext {
  agentId: string;
  promptVersionId: string;
  directiveTemplate: string;
  outputContract: string;
  basePrompt: { id: string; template: string } | undefined;
}

async function loadCriticContext(): Promise<CriticContext | null> {
  const agent = await prisma.agent.findUnique({
    where: { name: 'critic' },
    include: { promptVersions: { where: { isActive: true }, take: 1 } },
  });
  const pv = agent?.promptVersions[0];
  if (!agent || !pv) return null;
  const baseRow = await prisma.basePromptVersion.findFirst({
    where: { isActive: true },
    orderBy: { createdAt: 'desc' },
  });
  return {
    agentId: agent.id,
    promptVersionId: pv.id,
    directiveTemplate: pv.directiveTemplate,
    outputContract: pv.outputContract,
    basePrompt: baseRow ? { id: baseRow.id, template: baseRow.template } : undefined,
  };
}

interface OutcomeSnapshot {
  closeReason: string;
  realizedPnl: number;
  rMultiple: number | null;
  heldBars: number;
  mfe: number;
  mae: number;
}

async function runCriticForPlan(
  ctx: CriticContext | null,
  plan: {
    id: string;
    cycleId: string;
    symbol: string;
    action: string;
    entry: number;
    stop: number | null;
    target1: number | null;
    target2: number | null;
    conviction: number;
    shares: number;
    cycle: { deliberation: { reasoningTrace: any; finalAction: string; conviction: number } | null };
  },
  outcome: OutcomeSnapshot,
): Promise<void> {
  if (!ctx) return; // critic not seeded — system without this agent stays functional.

  // Idempotency: skip if a critic Critique already exists for this plan.
  const existing = await prisma.critique.findFirst({
    where: { tradePlanId: plan.id, author: 'critic' },
    select: { id: true },
  });
  if (existing) return;

  const reasoningTrace = plan.cycle.deliberation?.reasoningTrace ?? '(no deliberation recorded)';
  const planSummary = {
    symbol: plan.symbol,
    action: plan.action,
    entry: plan.entry,
    stop: plan.stop,
    target1: plan.target1,
    target2: plan.target2,
    conviction: plan.conviction,
    shares: plan.shares,
  };

  const renderedPrompt =
    `${ctx.directiveTemplate}\n\n${ctx.outputContract}\n\n` +
    `--- REASONING TRACE ---\n${JSON.stringify(reasoningTrace, null, 2)}\n\n` +
    `--- TRADE PLAN ---\n${JSON.stringify(planSummary, null, 2)}\n\n` +
    `--- TRADE OUTCOME ---\n${JSON.stringify(outcome, null, 2)}`;

  const result = await runAgent({
    agentId: ctx.agentId,
    promptVersionId: ctx.promptVersionId,
    basePrompt: ctx.basePrompt,
    cycleId: plan.cycleId,
    renderedPrompt,
    inputPayload: { reasoningTrace, plan: planSummary, outcome },
    validate: (raw) => validateAgentOutput('critic', raw),
    runKind: 'primary',
  });

  if (!result.schemaValid || !result.parsed) {
    // AgentRun is already persisted with parseError; surface a Critique anyway
    // so the audit page reflects the attempt.
    await prisma.critique.create({
      data: {
        cycleId: plan.cycleId,
        agentRunId: result.agentRunId,
        tradePlanId: plan.id,
        author: 'critic',
        severity: 'warn',
        body: `critic output failed schema: ${result.parseError ?? 'unknown'}`,
        tags: ['schema_failure'],
      },
    });
    return;
  }

  const parsed = result.parsed as { severity: string; body: string; tags: string[] };
  await prisma.critique.create({
    data: {
      cycleId: plan.cycleId,
      agentRunId: result.agentRunId,
      tradePlanId: plan.id,
      author: 'critic',
      severity: (parsed.severity ?? 'info') as any,
      body: parsed.body ?? '',
      tags: parsed.tags ?? [],
    },
  });
}
