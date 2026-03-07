-- Stress Test Results: adversarial Monte Carlo simulation cache.
-- Results cached for 4 hours per ticker.

CREATE TABLE "StressTestResult" (
    "id" INTEGER NOT NULL PRIMARY KEY AUTOINCREMENT,
    "testedAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "ticker" TEXT NOT NULL,
    "entryPrice" REAL NOT NULL,
    "stopPrice" REAL NOT NULL,
    "atr" REAL NOT NULL,
    "regime" TEXT NOT NULL,
    "nPaths" INTEGER NOT NULL,
    "horizonDays" INTEGER NOT NULL,
    "adversarialBias" REAL NOT NULL,
    "stopHitProbability" REAL NOT NULL,
    "gate" TEXT NOT NULL,
    "percentileP5" REAL NOT NULL,
    "percentileP50" REAL NOT NULL,
    "percentileP95" REAL NOT NULL,
    "avgDaysToStopHit" REAL
);

CREATE INDEX "StressTestResult_ticker_idx" ON "StressTestResult"("ticker");
CREATE INDEX "StressTestResult_testedAt_idx" ON "StressTestResult"("testedAt");
CREATE INDEX "StressTestResult_ticker_testedAt_idx" ON "StressTestResult"("ticker", "testedAt");
