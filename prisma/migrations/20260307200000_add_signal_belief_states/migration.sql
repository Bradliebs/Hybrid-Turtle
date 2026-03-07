-- Signal Belief States: Beta(α, β) distributions per (signal, regime) pair.
-- 7 signals × 4 regimes = 28 rows. Updated after each trade closes.

CREATE TABLE "SignalBeliefState" (
    "id" INTEGER NOT NULL PRIMARY KEY AUTOINCREMENT,
    "signal" TEXT NOT NULL,
    "regime" TEXT NOT NULL,
    "alpha" REAL NOT NULL DEFAULT 2,
    "beta" REAL NOT NULL DEFAULT 2,
    "updatedAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE UNIQUE INDEX "SignalBeliefState_signal_regime_key" ON "SignalBeliefState"("signal", "regime");
CREATE INDEX "SignalBeliefState_signal_idx" ON "SignalBeliefState"("signal");
CREATE INDEX "SignalBeliefState_regime_idx" ON "SignalBeliefState"("regime");
