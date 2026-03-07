-- Trade Episodes: (observation, action, reward) sequences for MAML training.
CREATE TABLE "TradeEpisode" (
    "id" INTEGER NOT NULL PRIMARY KEY AUTOINCREMENT,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "ticker" TEXT NOT NULL,
    "regime" TEXT NOT NULL,
    "stepsJson" TEXT NOT NULL,
    "stepCount" INTEGER NOT NULL,
    "totalReward" REAL NOT NULL,
    "finalRMultiple" REAL NOT NULL,
    "daysHeld" INTEGER NOT NULL
);

CREATE INDEX "TradeEpisode_ticker_idx" ON "TradeEpisode"("ticker");
CREATE INDEX "TradeEpisode_createdAt_idx" ON "TradeEpisode"("createdAt");

-- Policy Versions: trained MAML policy weight snapshots.
CREATE TABLE "PolicyVersion" (
    "id" INTEGER NOT NULL PRIMARY KEY AUTOINCREMENT,
    "trainedAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "weightsJson" TEXT NOT NULL,
    "metaLoss" REAL NOT NULL,
    "episodeCount" INTEGER NOT NULL
);

CREATE INDEX "PolicyVersion_trainedAt_idx" ON "PolicyVersion"("trainedAt");
