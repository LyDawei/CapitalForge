-- Relax TradePlan.cycleId from unique to indexed so a single cycle can carry
-- a primary plan PLUS one or more shadow A/B plans (each tied to its own
-- agentRunId, which remains unique). Routes that expose "the plan" filter on
-- agentRun.runKind = 'primary'.

DROP INDEX "TradePlan_cycleId_key";
CREATE INDEX "TradePlan_cycleId_idx" ON "TradePlan"("cycleId");
