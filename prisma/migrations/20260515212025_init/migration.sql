-- CreateEnum
CREATE TYPE "AgentKind" AS ENUM ('specialist', 'head_trader', 'risk_auditor', 'devils_advocate', 'critic');

-- CreateEnum
CREATE TYPE "CycleStatus" AS ENUM ('pending', 'running', 'completed', 'failed');

-- CreateEnum
CREATE TYPE "TradeAction" AS ENUM ('BUY', 'SELL', 'HOLD', 'CLOSE');

-- CreateEnum
CREATE TYPE "TradePlanStatus" AS ENUM ('proposed', 'active', 'closed', 'cancelled', 'invalidated');

-- CreateEnum
CREATE TYPE "CloseReason" AS ENUM ('stop_hit', 'target_hit', 'target1_hit', 'target2_hit', 'time_stop', 'regime_change', 'manual', 'invalidated');

-- CreateEnum
CREATE TYPE "Severity" AS ENUM ('info', 'warn', 'error');

-- CreateEnum
CREATE TYPE "AnomalyKind" AS ENUM ('schema_failure', 'latency_spike', 'cost_spike', 'output_drift', 'confidence_outlier', 'unanimous_disagreement', 'hit_rate_drop', 'stability_low');

-- CreateTable
CREATE TABLE "Agent" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "displayName" TEXT NOT NULL,
    "kind" "AgentKind" NOT NULL,
    "role" TEXT NOT NULL,
    "description" TEXT NOT NULL,
    "metadata" JSONB NOT NULL,
    "activePromptVersionId" TEXT,
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Agent_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "PromptVersion" (
    "id" TEXT NOT NULL,
    "agentId" TEXT NOT NULL,
    "version" TEXT NOT NULL,
    "template" TEXT NOT NULL,
    "changelog" TEXT,
    "modelName" TEXT,
    "temperature" DOUBLE PRECISION,
    "isActive" BOOLEAN NOT NULL DEFAULT false,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "PromptVersion_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Cycle" (
    "id" TEXT NOT NULL,
    "date" TEXT NOT NULL,
    "symbol" TEXT NOT NULL,
    "technicals" JSONB NOT NULL,
    "marketContext" JSONB,
    "status" "CycleStatus" NOT NULL DEFAULT 'pending',
    "startedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "completedAt" TIMESTAMP(3),
    "totalLatencyMs" INTEGER,
    "totalCostUsd" DOUBLE PRECISION,

    CONSTRAINT "Cycle_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "AgentRun" (
    "id" TEXT NOT NULL,
    "agentId" TEXT NOT NULL,
    "promptVersionId" TEXT NOT NULL,
    "cycleId" TEXT,
    "inputHash" TEXT NOT NULL,
    "renderedPrompt" TEXT NOT NULL,
    "inputPayload" JSONB NOT NULL,
    "provider" TEXT NOT NULL,
    "modelName" TEXT NOT NULL,
    "temperature" DOUBLE PRECISION NOT NULL,
    "rawResponse" TEXT NOT NULL,
    "parsedOutput" JSONB,
    "schemaValid" BOOLEAN NOT NULL DEFAULT false,
    "parseError" TEXT,
    "latencyMs" INTEGER NOT NULL,
    "tokensIn" INTEGER,
    "tokensOut" INTEGER,
    "costUsd" DOUBLE PRECISION,
    "runKind" TEXT NOT NULL DEFAULT 'primary',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "AgentRun_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "SpecialistAnalysis" (
    "id" TEXT NOT NULL,
    "cycleId" TEXT NOT NULL,
    "agentRunId" TEXT NOT NULL,
    "agentName" TEXT NOT NULL,
    "bullishScore" DOUBLE PRECISION NOT NULL,
    "confidence" DOUBLE PRECISION NOT NULL,
    "rationale" TEXT[],
    "flags" TEXT[],
    "keyLevels" JSONB,
    "extras" JSONB,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "SpecialistAnalysis_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Deliberation" (
    "id" TEXT NOT NULL,
    "cycleId" TEXT NOT NULL,
    "rounds" INTEGER NOT NULL,
    "finalAction" "TradeAction" NOT NULL,
    "conviction" DOUBLE PRECISION NOT NULL,
    "totalLatencyMs" INTEGER NOT NULL,
    "totalTokens" INTEGER,
    "totalCostUsd" DOUBLE PRECISION,
    "modelName" TEXT NOT NULL,
    "reasoningTrace" JSONB NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "Deliberation_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ToolCall" (
    "id" TEXT NOT NULL,
    "agentRunId" TEXT NOT NULL,
    "round" INTEGER NOT NULL,
    "toolName" TEXT NOT NULL,
    "args" JSONB NOT NULL,
    "result" JSONB NOT NULL,
    "latencyMs" INTEGER NOT NULL,
    "errored" BOOLEAN NOT NULL DEFAULT false,
    "errorMessage" TEXT,
    "influenceTag" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ToolCall_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "TradePlan" (
    "id" TEXT NOT NULL,
    "cycleId" TEXT NOT NULL,
    "agentRunId" TEXT NOT NULL,
    "symbol" TEXT NOT NULL,
    "action" "TradeAction" NOT NULL,
    "setupName" TEXT,
    "entry" DOUBLE PRECISION NOT NULL,
    "stop" DOUBLE PRECISION,
    "target1" DOUBLE PRECISION,
    "target2" DOUBLE PRECISION,
    "riskPctOfEquity" DOUBLE PRECISION NOT NULL,
    "riskDollars" DOUBLE PRECISION NOT NULL,
    "shares" DOUBLE PRECISION NOT NULL,
    "conviction" DOUBLE PRECISION NOT NULL,
    "timeStopBars" INTEGER,
    "invalidationCriteria" TEXT[],
    "status" "TradePlanStatus" NOT NULL DEFAULT 'proposed',
    "closeReason" "CloseReason",
    "closedAt" TIMESTAMP(3),
    "realizedPnl" DOUBLE PRECISION,
    "heldBars" INTEGER,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "TradePlan_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "TradeOutcome" (
    "id" TEXT NOT NULL,
    "tradePlanId" TEXT NOT NULL,
    "closeReason" "CloseReason" NOT NULL,
    "realizedPnl" DOUBLE PRECISION NOT NULL,
    "rMultiple" DOUBLE PRECISION,
    "mfe" DOUBLE PRECISION,
    "mae" DOUBLE PRECISION,
    "heldBars" INTEGER NOT NULL,
    "closedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "TradeOutcome_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Critique" (
    "id" TEXT NOT NULL,
    "cycleId" TEXT,
    "agentRunId" TEXT,
    "tradePlanId" TEXT,
    "author" TEXT NOT NULL,
    "severity" "Severity" NOT NULL DEFAULT 'info',
    "body" TEXT NOT NULL,
    "tags" TEXT[],
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "Critique_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Anomaly" (
    "id" TEXT NOT NULL,
    "kind" "AnomalyKind" NOT NULL,
    "severity" "Severity" NOT NULL DEFAULT 'warn',
    "agentId" TEXT,
    "cycleId" TEXT,
    "detail" JSONB NOT NULL,
    "body" TEXT NOT NULL,
    "acknowledgedAt" TIMESTAMP(3),
    "acknowledgedBy" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "Anomaly_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "AgentMetricSnapshot" (
    "id" TEXT NOT NULL,
    "agentId" TEXT NOT NULL,
    "window" TEXT NOT NULL,
    "periodStart" TIMESTAMP(3) NOT NULL,
    "periodEnd" TIMESTAMP(3) NOT NULL,
    "sampleSize" INTEGER NOT NULL,
    "hitRate" DOUBLE PRECISION,
    "brierScore" DOUBLE PRECISION,
    "avgConfidence" DOUBLE PRECISION,
    "avgLatencyMs" DOUBLE PRECISION,
    "p95LatencyMs" DOUBLE PRECISION,
    "totalCostUsd" DOUBLE PRECISION,
    "schemaFailRate" DOUBLE PRECISION,
    "stabilityScore" DOUBLE PRECISION,
    "payload" JSONB,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "AgentMetricSnapshot_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "AgentNote" (
    "id" TEXT NOT NULL,
    "agentId" TEXT NOT NULL,
    "cycleId" TEXT,
    "author" TEXT,
    "body" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "AgentNote_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "SandboxState" (
    "id" TEXT NOT NULL,
    "date" TEXT NOT NULL,
    "allocatedCapital" DOUBLE PRECISION NOT NULL,
    "currentEquity" DOUBLE PRECISION NOT NULL,
    "peakEquity" DOUBLE PRECISION NOT NULL,
    "cashBalance" DOUBLE PRECISION NOT NULL,
    "positionQty" DOUBLE PRECISION NOT NULL DEFAULT 0,
    "positionSymbol" TEXT,
    "positionAvgPrice" DOUBLE PRECISION,
    "drawdownPct" DOUBLE PRECISION NOT NULL DEFAULT 0,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "SandboxState_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "RiskConfig" (
    "id" TEXT NOT NULL,
    "riskTolerancePct" DOUBLE PRECISION NOT NULL DEFAULT 1.0,
    "maxRiskPctPerTrade" DOUBLE PRECISION NOT NULL DEFAULT 0.02,
    "maxConcurrentPositions" INTEGER NOT NULL DEFAULT 3,
    "drawdownHalveAt" DOUBLE PRECISION NOT NULL DEFAULT 0.10,
    "drawdownCloseOnlyAt" DOUBLE PRECISION NOT NULL DEFAULT 0.15,
    "drawdownHardHaltAt" DOUBLE PRECISION NOT NULL DEFAULT 0.20,
    "defaultStopLossPct" DOUBLE PRECISION NOT NULL DEFAULT 0.05,
    "defaultTarget1R" DOUBLE PRECISION NOT NULL DEFAULT 1.6,
    "defaultTarget2R" DOUBLE PRECISION NOT NULL DEFAULT 3.2,
    "defaultTimeStopBars" INTEGER NOT NULL DEFAULT 10,
    "reason" TEXT,
    "author" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "RiskConfig_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "Agent_name_key" ON "Agent"("name");

-- CreateIndex
CREATE INDEX "Agent_kind_idx" ON "Agent"("kind");

-- CreateIndex
CREATE INDEX "PromptVersion_agentId_createdAt_idx" ON "PromptVersion"("agentId", "createdAt");

-- CreateIndex
CREATE UNIQUE INDEX "PromptVersion_agentId_version_key" ON "PromptVersion"("agentId", "version");

-- CreateIndex
CREATE INDEX "Cycle_date_idx" ON "Cycle"("date");

-- CreateIndex
CREATE INDEX "Cycle_symbol_date_idx" ON "Cycle"("symbol", "date");

-- CreateIndex
CREATE INDEX "Cycle_status_idx" ON "Cycle"("status");

-- CreateIndex
CREATE UNIQUE INDEX "Cycle_date_symbol_key" ON "Cycle"("date", "symbol");

-- CreateIndex
CREATE INDEX "AgentRun_agentId_createdAt_idx" ON "AgentRun"("agentId", "createdAt");

-- CreateIndex
CREATE INDEX "AgentRun_cycleId_idx" ON "AgentRun"("cycleId");

-- CreateIndex
CREATE INDEX "AgentRun_promptVersionId_idx" ON "AgentRun"("promptVersionId");

-- CreateIndex
CREATE INDEX "AgentRun_inputHash_idx" ON "AgentRun"("inputHash");

-- CreateIndex
CREATE INDEX "AgentRun_schemaValid_idx" ON "AgentRun"("schemaValid");

-- CreateIndex
CREATE INDEX "AgentRun_runKind_idx" ON "AgentRun"("runKind");

-- CreateIndex
CREATE UNIQUE INDEX "SpecialistAnalysis_agentRunId_key" ON "SpecialistAnalysis"("agentRunId");

-- CreateIndex
CREATE INDEX "SpecialistAnalysis_cycleId_idx" ON "SpecialistAnalysis"("cycleId");

-- CreateIndex
CREATE INDEX "SpecialistAnalysis_agentName_createdAt_idx" ON "SpecialistAnalysis"("agentName", "createdAt");

-- CreateIndex
CREATE UNIQUE INDEX "Deliberation_cycleId_key" ON "Deliberation"("cycleId");

-- CreateIndex
CREATE INDEX "ToolCall_agentRunId_round_idx" ON "ToolCall"("agentRunId", "round");

-- CreateIndex
CREATE INDEX "ToolCall_toolName_idx" ON "ToolCall"("toolName");

-- CreateIndex
CREATE UNIQUE INDEX "TradePlan_cycleId_key" ON "TradePlan"("cycleId");

-- CreateIndex
CREATE UNIQUE INDEX "TradePlan_agentRunId_key" ON "TradePlan"("agentRunId");

-- CreateIndex
CREATE INDEX "TradePlan_symbol_status_idx" ON "TradePlan"("symbol", "status");

-- CreateIndex
CREATE INDEX "TradePlan_status_idx" ON "TradePlan"("status");

-- CreateIndex
CREATE INDEX "TradePlan_createdAt_idx" ON "TradePlan"("createdAt");

-- CreateIndex
CREATE UNIQUE INDEX "TradeOutcome_tradePlanId_key" ON "TradeOutcome"("tradePlanId");

-- CreateIndex
CREATE INDEX "TradeOutcome_closedAt_idx" ON "TradeOutcome"("closedAt");

-- CreateIndex
CREATE INDEX "TradeOutcome_closeReason_idx" ON "TradeOutcome"("closeReason");

-- CreateIndex
CREATE UNIQUE INDEX "Critique_agentRunId_key" ON "Critique"("agentRunId");

-- CreateIndex
CREATE INDEX "Critique_cycleId_idx" ON "Critique"("cycleId");

-- CreateIndex
CREATE INDEX "Critique_author_createdAt_idx" ON "Critique"("author", "createdAt");

-- CreateIndex
CREATE INDEX "Critique_severity_idx" ON "Critique"("severity");

-- CreateIndex
CREATE INDEX "Anomaly_kind_createdAt_idx" ON "Anomaly"("kind", "createdAt");

-- CreateIndex
CREATE INDEX "Anomaly_severity_idx" ON "Anomaly"("severity");

-- CreateIndex
CREATE INDEX "Anomaly_acknowledgedAt_idx" ON "Anomaly"("acknowledgedAt");

-- CreateIndex
CREATE INDEX "AgentMetricSnapshot_agentId_window_idx" ON "AgentMetricSnapshot"("agentId", "window");

-- CreateIndex
CREATE UNIQUE INDEX "AgentMetricSnapshot_agentId_window_periodEnd_key" ON "AgentMetricSnapshot"("agentId", "window", "periodEnd");

-- CreateIndex
CREATE INDEX "AgentNote_agentId_createdAt_idx" ON "AgentNote"("agentId", "createdAt");

-- CreateIndex
CREATE INDEX "AgentNote_cycleId_idx" ON "AgentNote"("cycleId");

-- CreateIndex
CREATE INDEX "SandboxState_date_idx" ON "SandboxState"("date");

-- CreateIndex
CREATE INDEX "SandboxState_createdAt_idx" ON "SandboxState"("createdAt");

-- CreateIndex
CREATE INDEX "RiskConfig_createdAt_idx" ON "RiskConfig"("createdAt");

-- AddForeignKey
ALTER TABLE "PromptVersion" ADD CONSTRAINT "PromptVersion_agentId_fkey" FOREIGN KEY ("agentId") REFERENCES "Agent"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AgentRun" ADD CONSTRAINT "AgentRun_agentId_fkey" FOREIGN KEY ("agentId") REFERENCES "Agent"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AgentRun" ADD CONSTRAINT "AgentRun_promptVersionId_fkey" FOREIGN KEY ("promptVersionId") REFERENCES "PromptVersion"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AgentRun" ADD CONSTRAINT "AgentRun_cycleId_fkey" FOREIGN KEY ("cycleId") REFERENCES "Cycle"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "SpecialistAnalysis" ADD CONSTRAINT "SpecialistAnalysis_cycleId_fkey" FOREIGN KEY ("cycleId") REFERENCES "Cycle"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "SpecialistAnalysis" ADD CONSTRAINT "SpecialistAnalysis_agentRunId_fkey" FOREIGN KEY ("agentRunId") REFERENCES "AgentRun"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Deliberation" ADD CONSTRAINT "Deliberation_cycleId_fkey" FOREIGN KEY ("cycleId") REFERENCES "Cycle"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ToolCall" ADD CONSTRAINT "ToolCall_agentRunId_fkey" FOREIGN KEY ("agentRunId") REFERENCES "AgentRun"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "TradePlan" ADD CONSTRAINT "TradePlan_cycleId_fkey" FOREIGN KEY ("cycleId") REFERENCES "Cycle"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "TradePlan" ADD CONSTRAINT "TradePlan_agentRunId_fkey" FOREIGN KEY ("agentRunId") REFERENCES "AgentRun"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "TradeOutcome" ADD CONSTRAINT "TradeOutcome_tradePlanId_fkey" FOREIGN KEY ("tradePlanId") REFERENCES "TradePlan"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Critique" ADD CONSTRAINT "Critique_cycleId_fkey" FOREIGN KEY ("cycleId") REFERENCES "Cycle"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Critique" ADD CONSTRAINT "Critique_agentRunId_fkey" FOREIGN KEY ("agentRunId") REFERENCES "AgentRun"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Critique" ADD CONSTRAINT "Critique_tradePlanId_fkey" FOREIGN KEY ("tradePlanId") REFERENCES "TradePlan"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Anomaly" ADD CONSTRAINT "Anomaly_cycleId_fkey" FOREIGN KEY ("cycleId") REFERENCES "Cycle"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AgentMetricSnapshot" ADD CONSTRAINT "AgentMetricSnapshot_agentId_fkey" FOREIGN KEY ("agentId") REFERENCES "Agent"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AgentNote" ADD CONSTRAINT "AgentNote_agentId_fkey" FOREIGN KEY ("agentId") REFERENCES "Agent"("id") ON DELETE CASCADE ON UPDATE CASCADE;
