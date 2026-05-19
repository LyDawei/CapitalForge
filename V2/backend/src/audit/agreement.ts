import { prisma } from '../db';

/**
 * Pairwise agreement matrix between specialists.
 *
 * For each pair (A, B), over all cycles where both ran: what fraction of cycles
 * did sign(A.bullishScore) == sign(B.bullishScore)?
 *
 * Useful for detecting redundant specialists (always agree → one of them is
 * adding nothing) and adversarial pairs (always disagree → useful signal).
 */
export async function computeAgreementMatrix() {
  const analyses = await prisma.specialistAnalysis.findMany({
    select: { cycleId: true, agentName: true, bullishScore: true },
  });

  const byCycle = new Map<string, Map<string, number>>();
  for (const a of analyses) {
    const m = byCycle.get(a.cycleId) ?? new Map();
    m.set(a.agentName, a.bullishScore);
    byCycle.set(a.cycleId, m);
  }

  const names = Array.from(new Set(analyses.map((a) => a.agentName))).sort();

  // Matrix indexed by agentName.
  const matrix: Record<string, Record<string, { agreement: number; sampleSize: number }>> = {};
  for (const a of names) {
    matrix[a] = {};
    for (const b of names) {
      let agree = 0;
      let total = 0;
      for (const cycle of byCycle.values()) {
        const aScore = cycle.get(a);
        const bScore = cycle.get(b);
        if (aScore === undefined || bScore === undefined) continue;
        // Treat |score| < 0.1 as neutral; only count directional opinions.
        if (Math.abs(aScore) < 0.1 || Math.abs(bScore) < 0.1) continue;
        total += 1;
        if (Math.sign(aScore) === Math.sign(bScore)) agree += 1;
      }
      matrix[a]![b] = { agreement: total === 0 ? 0 : agree / total, sampleSize: total };
    }
  }

  return { names, matrix };
}
