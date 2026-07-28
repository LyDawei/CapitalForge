-- Phase B (order execution). Records the real Alpaca order a TradePlan was
-- actually submitted as, when RUNNER_DRY_RUN=false. Purely additive and
-- nullable — every existing row (all dry-run to date) gets NULLs here.
-- Deliberately does NOT touch status/closeReason/realizedPnl: those stay
-- driven by the counterfactual settler regardless of whether a real order
-- was placed alongside the simulated plan.

ALTER TABLE "TradePlan" ADD COLUMN "brokerOrderId"        TEXT;
ALTER TABLE "TradePlan" ADD COLUMN "brokerOrderStatus"    TEXT;
ALTER TABLE "TradePlan" ADD COLUMN "brokerFilledQty"      DOUBLE PRECISION;
ALTER TABLE "TradePlan" ADD COLUMN "brokerFilledAvgPrice" DOUBLE PRECISION;
ALTER TABLE "TradePlan" ADD COLUMN "brokerSubmittedAt"    TIMESTAMP(3);

CREATE UNIQUE INDEX "TradePlan_brokerOrderId_key" ON "TradePlan"("brokerOrderId");
