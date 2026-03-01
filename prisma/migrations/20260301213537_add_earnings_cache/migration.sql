-- AlterTable
ALTER TABLE "Position" ADD COLUMN "breakoutFailureDetectedAt" DATETIME;
ALTER TABLE "Position" ADD COLUMN "entryTrigger" REAL;

-- CreateTable
CREATE TABLE "EarningsCache" (
    "id" INTEGER NOT NULL PRIMARY KEY AUTOINCREMENT,
    "ticker" TEXT NOT NULL,
    "nextEarningsDate" DATETIME,
    "confidence" TEXT NOT NULL DEFAULT 'NONE',
    "fetchedAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "source" TEXT NOT NULL DEFAULT 'YAHOO'
);

-- CreateIndex
CREATE UNIQUE INDEX "EarningsCache_ticker_key" ON "EarningsCache"("ticker");

-- CreateIndex
CREATE INDEX "EarningsCache_ticker_idx" ON "EarningsCache"("ticker");

-- CreateIndex
CREATE INDEX "EarningsCache_fetchedAt_idx" ON "EarningsCache"("fetchedAt");
