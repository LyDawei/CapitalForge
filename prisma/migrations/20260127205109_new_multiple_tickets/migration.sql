/*
  Warnings:

  - A unique constraint covering the columns `[date,symbol]` on the table `DailyCycle` will be added. If there are existing duplicate values, this will fail.

*/
-- DropIndex
DROP INDEX "DailyCycle_date_key";

-- CreateIndex
CREATE UNIQUE INDEX "DailyCycle_date_symbol_key" ON "DailyCycle"("date", "symbol");
