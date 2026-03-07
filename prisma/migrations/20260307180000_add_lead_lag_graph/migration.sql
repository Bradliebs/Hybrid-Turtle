-- Lead-Lag Graph: directional influence relationships between assets.
-- Recomputed weekly. Leader moves before follower by `lag` days.

CREATE TABLE "LeadLagEdge" (
    "id" INTEGER NOT NULL PRIMARY KEY AUTOINCREMENT,
    "computedAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "leader" TEXT NOT NULL,
    "follower" TEXT NOT NULL,
    "lag" INTEGER NOT NULL,
    "correlation" REAL NOT NULL,
    "pValue" REAL NOT NULL,
    "direction" TEXT NOT NULL
);

CREATE INDEX "LeadLagEdge_follower_idx" ON "LeadLagEdge"("follower");
CREATE INDEX "LeadLagEdge_leader_idx" ON "LeadLagEdge"("leader");
CREATE INDEX "LeadLagEdge_follower_leader_idx" ON "LeadLagEdge"("follower", "leader");

-- Lead-Lag Signal Snapshots: records each weekly computation for audit.
CREATE TABLE "LeadLagSignal" (
    "id" INTEGER NOT NULL PRIMARY KEY AUTOINCREMENT,
    "computedAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "edgeCount" INTEGER NOT NULL,
    "tickersProcessed" INTEGER NOT NULL,
    "topLeader" TEXT,
    "topFollower" TEXT,
    "topCorrelation" REAL
);

CREATE INDEX "LeadLagSignal_computedAt_idx" ON "LeadLagSignal"("computedAt");
