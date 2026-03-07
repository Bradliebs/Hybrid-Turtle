-- VPIN History: caches VPIN/DOFI computations per ticker per day.
CREATE TABLE "VPINHistory" (
    "id" INTEGER NOT NULL PRIMARY KEY AUTOINCREMENT,
    "computedAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "ticker" TEXT NOT NULL,
    "vpin" REAL NOT NULL,
    "dofi" REAL NOT NULL,
    "signal" TEXT NOT NULL,
    "ncsAdjustment" REAL NOT NULL,
    "barsUsed" INTEGER NOT NULL
);

CREATE INDEX "VPINHistory_ticker_idx" ON "VPINHistory"("ticker");
CREATE INDEX "VPINHistory_computedAt_idx" ON "VPINHistory"("computedAt");
CREATE INDEX "VPINHistory_ticker_computedAt_idx" ON "VPINHistory"("ticker", "computedAt");
