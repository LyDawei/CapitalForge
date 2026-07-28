-- Watchlist proposal pipeline. Operator-gated discovery flow: scout agent
-- surfaces candidates, you approve or reject, approval appends to the live
-- StrategyConfig.watchlist via the existing append-only ledger pattern.
-- Rejected rows stay for audit so the scout doesn't silently re-propose the
-- same name without context.

CREATE TYPE "WatchlistProposalStatus" AS ENUM ('proposed', 'approved', 'rejected', 'superseded');

CREATE TABLE "WatchlistProposal" (
    "id"              TEXT NOT NULL,
    "symbol"          TEXT NOT NULL,
    "status"          "WatchlistProposalStatus" NOT NULL DEFAULT 'proposed',
    "proposedBy"      TEXT NOT NULL,
    "agentRunId"      TEXT,
    "viabilityScore"  DOUBLE PRECISION,
    "thesis"          TEXT,
    "concerns"        TEXT[] NOT NULL DEFAULT ARRAY[]::TEXT[],
    "rationale"       TEXT[] NOT NULL DEFAULT ARRAY[]::TEXT[],
    "quantSnapshot"   JSONB,
    "proposedAt"      TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "decidedAt"       TIMESTAMP(3),
    "decidedBy"       TEXT,
    "rejectedReason"  TEXT,
    "supersededById"  TEXT,

    CONSTRAINT "WatchlistProposal_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "WatchlistProposal_status_proposedAt_idx" ON "WatchlistProposal"("status", "proposedAt");
CREATE INDEX "WatchlistProposal_symbol_status_idx"    ON "WatchlistProposal"("symbol", "status");
CREATE INDEX "WatchlistProposal_agentRunId_idx"       ON "WatchlistProposal"("agentRunId");
