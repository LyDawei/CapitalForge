-- Restore the original TradePlan.cycleId unique constraint. The relaxation
-- in 20260519000002 turned out to require a cascade of route/audit refactors
-- that were out of scope; for the shadow A/B MVP we persist only the head
-- trader's AgentRun (not a separate TradePlan row) when runKind='ab'.

DROP INDEX "TradePlan_cycleId_idx";
CREATE UNIQUE INDEX "TradePlan_cycleId_key" ON "TradePlan"("cycleId");
