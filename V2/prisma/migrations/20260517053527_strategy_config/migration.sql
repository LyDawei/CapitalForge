-- CreateEnum
CREATE TYPE "StrategyBias" AS ENUM ('trend_following', 'mean_reversion', 'balanced');

-- CreateEnum
CREATE TYPE "HoldingPeriod" AS ENUM ('short_term', 'medium_term', 'long_term');

-- AlterTable
ALTER TABLE "RiskConfig" ADD COLUMN     "presetName" TEXT NOT NULL DEFAULT 'balanced';

-- CreateTable
CREATE TABLE "StrategyConfig" (
    "id" TEXT NOT NULL,
    "presetName" TEXT NOT NULL DEFAULT 'balanced',
    "strategyBias" "StrategyBias" NOT NULL DEFAULT 'balanced',
    "holdingPeriod" "HoldingPeriod" NOT NULL DEFAULT 'medium_term',
    "avoidEarnings" BOOLEAN NOT NULL DEFAULT true,
    "avoidEarningsWindowDays" INTEGER NOT NULL DEFAULT 3,
    "watchlist" TEXT[] DEFAULT ARRAY['SPY', 'AAPL', 'NVDA', 'TSLA', 'MSFT', 'AMZN']::TEXT[],
    "allocatedCapital" DOUBLE PRECISION NOT NULL DEFAULT 2000,
    "reason" TEXT,
    "author" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "StrategyConfig_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "StrategyConfig_createdAt_idx" ON "StrategyConfig"("createdAt");
