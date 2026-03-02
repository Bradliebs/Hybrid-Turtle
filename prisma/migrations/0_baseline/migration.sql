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
    "gapGuardMode" TEXT NOT NULL DEFAULT 'ALL',
    "gapGuardWeekendATR" REAL NOT NULL DEFAULT 0.75,
    "gapGuardWeekendPct" REAL NOT NULL DEFAULT 3.0,
    "gapGuardDailyATR" REAL NOT NULL DEFAULT 1.0,
    "gapGuardDailyPct" REAL NOT NULL DEFAULT 4.0,
    "startingEquityOverride" REAL,
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
    "updatedAt" DATETIME NOT NULL,
    "yahooTicker" TEXT,
    "isaEligible" BOOLEAN
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
    "realisedPnlGbp" REAL,
    "realisedPnlR" REAL,
    "closedBy" TEXT,
    "whipsawCount" INTEGER NOT NULL DEFAULT 0,
    "notes" TEXT,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL,
    "atr_at_entry" REAL,
    "entry_price" REAL,
    "entry_type" TEXT DEFAULT 'BREAKOUT',
    "initial_R" REAL,
    "initial_stop" REAL,
    "profile_used" TEXT,
    "accountType" TEXT DEFAULT 'invest',
    "breakoutFailureDetectedAt" DATETIME,
    "entryTrigger" REAL,
    CONSTRAINT "Position_stockId_fkey" FOREIGN KEY ("stockId") REFERENCES "Stock" ("id") ON DELETE RESTRICT ON UPDATE CASCADE,
    CONSTRAINT "Position_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User" ("id") ON DELETE RESTRICT ON UPDATE CASCADE
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
    "entryMode" TEXT,
    "stage6Reason" TEXT,
    "rankScore" REAL NOT NULL,
    "passesAllFilters" BOOLEAN NOT NULL,
    "passesRiskGates" BOOLEAN,
    "passesAntiChase" BOOLEAN,
    "shares" REAL,
    "riskDollars" REAL,
    CONSTRAINT "ScanResult_stockId_fkey" FOREIGN KEY ("stockId") REFERENCES "Stock" ("id") ON DELETE RESTRICT ON UPDATE CASCADE,
    CONSTRAINT "ScanResult_scanId_fkey" FOREIGN KEY ("scanId") REFERENCES "Scan" ("id") ON DELETE RESTRICT ON UPDATE CASCADE
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
    "userId" TEXT NOT NULL,
    "positionId" TEXT,
    "ticker" TEXT NOT NULL,
    "tradeDate" DATETIME NOT NULL,
    "tradeType" TEXT NOT NULL,
    "scanStatus" TEXT,
    "bqsScore" REAL,
    "fwsScore" REAL,
    "ncsScore" REAL,
    "dualScoreAction" TEXT,
    "rankScore" REAL,
    "entryPrice" REAL,
    "initialStop" REAL,
    "initialR" REAL,
    "shares" REAL,
    "positionSizeGbp" REAL,
    "atrAtEntry" REAL,
    "adxAtEntry" REAL,
    "regime" TEXT,
    "decision" TEXT NOT NULL,
    "decisionReason" TEXT,
    "hesitationLevel" INTEGER,
    "plannedEntry" REAL,
    "actualFill" REAL,
    "slippagePct" REAL,
    "fillTime" DATETIME,
    "exitPrice" REAL,
    "exitReason" TEXT,
    "finalRMultiple" REAL,
    "gainLossGbp" REAL,
    "daysHeld" INTEGER,
    "whatWentWell" TEXT,
    "whatWentWrong" TEXT,
    "lessonsLearned" TEXT,
    "wouldTakeAgain" BOOLEAN,
    "climaxDetected" BOOLEAN NOT NULL DEFAULT false,
    "whipsawBlocked" BOOLEAN NOT NULL DEFAULT false,
    "breadthRestricted" BOOLEAN NOT NULL DEFAULT false,
    "antiChaseTriggered" BOOLEAN NOT NULL DEFAULT false,
    "tags" TEXT,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL,
    CONSTRAINT "TradeLog_positionId_fkey" FOREIGN KEY ("positionId") REFERENCES "Position" ("id") ON DELETE SET NULL ON UPDATE CASCADE,
    CONSTRAINT "TradeLog_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User" ("id") ON DELETE RESTRICT ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "TradeTag" (
    "tag" TEXT NOT NULL PRIMARY KEY,
    "category" TEXT NOT NULL,
    "description" TEXT NOT NULL
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
    "atrCompressionRatio" REAL,
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

-- CreateTable
CREATE TABLE "Notification" (
    "id" INTEGER NOT NULL PRIMARY KEY AUTOINCREMENT,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "readAt" DATETIME,
    "type" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "message" TEXT NOT NULL,
    "data" TEXT,
    "priority" TEXT NOT NULL DEFAULT 'INFO'
);

-- CreateTable
CREATE TABLE "EarningsCache" (
    "id" INTEGER NOT NULL PRIMARY KEY AUTOINCREMENT,
    "ticker" TEXT NOT NULL,
    "nextEarningsDate" DATETIME,
    "confidence" TEXT NOT NULL DEFAULT 'NONE',
    "fetchedAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "source" TEXT NOT NULL DEFAULT 'YAHOO'
);

-- CreateTable
CREATE TABLE "TradeJournal" (
    "id" INTEGER NOT NULL PRIMARY KEY AUTOINCREMENT,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL,
    "positionId" TEXT NOT NULL,
    "entryNote" TEXT,
    "entryConfidence" INTEGER,
    "closeNote" TEXT,
    "learnedNote" TEXT,
    "entryNoteAt" DATETIME,
    "closeNoteAt" DATETIME,
    CONSTRAINT "TradeJournal_positionId_fkey" FOREIGN KEY ("positionId") REFERENCES "Position" ("id") ON DELETE RESTRICT ON UPDATE CASCADE
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
CREATE INDEX "Heartbeat_timestamp_idx" ON "Heartbeat"("timestamp");

-- CreateIndex
CREATE INDEX "TradeLog_userId_tradeDate_idx" ON "TradeLog"("userId", "tradeDate" DESC);

-- CreateIndex
CREATE INDEX "TradeLog_positionId_idx" ON "TradeLog"("positionId");

-- CreateIndex
CREATE INDEX "TradeLog_ticker_idx" ON "TradeLog"("ticker");

-- CreateIndex
CREATE INDEX "TradeLog_decision_idx" ON "TradeLog"("decision");

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

-- CreateIndex
CREATE INDEX "SnapshotTicker_snapshotId_ticker_idx" ON "SnapshotTicker"("snapshotId", "ticker");

-- CreateIndex
CREATE INDEX "EvRecord_regime_idx" ON "EvRecord"("regime");

-- CreateIndex
CREATE INDEX "EvRecord_sleeve_idx" ON "EvRecord"("sleeve");

-- CreateIndex
CREATE INDEX "EvRecord_atrBucket_idx" ON "EvRecord"("atrBucket");

-- CreateIndex
CREATE INDEX "EvRecord_closedAt_idx" ON "EvRecord"("closedAt");

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
CREATE INDEX "Notification_readAt_idx" ON "Notification"("readAt");

-- CreateIndex
CREATE INDEX "Notification_createdAt_idx" ON "Notification"("createdAt");

-- CreateIndex
CREATE INDEX "Notification_type_idx" ON "Notification"("type");

-- CreateIndex
CREATE UNIQUE INDEX "EarningsCache_ticker_key" ON "EarningsCache"("ticker");

-- CreateIndex
CREATE INDEX "EarningsCache_ticker_idx" ON "EarningsCache"("ticker");

-- CreateIndex
CREATE INDEX "EarningsCache_fetchedAt_idx" ON "EarningsCache"("fetchedAt");

-- CreateIndex
CREATE UNIQUE INDEX "TradeJournal_positionId_key" ON "TradeJournal"("positionId");
