-- Add 'scout' to the AgentKind enum. Must be its own migration: Postgres
-- doesn't allow ALTER TYPE ADD VALUE in the same transaction as other DDL
-- that uses the new value.

ALTER TYPE "AgentKind" ADD VALUE 'scout';
