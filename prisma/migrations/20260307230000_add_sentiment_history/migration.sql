-- Sentiment History: caches Sentiment Composite Score per ticker.
CREATE TABLE "SentimentHistory" (
    "id" INTEGER NOT NULL PRIMARY KEY AUTOINCREMENT,
    "computedAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "ticker" TEXT NOT NULL,
    "scs" REAL NOT NULL,
    "signal" TEXT NOT NULL,
    "ncsAdjustment" REAL NOT NULL,
    "newsScore" REAL NOT NULL,
    "revisionScore" REAL NOT NULL,
    "shortScore" REAL NOT NULL,
    "divergenceDetected" BOOLEAN NOT NULL DEFAULT false
);

CREATE INDEX "SentimentHistory_ticker_idx" ON "SentimentHistory"("ticker");
CREATE INDEX "SentimentHistory_computedAt_idx" ON "SentimentHistory"("computedAt");
CREATE INDEX "SentimentHistory_ticker_computedAt_idx" ON "SentimentHistory"("ticker", "computedAt");
