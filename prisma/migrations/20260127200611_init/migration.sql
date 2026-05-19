-- CreateTable
CREATE TABLE "DailyCycle" (
    "id" TEXT NOT NULL,
    "date" TEXT NOT NULL,
    "symbol" TEXT NOT NULL,
    "technicalData" JSONB NOT NULL,
    "status" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "DailyCycle_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "AgentEvaluation" (
    "id" TEXT NOT NULL,
    "cycleId" TEXT NOT NULL,
    "agentName" TEXT NOT NULL,
    "promptVersion" TEXT NOT NULL,
    "bullishScore" DOUBLE PRECISION NOT NULL,
    "confidence" DOUBLE PRECISION NOT NULL,
    "rationale" TEXT[],
    "rawResponse" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "AgentEvaluation_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "AggregatedDecision" (
    "id" TEXT NOT NULL,
    "cycleId" TEXT NOT NULL,
    "weightedScore" DOUBLE PRECISION NOT NULL,
    "decision" TEXT NOT NULL,
    "riskBlocked" BOOLEAN NOT NULL DEFAULT false,
    "riskReason" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "AggregatedDecision_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Trade" (
    "id" TEXT NOT NULL,
    "cycleId" TEXT NOT NULL,
    "alpacaOrderId" TEXT NOT NULL,
    "side" TEXT NOT NULL,
    "symbol" TEXT NOT NULL,
    "quantity" DOUBLE PRECISION NOT NULL,
    "filledPrice" DOUBLE PRECISION,
    "status" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "filledAt" TIMESTAMP(3),

    CONSTRAINT "Trade_pkey" PRIMARY KEY ("id")
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
CREATE TABLE "PromptVersion" (
    "id" TEXT NOT NULL,
    "agentName" TEXT NOT NULL,
    "version" TEXT NOT NULL,
    "template" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "PromptVersion_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "DailyCycle_date_key" ON "DailyCycle"("date");

-- CreateIndex
CREATE INDEX "AgentEvaluation_cycleId_idx" ON "AgentEvaluation"("cycleId");

-- CreateIndex
CREATE UNIQUE INDEX "AggregatedDecision_cycleId_key" ON "AggregatedDecision"("cycleId");

-- CreateIndex
CREATE UNIQUE INDEX "Trade_cycleId_key" ON "Trade"("cycleId");

-- CreateIndex
CREATE UNIQUE INDEX "SandboxState_date_key" ON "SandboxState"("date");

-- CreateIndex
CREATE INDEX "SandboxState_date_idx" ON "SandboxState"("date");

-- CreateIndex
CREATE UNIQUE INDEX "PromptVersion_agentName_version_key" ON "PromptVersion"("agentName", "version");

-- AddForeignKey
ALTER TABLE "AgentEvaluation" ADD CONSTRAINT "AgentEvaluation_cycleId_fkey" FOREIGN KEY ("cycleId") REFERENCES "DailyCycle"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AggregatedDecision" ADD CONSTRAINT "AggregatedDecision_cycleId_fkey" FOREIGN KEY ("cycleId") REFERENCES "DailyCycle"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Trade" ADD CONSTRAINT "Trade_cycleId_fkey" FOREIGN KEY ("cycleId") REFERENCES "DailyCycle"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
