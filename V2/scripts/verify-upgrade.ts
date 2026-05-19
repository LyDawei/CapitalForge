import * as path from 'path';
import * as dotenv from 'dotenv';
dotenv.config({ path: path.resolve(__dirname, '..', '.env') });

(async () => {
  const { prisma } = await import('../backend/src/db');

  // 1. Confirm trendRegime is on v0.2.0
  const trendRegime = await prisma.agent.findUnique({
    where: { name: 'trendRegime' },
    include: { promptVersions: { orderBy: { createdAt: 'desc' } } },
  });
  const activePv = trendRegime?.promptVersions.find((p) => p.isActive);
  console.log(`trendRegime active prompt: v${activePv?.version}`);
  console.log(`trendRegime prompt history: ${trendRegime?.promptVersions.map((p) => 'v' + p.version + (p.isActive ? ' (active)' : '')).join(', ')}`);

  // 2. Confirm new technicals are in the latest cycle
  const cycle = await prisma.cycle.findFirst({ orderBy: { startedAt: 'desc' } });
  const tech = cycle?.technicals as any;
  console.log(`\nLatest cycle: ${cycle?.symbol} @ ${cycle?.date}`);
  console.log(`  SMA(200): ${tech?.sma200 !== null && tech?.sma200 !== undefined ? '$' + tech.sma200.toFixed(2) : 'NULL'}`);
  console.log(`  ATR(14):  $${tech?.atr14?.toFixed(2)} (${(tech?.atrPct * 100).toFixed(2)}% of close)`);

  // 3. Confirm latest trendRegime runs reference v0.2.0
  const recentTrendRuns = await prisma.agentRun.findMany({
    where: { agentId: trendRegime!.id },
    orderBy: { createdAt: 'desc' },
    take: 5,
    select: { promptVersion: { select: { version: true } }, schemaValid: true, parsedOutput: true },
  });
  console.log(`\nLast 5 trendRegime runs:`);
  for (const r of recentTrendRuns) {
    const out = r.parsedOutput as any;
    const regime = out?.extras?.regime ?? '—';
    const stage = out?.extras?.stage ?? '—';
    console.log(`  v${r.promptVersion.version} · valid=${r.schemaValid} · regime=${regime} · stage=${stage}`);
  }

  // 4. Show what one rendered prompt looks like to confirm SMA200 + ATR are present
  const sampleRun = await prisma.agentRun.findFirst({
    where: { agentId: trendRegime!.id },
    select: { renderedPrompt: true },
  });
  const idx = sampleRun?.renderedPrompt.indexOf('--- TECHNICALS ---') ?? -1;
  if (idx >= 0) {
    console.log(`\nTechnicals block sent to trendRegime:`);
    console.log(sampleRun!.renderedPrompt.slice(idx, idx + 500));
  }

  await prisma.$disconnect();
})().catch((e) => {
  console.error(e);
  process.exit(1);
});
