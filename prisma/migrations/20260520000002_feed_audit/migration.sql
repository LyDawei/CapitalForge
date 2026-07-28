-- FeedFetch + FeedConsumption — auditable external-data pipeline.
--
-- Every external data pull (Alpaca news, Finnhub earnings, FRED series, etc.)
-- writes a FeedFetch row. Every agent run that consumed that data writes a
-- FeedConsumption row linking back to the fetch + optionally tagging the
-- influence on the agent's decision. Together they answer "what decisions
-- were made because of this source?"

CREATE TABLE "FeedFetch" (
    "id"           TEXT NOT NULL,
    "source"       TEXT NOT NULL,
    "symbol"       TEXT,
    "url"          TEXT,
    "fetchedAt"    TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "payload"      JSONB NOT NULL,
    "latencyMs"    INTEGER NOT NULL,
    "costUsd"      DOUBLE PRECISION,
    "errored"      BOOLEAN NOT NULL DEFAULT false,
    "errorMessage" TEXT,

    CONSTRAINT "FeedFetch_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "FeedFetch_source_fetchedAt_idx" ON "FeedFetch"("source", "fetchedAt");
CREATE INDEX "FeedFetch_symbol_fetchedAt_idx" ON "FeedFetch"("symbol", "fetchedAt");
CREATE INDEX "FeedFetch_errored_idx"          ON "FeedFetch"("errored");

CREATE TABLE "FeedConsumption" (
    "id"           TEXT NOT NULL,
    "feedFetchId"  TEXT NOT NULL,
    "agentRunId"   TEXT NOT NULL,
    "cycleId"      TEXT,
    "influenceTag" TEXT,
    "createdAt"    TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "FeedConsumption_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "FeedConsumption_agentRunId_idx"  ON "FeedConsumption"("agentRunId");
CREATE INDEX "FeedConsumption_feedFetchId_idx" ON "FeedConsumption"("feedFetchId");
CREATE INDEX "FeedConsumption_cycleId_idx"     ON "FeedConsumption"("cycleId");

ALTER TABLE "FeedConsumption"
  ADD CONSTRAINT "FeedConsumption_feedFetchId_fkey"
  FOREIGN KEY ("feedFetchId") REFERENCES "FeedFetch"("id")
  ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "FeedConsumption"
  ADD CONSTRAINT "FeedConsumption_agentRunId_fkey"
  FOREIGN KEY ("agentRunId") REFERENCES "AgentRun"("id")
  ON DELETE CASCADE ON UPDATE CASCADE;
