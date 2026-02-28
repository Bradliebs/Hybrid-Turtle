-- Catch-up migration: captures drift from db push + adds ExecutionLog table + isaEligible column.
-- All changes below are already applied to the database via prisma db push.
-- This migration file exists to align the migration history with the actual DB state.

-- AlterTable
ALTER TABLE "Position" ADD COLUMN "accountType" TEXT DEFAULT 'invest';

-- AlterTable
ALTER TABLE "Stock" ADD COLUMN "isaEligible" BOOLEAN;
ALTER TABLE "Stock" ADD COLUMN "yahooTicker" TEXT;

-- CreateTable
CREATE TABLE "CorrelationFlag" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "tickerA" TEXT NOT NULL,
    "tickerB" TEXT NOT NULL,
    "correlation" REAL NOT NULL,
    "flag" TEXT NOT NULL,
    "computedAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP
);

-- CreateTable
CREATE TABLE "ExecutionLog" (
    "id" INTEGER NOT NULL PRIMARY KEY AUTOINCREMENT,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "ticker" TEXT NOT NULL,
    "phase" TEXT NOT NULL,
    "orderId" TEXT,
    "requestBody" TEXT NOT NULL,
    "responseStatus" INTEGER,
    "responseBody" TEXT,
    "stopPrice" REAL,
    "quantity" REAL,
    "accountType" TEXT NOT NULL,
    "error" TEXT
);

-- RedefineTables
PRAGMA defer_foreign_keys=ON;
PRAGMA foreign_keys=OFF;
CREATE TABLE "new_ScanResult" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "scanId" TEXT NOT NULL,
    "stockId" TEXT NOT NULL,
    "price" REAL NOT NULL,
    "ma200" REAL NOT NULL,
    "adx" REAL NOT NULL,
    "plusDI" REAL NOT NULL,
    "minusDI" REAL NOT NULL,
    "atrPercent" REAL NOT NULL,
    "efficiency" REAL NOT NULL,
    "twentyDayHigh" REAL NOT NULL,
    "entryTrigger" REAL NOT NULL,
    "stopPrice" REAL NOT NULL,
    "distancePercent" REAL NOT NULL,
    "status" TEXT NOT NULL,
    "entryMode" TEXT,
    "stage6Reason" TEXT,
    "rankScore" REAL NOT NULL,
    "passesAllFilters" BOOLEAN NOT NULL,
    "passesRiskGates" BOOLEAN,
    "passesAntiChase" BOOLEAN,
    "shares" REAL,
    "riskDollars" REAL,
    CONSTRAINT "ScanResult_scanId_fkey" FOREIGN KEY ("scanId") REFERENCES "Scan" ("id") ON DELETE RESTRICT ON UPDATE CASCADE,
    CONSTRAINT "ScanResult_stockId_fkey" FOREIGN KEY ("stockId") REFERENCES "Stock" ("id") ON DELETE RESTRICT ON UPDATE CASCADE
);
INSERT INTO "new_ScanResult" ("adx", "atrPercent", "distancePercent", "efficiency", "entryMode", "entryTrigger", "id", "ma200", "minusDI", "passesAllFilters", "passesAntiChase", "passesRiskGates", "plusDI", "price", "rankScore", "riskDollars", "scanId", "shares", "stage6Reason", "status", "stockId", "stopPrice", "twentyDayHigh") SELECT "adx", "atrPercent", "distancePercent", "efficiency", "entryMode", "entryTrigger", "id", "ma200", "minusDI", "passesAllFilters", "passesAntiChase", "passesRiskGates", "plusDI", "price", "rankScore", "riskDollars", "scanId", "shares", "stage6Reason", "status", "stockId", "stopPrice", "twentyDayHigh" FROM "ScanResult";
DROP TABLE "ScanResult";
ALTER TABLE "new_ScanResult" RENAME TO "ScanResult";
CREATE INDEX "ScanResult_scanId_idx" ON "ScanResult"("scanId");
CREATE INDEX "ScanResult_stockId_idx" ON "ScanResult"("stockId");
CREATE TABLE "new_SnapshotTicker" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "snapshotId" TEXT NOT NULL,
    "ticker" TEXT NOT NULL,
    "name" TEXT,
    "sleeve" TEXT,
    "status" TEXT,
    "currency" TEXT,
    "close" REAL NOT NULL DEFAULT 0,
    "atr14" REAL NOT NULL DEFAULT 0,
    "atrPct" REAL NOT NULL DEFAULT 0,
    "adx14" REAL NOT NULL DEFAULT 0,
    "plusDi" REAL NOT NULL DEFAULT 0,
    "minusDi" REAL NOT NULL DEFAULT 0,
    "weeklyAdx" REAL NOT NULL DEFAULT 0,
    "volRatio" REAL NOT NULL DEFAULT 1,
    "dollarVol20" REAL NOT NULL DEFAULT 0,
    "liquidityOk" BOOLEAN NOT NULL DEFAULT true,
    "bisScore" REAL NOT NULL DEFAULT 0,
    "marketRegime" TEXT NOT NULL DEFAULT 'NEUTRAL',
    "marketRegimeStable" BOOLEAN NOT NULL DEFAULT true,
    "volRegime" TEXT DEFAULT 'NORMAL_VOL',
    "dualRegimeAligned" BOOLEAN NOT NULL DEFAULT true,
    "high20" REAL NOT NULL DEFAULT 0,
    "high55" REAL NOT NULL DEFAULT 0,
    "distanceTo20dHighPct" REAL NOT NULL DEFAULT 0,
    "distanceTo55dHighPct" REAL NOT NULL DEFAULT 0,
    "entryTrigger" REAL NOT NULL DEFAULT 0,
    "stopLevel" REAL NOT NULL DEFAULT 0,
    "chasing20Last5" BOOLEAN NOT NULL DEFAULT false,
    "chasing55Last5" BOOLEAN NOT NULL DEFAULT false,
    "atrSpiking" BOOLEAN NOT NULL DEFAULT false,
    "atrCollapsing" BOOLEAN NOT NULL DEFAULT false,
    "rsVsBenchmarkPct" REAL NOT NULL DEFAULT 0,
    "daysToEarnings" INTEGER,
    "earningsInNext5d" BOOLEAN NOT NULL DEFAULT false,
    "clusterName" TEXT,
    "superClusterName" TEXT,
    "clusterExposurePct" REAL NOT NULL DEFAULT 0,
    "superClusterExposurePct" REAL NOT NULL DEFAULT 0,
    "maxClusterPct" REAL NOT NULL DEFAULT 0,
    "maxSuperClusterPct" REAL NOT NULL DEFAULT 0,
    "rawJson" TEXT,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "SnapshotTicker_snapshotId_fkey" FOREIGN KEY ("snapshotId") REFERENCES "Snapshot" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);
INSERT INTO "new_SnapshotTicker" ("adx14", "atr14", "atrCollapsing", "atrPct", "atrSpiking", "bisScore", "chasing20Last5", "chasing55Last5", "close", "clusterExposurePct", "clusterName", "createdAt", "currency", "daysToEarnings", "distanceTo20dHighPct", "distanceTo55dHighPct", "dollarVol20", "dualRegimeAligned", "earningsInNext5d", "entryTrigger", "high20", "high55", "id", "liquidityOk", "marketRegime", "marketRegimeStable", "maxClusterPct", "maxSuperClusterPct", "minusDi", "name", "plusDi", "rawJson", "rsVsBenchmarkPct", "sleeve", "snapshotId", "status", "stopLevel", "superClusterExposurePct", "superClusterName", "ticker", "volRatio", "volRegime", "weeklyAdx") SELECT "adx14", "atr14", "atrCollapsing", "atrPct", "atrSpiking", coalesce("bisScore", 0) AS "bisScore", "chasing20Last5", "chasing55Last5", "close", "clusterExposurePct", "clusterName", "createdAt", "currency", "daysToEarnings", "distanceTo20dHighPct", "distanceTo55dHighPct", "dollarVol20", "dualRegimeAligned", "earningsInNext5d", "entryTrigger", "high20", "high55", "id", "liquidityOk", "marketRegime", "marketRegimeStable", "maxClusterPct", "maxSuperClusterPct", "minusDi", "name", "plusDi", "rawJson", "rsVsBenchmarkPct", "sleeve", "snapshotId", "status", "stopLevel", "superClusterExposurePct", "superClusterName", "ticker", "volRatio", "volRegime", "weeklyAdx" FROM "SnapshotTicker";
DROP TABLE "SnapshotTicker";
ALTER TABLE "new_SnapshotTicker" RENAME TO "SnapshotTicker";
CREATE INDEX "SnapshotTicker_snapshotId_idx" ON "SnapshotTicker"("snapshotId");
CREATE INDEX "SnapshotTicker_ticker_idx" ON "SnapshotTicker"("ticker");
CREATE INDEX "SnapshotTicker_snapshotId_ticker_idx" ON "SnapshotTicker"("snapshotId", "ticker");
CREATE TABLE "new_User" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "email" TEXT NOT NULL,
    "name" TEXT,
    "password" TEXT NOT NULL,
    "riskProfile" TEXT NOT NULL DEFAULT 'BALANCED',
    "equity" REAL NOT NULL DEFAULT 10000,
    "t212ApiKey" TEXT,
    "t212ApiSecret" TEXT,
    "t212Environment" TEXT NOT NULL DEFAULT 'demo',
    "t212Connected" BOOLEAN NOT NULL DEFAULT false,
    "t212LastSync" DATETIME,
    "t212AccountId" TEXT,
    "t212Currency" TEXT,
    "t212Cash" REAL,
    "t212Invested" REAL,
    "t212UnrealisedPL" REAL,
    "t212TotalValue" REAL,
    "t212IsaApiKey" TEXT,
    "t212IsaApiSecret" TEXT,
    "t212IsaConnected" BOOLEAN NOT NULL DEFAULT false,
    "t212IsaLastSync" DATETIME,
    "t212IsaAccountId" TEXT,
    "t212IsaCurrency" TEXT,
    "t212IsaCash" REAL,
    "t212IsaInvested" REAL,
    "t212IsaUnrealisedPL" REAL,
    "t212IsaTotalValue" REAL,
    "marketDataProvider" TEXT NOT NULL DEFAULT 'yahoo',
    "eodhApiKey" TEXT,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL
);
INSERT INTO "new_User" ("createdAt", "email", "equity", "id", "name", "password", "riskProfile", "t212AccountId", "t212ApiKey", "t212ApiSecret", "t212Cash", "t212Connected", "t212Currency", "t212Environment", "t212Invested", "t212LastSync", "t212TotalValue", "t212UnrealisedPL", "updatedAt") SELECT "createdAt", "email", "equity", "id", "name", "password", "riskProfile", "t212AccountId", "t212ApiKey", "t212ApiSecret", "t212Cash", "t212Connected", "t212Currency", "t212Environment", "t212Invested", "t212LastSync", "t212TotalValue", "t212UnrealisedPL", "updatedAt" FROM "User";
DROP TABLE "User";
ALTER TABLE "new_User" RENAME TO "User";
CREATE UNIQUE INDEX "User_email_key" ON "User"("email");
PRAGMA foreign_keys=ON;
PRAGMA defer_foreign_keys=OFF;

-- CreateIndex
CREATE INDEX "CorrelationFlag_tickerA_idx" ON "CorrelationFlag"("tickerA");

-- CreateIndex
CREATE INDEX "CorrelationFlag_tickerB_idx" ON "CorrelationFlag"("tickerB");

-- CreateIndex
CREATE INDEX "CorrelationFlag_computedAt_idx" ON "CorrelationFlag"("computedAt");

-- CreateIndex
CREATE UNIQUE INDEX "CorrelationFlag_tickerA_tickerB_key" ON "CorrelationFlag"("tickerA", "tickerB");

-- CreateIndex
CREATE INDEX "ExecutionLog_ticker_idx" ON "ExecutionLog"("ticker");

-- CreateIndex
CREATE INDEX "ExecutionLog_createdAt_idx" ON "ExecutionLog"("createdAt");

-- CreateIndex
CREATE INDEX "ExecutionLog_phase_idx" ON "ExecutionLog"("phase");

-- CreateIndex
CREATE INDEX "Heartbeat_timestamp_idx" ON "Heartbeat"("timestamp");
