-- Signal Weight Records: dynamic signal weight snapshots from the meta-model.
-- Stores per-regime weight vectors for audit and learning.

CREATE TABLE "SignalWeightRecord" (
    "id" INTEGER NOT NULL PRIMARY KEY AUTOINCREMENT,
    "computedAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "regime" TEXT NOT NULL,
    "vixLevel" REAL NOT NULL,
    "vixPercentile" REAL NOT NULL,
    "source" TEXT NOT NULL,
    "wAdx" REAL NOT NULL,
    "wDi" REAL NOT NULL,
    "wHurst" REAL NOT NULL,
    "wBis" REAL NOT NULL,
    "wDrs" REAL NOT NULL,
    "wWeeklyAdx" REAL NOT NULL,
    "wBps" REAL NOT NULL
);

CREATE INDEX "SignalWeightRecord_computedAt_idx" ON "SignalWeightRecord"("computedAt");
CREATE INDEX "SignalWeightRecord_regime_idx" ON "SignalWeightRecord"("regime");
