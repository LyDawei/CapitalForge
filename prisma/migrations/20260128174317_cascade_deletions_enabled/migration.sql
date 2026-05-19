-- DropForeignKey
ALTER TABLE "AgentEvaluation" DROP CONSTRAINT "AgentEvaluation_cycleId_fkey";

-- DropForeignKey
ALTER TABLE "AggregatedDecision" DROP CONSTRAINT "AggregatedDecision_cycleId_fkey";

-- DropForeignKey
ALTER TABLE "Trade" DROP CONSTRAINT "Trade_cycleId_fkey";

-- AddForeignKey
ALTER TABLE "AgentEvaluation" ADD CONSTRAINT "AgentEvaluation_cycleId_fkey" FOREIGN KEY ("cycleId") REFERENCES "DailyCycle"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AggregatedDecision" ADD CONSTRAINT "AggregatedDecision_cycleId_fkey" FOREIGN KEY ("cycleId") REFERENCES "DailyCycle"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Trade" ADD CONSTRAINT "Trade_cycleId_fkey" FOREIGN KEY ("cycleId") REFERENCES "DailyCycle"("id") ON DELETE CASCADE ON UPDATE CASCADE;
