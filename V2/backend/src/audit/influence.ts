import { prisma } from '../db';

/**
 * Influence audit: how often did the head trader's final action match this
 * specialist's directional opinion?
 *
 * Crude version: if specialist score > +0.3, "wanted to BUY"; < -0.3, "wanted to
 * SELL/HOLD". Compare to the head trader's finalAction on the same cycle.
 *
 * Future enhancement: counterfactual replay — strip this specialist's analysis
 * from the head-trader input and see if the action changes. That requires the
 * runner to support replays; the schema is ready for it (runKind="ab").
 */
export async function computeInfluence(agentId: string) {
  const analyses = await prisma.specialistAnalysis.findMany({
    where: { agentRun: { agentId } },
    select: {
      bullishScore: true,
      confidence: true,
      cycle: {
        select: {
          id: true,
          tradePlan: { select: { action: true } },
          deliberation: { select: { finalAction: true } },
        },
      },
    },
  });

  let aligned = 0;
  let opposed = 0;
  let neutral = 0;
  let abstained = 0;

  for (const a of analyses) {
    const final = a.cycle?.deliberation?.finalAction ?? a.cycle?.tradePlan?.action;
    if (!final) continue;
    if (Math.abs(a.bullishScore) < 0.1) {
      abstained += 1;
      continue;
    }
    const wantedBuy = a.bullishScore > 0.3;
    const wantedSell = a.bullishScore < -0.3;
    if (final === 'BUY' && wantedBuy) aligned += 1;
    else if ((final === 'SELL' || final === 'CLOSE') && wantedSell) aligned += 1;
    else if (final === 'HOLD' && !wantedBuy && !wantedSell) neutral += 1;
    else opposed += 1;
  }

  const decided = aligned + opposed + neutral;
  return {
    sampleSize: analyses.length,
    aligned,
    opposed,
    neutral,
    abstained,
    alignmentRate: decided === 0 ? 0 : aligned / decided,
  };
}
