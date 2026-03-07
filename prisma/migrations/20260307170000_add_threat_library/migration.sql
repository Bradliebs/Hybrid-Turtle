-- Threat Library: dangerous market environment fingerprints.
-- Pre-populated with known crises, expanded with real losses.

CREATE TABLE "ThreatLibraryEntry" (
    "id" INTEGER NOT NULL PRIMARY KEY AUTOINCREMENT,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "label" TEXT NOT NULL,
    "vector" TEXT NOT NULL,
    "severity" INTEGER NOT NULL,
    "source" TEXT NOT NULL
);

CREATE INDEX "ThreatLibraryEntry_severity_idx" ON "ThreatLibraryEntry"("severity");
CREATE INDEX "ThreatLibraryEntry_source_idx" ON "ThreatLibraryEntry"("source");
