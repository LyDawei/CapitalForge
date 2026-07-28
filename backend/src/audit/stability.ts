import { prisma } from '../db';

/**
 * Stability audit: for input hashes that have been replayed (runKind = "replay"
 * alongside a primary run with the same inputHash), measure variance of
 * bullishScore + confidence across replays.
 *
 * Lower variance = more stable. A specialist with high variance on identical
 * inputs is signal noise — likely a temperature or prompt-discipline problem.
 */
export async function computeStability(agentId: string) {
  const runs = await prisma.agentRun.findMany({
    where: { agentId, parsedOutput: { not: undefined as any } },
    select: { inputHash: true, runKind: true, parsedOutput: true, createdAt: true },
    orderBy: { createdAt: 'asc' },
  });

  // Group by inputHash; only keep groups with >= 2 successful runs.
  const groups = new Map<string, Array<{ score: number; confidence: number }>>();
  for (const r of runs) {
    const p = r.parsedOutput as { bullishScore?: number; confidence?: number } | null;
    if (!p || typeof p.bullishScore !== 'number' || typeof p.confidence !== 'number') continue;
    const arr = groups.get(r.inputHash) ?? [];
    arr.push({ score: p.bullishScore, confidence: p.confidence });
    groups.set(r.inputHash, arr);
  }

  const points: Array<{
    inputHash: string;
    replays: number;
    scoreStdev: number;
    confidenceStdev: number;
  }> = [];
  let totalScoreStdev = 0;
  let totalConfStdev = 0;
  let groupCount = 0;
  for (const [hash, arr] of groups) {
    if (arr.length < 2) continue;
    const scoreStdev = stdev(arr.map((x) => x.score));
    const confStdev = stdev(arr.map((x) => x.confidence));
    points.push({ inputHash: hash, replays: arr.length, scoreStdev, confidenceStdev: confStdev });
    totalScoreStdev += scoreStdev;
    totalConfStdev += confStdev;
    groupCount += 1;
  }

  return {
    sampleSize: groupCount,
    avgScoreStdev: groupCount === 0 ? 0 : totalScoreStdev / groupCount,
    avgConfidenceStdev: groupCount === 0 ? 0 : totalConfStdev / groupCount,
    points: points.slice(0, 100),
  };
}

function stdev(xs: number[]): number {
  if (xs.length < 2) return 0;
  const mean = xs.reduce((a, b) => a + b, 0) / xs.length;
  const variance = xs.reduce((acc, x) => acc + Math.pow(x - mean, 2), 0) / (xs.length - 1);
  return Math.sqrt(variance);
}
