import * as path from 'path';
import * as dotenv from 'dotenv';
dotenv.config({ path: path.resolve(__dirname, '..', '.env') });

(async () => {
  const { prisma } = await import('../backend/src/db');

  const [cycles, runs, specialists, trades, outcomes, critiques] = await Promise.all([
    prisma.cycle.count(),
    prisma.agentRun.count(),
    prisma.specialistAnalysis.count(),
    prisma.tradePlan.count(),
    prisma.tradeOutcome.count(),
    prisma.critique.count(),
  ]);

  console.log(`Cycles: ${cycles}`);
  console.log(`AgentRuns: ${runs}`);
  console.log(`SpecialistAnalyses: ${specialists}`);
  console.log(`TradePlans: ${trades}`);
  console.log(`TradeOutcomes: ${outcomes}`);
  console.log(`Critiques: ${critiques}`);

  const actionDist = await prisma.tradePlan.groupBy({
    by: ['action'],
    _count: { _all: true },
  });
  console.log('\nAction distribution:');
  for (const r of actionDist) console.log(`  ${r.action}: ${r._count._all}`);

  const outcomeDist = await prisma.tradeOutcome.groupBy({
    by: ['closeReason'],
    _count: { _all: true },
    _avg: { realizedPnl: true, rMultiple: true },
  });
  console.log('\nOutcome distribution:');
  for (const r of outcomeDist) {
    console.log(`  ${r.closeReason}: ${r._count._all} (avg P&L $${r._avg.realizedPnl?.toFixed(2)}, avg R ${r._avg.rMultiple?.toFixed(2)})`);
  }

  const schemaFails = await prisma.agentRun.count({ where: { schemaValid: false } });
  console.log(`\nSchema validation failures: ${schemaFails} / ${runs}`);

  await prisma.$disconnect();
})().catch((e) => {
  console.error(e);
  process.exit(1);
});
