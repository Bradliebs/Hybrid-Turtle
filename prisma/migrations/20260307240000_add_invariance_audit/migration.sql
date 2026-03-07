-- Invariance Audit Results: IRM analysis showing causal vs spurious signals.
CREATE TABLE "InvarianceAuditResult" (
    "id" INTEGER NOT NULL PRIMARY KEY AUTOINCREMENT,
    "computedAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "sampleSize" INTEGER NOT NULL,
    "environmentCount" INTEGER NOT NULL,
    "environmentsUsed" TEXT NOT NULL,
    "scoresJson" TEXT NOT NULL,
    "summary" TEXT
);

CREATE INDEX "InvarianceAuditResult_computedAt_idx" ON "InvarianceAuditResult"("computedAt");
