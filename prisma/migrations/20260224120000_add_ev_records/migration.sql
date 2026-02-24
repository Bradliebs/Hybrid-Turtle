-- CreateTable
CREATE TABLE "EvRecord" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "tradeId" TEXT NOT NULL,
    "regime" TEXT NOT NULL,
    "atrBucket" TEXT NOT NULL,
    "cluster" TEXT,
    "sleeve" TEXT NOT NULL,
    "entryNCS" REAL,
    "outcome" TEXT NOT NULL,
    "rMultiple" REAL NOT NULL,
    "closedAt" DATETIME NOT NULL
);

-- CreateIndex
CREATE INDEX "EvRecord_regime_idx" ON "EvRecord"("regime");

-- CreateIndex
CREATE INDEX "EvRecord_sleeve_idx" ON "EvRecord"("sleeve");

-- CreateIndex
CREATE INDEX "EvRecord_atrBucket_idx" ON "EvRecord"("atrBucket");

-- CreateIndex
CREATE INDEX "EvRecord_closedAt_idx" ON "EvRecord"("closedAt");
