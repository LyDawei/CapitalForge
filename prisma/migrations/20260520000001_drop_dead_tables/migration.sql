-- Drop three tables that were defined in the original schema but never read
-- or written by any runtime path (verified by audit on feat/V2-shadow-wallet-alpaca):
--
--   - SandboxState: V1 holdover, replaced by the new Wallet model.
--   - AgentMetricSnapshot: intended pre-computed rolling metrics, never wired.
--     Audit endpoints recompute on every call instead.
--   - AgentNote: intended human annotation surface, no CRUD ever built.
--
-- No data preservation needed — these tables are empty in every environment.

DROP TABLE IF EXISTS "AgentMetricSnapshot";
DROP TABLE IF EXISTS "AgentNote";
DROP TABLE IF EXISTS "SandboxState";
