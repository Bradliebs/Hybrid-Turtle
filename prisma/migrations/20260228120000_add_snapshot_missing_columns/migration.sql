-- Add columns that were previously applied via prisma db push but never had a formal migration.
-- weeklyAdx: Weekly ADX for higher-timeframe trend confirmation (BQS component)
-- volRegime: SPY ATR%-based volatility regime classification
-- dualRegimeAligned: Whether both SPY and VWRL are individually above MA200

ALTER TABLE "SnapshotTicker" ADD COLUMN "weeklyAdx" REAL NOT NULL DEFAULT 0;
ALTER TABLE "SnapshotTicker" ADD COLUMN "volRegime" TEXT DEFAULT 'NORMAL_VOL';
ALTER TABLE "SnapshotTicker" ADD COLUMN "dualRegimeAligned" BOOLEAN NOT NULL DEFAULT true;
