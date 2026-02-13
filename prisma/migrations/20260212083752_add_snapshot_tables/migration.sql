-- CreateTable
CREATE TABLE "User" (
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
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL
);

-- CreateTable
CREATE TABLE "Stock" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "ticker" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "sleeve" TEXT NOT NULL,
    "sector" TEXT,
    "cluster" TEXT,
    "superCluster" TEXT,
    "region" TEXT,
    "currency" TEXT,
    "t212Ticker" TEXT,
    "active" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL
);

-- CreateTable
CREATE TABLE "Position" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "userId" TEXT NOT NULL,
    "stockId" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'OPEN',
    "source" TEXT NOT NULL DEFAULT 'manual',
    "t212Ticker" TEXT,
    "entryPrice" REAL NOT NULL,
    "entryDate" DATETIME NOT NULL,
    "shares" REAL NOT NULL,
    "stopLoss" REAL NOT NULL,
    "initialRisk" REAL NOT NULL,
    "currentStop" REAL NOT NULL,
    "protectionLevel" TEXT NOT NULL DEFAULT 'INITIAL',
    "exitPrice" REAL,
    "exitDate" DATETIME,
    "exitReason" TEXT,
    "exitProfitR" REAL,
    "whipsawCount" INTEGER NOT NULL DEFAULT 0,
    "notes" TEXT,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL,
    CONSTRAINT "Position_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User" ("id") ON DELETE RESTRICT ON UPDATE CASCADE,
    CONSTRAINT "Position_stockId_fkey" FOREIGN KEY ("stockId") REFERENCES "Stock" ("id") ON DELETE RESTRICT ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "StopHistory" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "positionId" TEXT NOT NULL,
    "oldStop" REAL NOT NULL,
    "newStop" REAL NOT NULL,
    "level" TEXT NOT NULL,
    "reason" TEXT NOT NULL,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "StopHistory_positionId_fkey" FOREIGN KEY ("positionId") REFERENCES "Position" ("id") ON DELETE RESTRICT ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "Scan" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "userId" TEXT NOT NULL,
    "runDate" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "regime" TEXT NOT NULL,
    CONSTRAINT "Scan_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User" ("id") ON DELETE RESTRICT ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "ScanResult" (
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
    "rankScore" REAL NOT NULL,
    "passesAllFilters" BOOLEAN NOT NULL,
    "shares" INTEGER,
    "riskDollars" REAL,
    CONSTRAINT "ScanResult_scanId_fkey" FOREIGN KEY ("scanId") REFERENCES "Scan" ("id") ON DELETE RESTRICT ON UPDATE CASCADE,
    CONSTRAINT "ScanResult_stockId_fkey" FOREIGN KEY ("stockId") REFERENCES "Stock" ("id") ON DELETE RESTRICT ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "ExecutionPlan" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "userId" TEXT NOT NULL,
    "weekOf" DATETIME NOT NULL,
    "phase" TEXT NOT NULL,
    "candidates" TEXT NOT NULL,
    "notes" TEXT,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL,
    CONSTRAINT "ExecutionPlan_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User" ("id") ON DELETE RESTRICT ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "HealthCheck" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "userId" TEXT NOT NULL,
    "runDate" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "overall" TEXT NOT NULL,
    "checks" TEXT NOT NULL,
    "details" TEXT NOT NULL,
    CONSTRAINT "HealthCheck_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User" ("id") ON DELETE RESTRICT ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "Heartbeat" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "timestamp" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "status" TEXT NOT NULL,
    "details" TEXT
);

-- CreateTable
CREATE TABLE "TradeLog" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "positionId" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "ticker" TEXT NOT NULL,
    "action" TEXT NOT NULL,
    "expectedPrice" REAL NOT NULL,
    "actualPrice" REAL,
    "slippagePercent" REAL,
    "shares" REAL NOT NULL,
    "reason" TEXT,
    "rMultipleAtExit" REAL,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "TradeLog_positionId_fkey" FOREIGN KEY ("positionId") REFERENCES "Position" ("id") ON DELETE RESTRICT ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "EquitySnapshot" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "userId" TEXT NOT NULL,
    "equity" REAL NOT NULL,
    "openRiskPercent" REAL,
    "capturedAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "EquitySnapshot_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User" ("id") ON DELETE RESTRICT ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "RegimeHistory" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "date" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "benchmark" TEXT NOT NULL DEFAULT 'SPY',
    "regime" TEXT NOT NULL,
    "spyPrice" REAL,
    "spyMa200" REAL,
    "vwrlPrice" REAL,
    "vwrlMa200" REAL,
    "breadthPct" REAL,
    "adx" REAL,
    "consecutive" INTEGER NOT NULL DEFAULT 1
);

-- CreateTable
CREATE TABLE "SnapshotTicker" (
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
    "volRatio" REAL NOT NULL DEFAULT 1,
    "dollarVol20" REAL NOT NULL DEFAULT 0,
    "liquidityOk" BOOLEAN NOT NULL DEFAULT true,
    "marketRegime" TEXT NOT NULL DEFAULT 'NEUTRAL',
    "marketRegimeStable" BOOLEAN NOT NULL DEFAULT true,
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

-- CreateTable
CREATE TABLE "Snapshot" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "source" TEXT NOT NULL DEFAULT 'upload',
    "filename" TEXT,
    "rowCount" INTEGER NOT NULL DEFAULT 0,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP
);

-- CreateIndex
CREATE UNIQUE INDEX "User_email_key" ON "User"("email");

-- CreateIndex
CREATE UNIQUE INDEX "Stock_ticker_key" ON "Stock"("ticker");

-- CreateIndex
CREATE INDEX "Position_userId_idx" ON "Position"("userId");

-- CreateIndex
CREATE INDEX "Position_stockId_idx" ON "Position"("stockId");

-- CreateIndex
CREATE INDEX "Position_status_idx" ON "Position"("status");

-- CreateIndex
CREATE INDEX "StopHistory_positionId_idx" ON "StopHistory"("positionId");

-- CreateIndex
CREATE INDEX "Scan_userId_idx" ON "Scan"("userId");

-- CreateIndex
CREATE INDEX "ScanResult_scanId_idx" ON "ScanResult"("scanId");

-- CreateIndex
CREATE INDEX "ScanResult_stockId_idx" ON "ScanResult"("stockId");

-- CreateIndex
CREATE INDEX "ExecutionPlan_userId_idx" ON "ExecutionPlan"("userId");

-- CreateIndex
CREATE INDEX "HealthCheck_userId_idx" ON "HealthCheck"("userId");

-- CreateIndex
CREATE INDEX "TradeLog_positionId_idx" ON "TradeLog"("positionId");

-- CreateIndex
CREATE INDEX "TradeLog_userId_idx" ON "TradeLog"("userId");

-- CreateIndex
CREATE INDEX "TradeLog_ticker_idx" ON "TradeLog"("ticker");

-- CreateIndex
CREATE INDEX "EquitySnapshot_userId_idx" ON "EquitySnapshot"("userId");

-- CreateIndex
CREATE INDEX "EquitySnapshot_capturedAt_idx" ON "EquitySnapshot"("capturedAt");

-- CreateIndex
CREATE INDEX "RegimeHistory_date_idx" ON "RegimeHistory"("date");

-- CreateIndex
CREATE INDEX "RegimeHistory_benchmark_idx" ON "RegimeHistory"("benchmark");

-- CreateIndex
CREATE INDEX "SnapshotTicker_snapshotId_idx" ON "SnapshotTicker"("snapshotId");

-- CreateIndex
CREATE INDEX "SnapshotTicker_ticker_idx" ON "SnapshotTicker"("ticker");
