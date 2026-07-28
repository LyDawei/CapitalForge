import * as path from 'path';
import * as dotenv from 'dotenv';
dotenv.config({ path: path.resolve(__dirname, '..', '.env') });

(async () => {
  const { prisma } = await import('../backend/src/db');

  const agents = await prisma.agent.findMany({
    include: {
      promptVersions: { orderBy: { createdAt: 'desc' } },
      _count: { select: { runs: true } },
    },
    orderBy: [{ kind: 'asc' }, { name: 'asc' }],
  });

  console.log('Agent · active prompt · history · runs');
  console.log('—'.repeat(80));
  for (const a of agents) {
    const active = a.promptVersions.find((p) => p.isActive);
    const history = a.promptVersions.map((p) => 'v' + p.version + (p.isActive ? '*' : '')).join(', ');
    console.log(`${a.displayName.padEnd(28)} v${active?.version ?? '—'}  [${history}]  runs=${a._count.runs}`);
  }

  // Spot-check one run per specialist to confirm extras are populated
  console.log('\nSpot-check: latest run per specialist (parsed extras keys)');
  console.log('—'.repeat(80));
  for (const a of agents.filter((a) => a.kind === 'specialist')) {
    const r = await prisma.agentRun.findFirst({
      where: { agentId: a.id, schemaValid: true },
      orderBy: { createdAt: 'desc' },
      select: { parsedOutput: true },
    });
    const extras = (r?.parsedOutput as any)?.extras ?? {};
    const keys = Object.keys(extras).join(', ');
    console.log(`${a.name.padEnd(20)} extras: ${keys || '(empty)'}`);
  }

  // Schema validation rates
  console.log('\nSchema validation rates:');
  console.log('—'.repeat(80));
  for (const a of agents) {
    const total = await prisma.agentRun.count({ where: { agentId: a.id } });
    const valid = await prisma.agentRun.count({ where: { agentId: a.id, schemaValid: true } });
    const pct = total > 0 ? Math.round((valid / total) * 100) : 0;
    console.log(`${a.name.padEnd(20)} ${valid}/${total} valid (${pct}%)`);
  }

  await prisma.$disconnect();
})().catch((e) => {
  console.error(e);
  process.exit(1);
});
