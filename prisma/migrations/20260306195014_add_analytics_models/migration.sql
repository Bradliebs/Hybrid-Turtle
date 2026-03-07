-- Add scan mode (FULL vs BENCHMARK) to ScanResult
ALTER TABLE "ScanResult" ADD COLUMN "mode" TEXT NOT NULL DEFAULT 'FULL';

-- FilterAttribution: per-candidate filter pass/fail record
CREATE TABLE "FilterAttribution" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "scanId" TEXT NOT NULL,
    "ticker" TEXT NOT NULL,
    "scanDate" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "regime" TEXT NOT NULL,
    "sleeve" TEXT NOT NULL,
    "status" TEXT NOT NULL,
    "priceAboveMa200" BOOLEAN NOT NULL,
    "ma200Value" REAL NOT NULL DEFAULT 0,
    "adxAbove20" BOOLEAN NOT NULL,
    "adxValue" REAL NOT NULL DEFAULT 0,
    "plusDIAboveMinusDI" BOOLEAN NOT NULL,
    "plusDIValue" REAL NOT NULL DEFAULT 0,
    "minusDIValue" REAL NOT NULL DEFAULT 0,
    "atrPctBelow8" BOOLEAN NOT NULL,
    "atrPctValue" REAL NOT NULL DEFAULT 0,
    "dataQuality" BOOLEAN NOT NULL,
    "efficiencyAbove30" BOOLEAN NOT NULL,
    "efficiencyValue" REAL NOT NULL DEFAULT 0,
    "hurstExponent" REAL,
    "hurstWarn" BOOLEAN NOT NULL DEFAULT false,
    "atrSpiking" BOOLEAN NOT NULL DEFAULT false,
    "atrSpikeAction" TEXT,
    "distancePct" REAL NOT NULL DEFAULT 0,
    "passesRiskGates" BOOLEAN NOT NULL DEFAULT true,
    "riskGatesFailed" TEXT,
    "passesAntiChase" BOOLEAN NOT NULL DEFAULT true,
    "antiChaseReason" TEXT,
    "earningsAction" TEXT,
    "daysToEarnings" INTEGER,
    "passesAllFilters" BOOLEAN NOT NULL,
    "rankScore" REAL NOT NULL DEFAULT 0,
    "tradeLogId" TEXT,
    "outcomeR" REAL
);

CREATE INDEX "FilterAttribution_scanId_idx" ON "FilterAttribution"("scanId");
CREATE INDEX "FilterAttribution_ticker_idx" ON "FilterAttribution"("ticker");
CREATE INDEX "FilterAttribution_scanDate_idx" ON "FilterAttribution"("scanDate");
CREATE INDEX "FilterAttribution_regime_idx" ON "FilterAttribution"("regime");

-- ScoreBreakdown: full BQS/FWS/NCS component decomposition per snapshot ticker
CREATE TABLE "ScoreBreakdown" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "snapshotId" TEXT NOT NULL,
    "ticker" TEXT NOT NULL,
    "scoredAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "regime" TEXT NOT NULL,
    "sleeve" TEXT,
    "bqsTrend" REAL NOT NULL DEFAULT 0,
    "bqsDirection" REAL NOT NULL DEFAULT 0,
    "bqsVolatility" REAL NOT NULL DEFAULT 0,
    "bqsProximity" REAL NOT NULL DEFAULT 0,
    "bqsTailwind" REAL NOT NULL DEFAULT 0,
    "bqsRs" REAL NOT NULL DEFAULT 0,
    "bqsVolBonus" REAL NOT NULL DEFAULT 0,
    "bqsWeeklyAdx" REAL NOT NULL DEFAULT 0,
    "bqsBis" REAL NOT NULL DEFAULT 0,
    "bqsHurst" REAL NOT NULL DEFAULT 0,
    "bqsTotal" REAL NOT NULL DEFAULT 0,
    "fwsVolume" REAL NOT NULL DEFAULT 0,
    "fwsExtension" REAL NOT NULL DEFAULT 0,
    "fwsMarginalTrend" REAL NOT NULL DEFAULT 0,
    "fwsVolShock" REAL NOT NULL DEFAULT 0,
    "fwsRegimeInstability" REAL NOT NULL DEFAULT 0,
    "fwsTotal" REAL NOT NULL DEFAULT 0,
    "penaltyEarnings" REAL NOT NULL DEFAULT 0,
    "penaltyCluster" REAL NOT NULL DEFAULT 0,
    "penaltySuperCluster" REAL NOT NULL DEFAULT 0,
    "baseNcs" REAL NOT NULL DEFAULT 0,
    "ncsTotal" REAL NOT NULL DEFAULT 0,
    "actionNote" TEXT,
    "tradeLogId" TEXT,
    "outcomeR" REAL
);

CREATE INDEX "ScoreBreakdown_snapshotId_idx" ON "ScoreBreakdown"("snapshotId");
CREATE INDEX "ScoreBreakdown_ticker_idx" ON "ScoreBreakdown"("ticker");
CREATE INDEX "ScoreBreakdown_scoredAt_idx" ON "ScoreBreakdown"("scoredAt");
