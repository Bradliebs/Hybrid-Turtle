-- Signal Audit Results: mutual information analysis for signal pruning.
-- Stores full MI matrix and recommendations as JSON per audit run.

CREATE TABLE "SignalAuditResult" (
    "id" INTEGER NOT NULL PRIMARY KEY AUTOINCREMENT,
    "computedAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "sampleSize" INTEGER NOT NULL,
    "hasOutcomes" BOOLEAN NOT NULL DEFAULT false,
    "miMatrix" TEXT NOT NULL,
    "conditionalMI" TEXT NOT NULL,
    "highCorrPairs" TEXT,
    "summary" TEXT
);

CREATE INDEX "SignalAuditResult_computedAt_idx" ON "SignalAuditResult"("computedAt");
