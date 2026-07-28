/**
 * Deletes all cycle data (cycles + agent runs + specialist analyses +
 * deliberations + trade plans + outcomes + critiques + anomalies). Leaves
 * Agent + PromptVersion rows intact.
 *
 * Usage:  npx tsx scripts/reset-cycles.ts
 */
import * as path from 'path';
import * as dotenv from 'dotenv';
dotenv.config({ path: path.resolve(__dirname, '..', '.env') });

(async () => {
  const { prisma } = await import('../backend/src/db');
  // Cascade order — children first
  await prisma.tradeOutcome.deleteMany();
  await prisma.critique.deleteMany();
  await prisma.anomaly.deleteMany();
  await prisma.toolCall.deleteMany();
  await prisma.tradePlan.deleteMany();
  await prisma.deliberation.deleteMany();
  await prisma.specialistAnalysis.deleteMany();
  await prisma.agentRun.deleteMany();
  await prisma.cycle.deleteMany();
  console.log('All cycle data cleared. Agents + prompts preserved.');
  await prisma.$disconnect();
})().catch((e) => {
  console.error(e);
  process.exit(1);
});
