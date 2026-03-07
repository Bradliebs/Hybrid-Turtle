-- Failure Mode Scoring: per-ticker FM score breakdown storage.
-- 5 independent failure mode scores, gate pass/fail, and reason audit trail.

CREATE TABLE "FailureModeScore" (
    "id" INTEGER NOT NULL PRIMARY KEY AUTOINCREMENT,
    "scoredAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "ticker" TEXT NOT NULL,
    "regime" TEXT,
    "fm1" REAL NOT NULL,
    "fm2" REAL NOT NULL,
    "fm3" REAL NOT NULL,
    "fm4" REAL NOT NULL,
    "fm5" REAL NOT NULL,
    "gatePass" BOOLEAN NOT NULL,
    "blockedBy" TEXT,
    "reasons" TEXT
);

CREATE INDEX "FailureModeScore_ticker_idx" ON "FailureModeScore"("ticker");
CREATE INDEX "FailureModeScore_scoredAt_idx" ON "FailureModeScore"("scoredAt");
CREATE INDEX "FailureModeScore_ticker_scoredAt_idx" ON "FailureModeScore"("ticker", "scoredAt");
