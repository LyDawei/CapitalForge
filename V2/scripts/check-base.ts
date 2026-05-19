import * as path from 'path';
import * as dotenv from 'dotenv';
dotenv.config({ path: path.resolve(__dirname, '..', '.env') });

(async () => {
  const { prisma } = await import('../backend/src/db');
  const total = await prisma.agentRun.count();
  const withBase = await prisma.agentRun.count({ where: { basePromptVersionId: { not: null } } });
  const oneRun = await prisma.agentRun.findFirst({
    where: { basePromptVersionId: { not: null } },
    select: { renderedPrompt: true, basePromptVersionId: true },
  });
  console.log(`Total AgentRuns: ${total}`);
  console.log(`With base prompt linked: ${withBase} (${total > 0 ? Math.round(100 * withBase / total) : 0}%)`);
  console.log(`Sample renderedPrompt starts with:\n---\n${oneRun?.renderedPrompt.slice(0, 250)}\n---`);
  await prisma.$disconnect();
})().catch((e) => {
  console.error(e);
  process.exit(1);
});
