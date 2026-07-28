-- Wallet — persistent shared capital ledger with audit trail.
-- Balance = SUM(WalletTransaction.amount). No denormalized balance column,
-- so the books can never disagree with the ledger.

CREATE TYPE "WalletTxKind" AS ENUM ('deposit', 'withdrawal', 'trade_settlement', 'adjustment');

CREATE TABLE "Wallet" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "description" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "Wallet_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "Wallet_name_key" ON "Wallet"("name");

CREATE TABLE "WalletTransaction" (
    "id" TEXT NOT NULL,
    "walletId" TEXT NOT NULL,
    "kind" "WalletTxKind" NOT NULL,
    "amount" DOUBLE PRECISION NOT NULL,
    "reason" TEXT NOT NULL,
    "author" TEXT NOT NULL,
    "tradePlanId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "WalletTransaction_pkey" PRIMARY KEY ("id")
);

-- Idempotency on settler reruns: at most one settlement per TradePlan.
CREATE UNIQUE INDEX "WalletTransaction_tradePlanId_key" ON "WalletTransaction"("tradePlanId");
CREATE INDEX "WalletTransaction_walletId_createdAt_idx" ON "WalletTransaction"("walletId", "createdAt");
CREATE INDEX "WalletTransaction_kind_idx" ON "WalletTransaction"("kind");

ALTER TABLE "WalletTransaction"
  ADD CONSTRAINT "WalletTransaction_walletId_fkey"
  FOREIGN KEY ("walletId") REFERENCES "Wallet"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- Seed the default wallet at zero balance. Deposits via the UI/API add to it
-- additively; never overwrite. Migration up only — the seed file also handles
-- this idempotently for fresh dev DBs.
INSERT INTO "Wallet" ("id", "name", "description", "createdAt")
VALUES (gen_random_uuid(), 'primary', 'Default shared wallet for agent trading.', CURRENT_TIMESTAMP)
ON CONFLICT ("name") DO NOTHING;
