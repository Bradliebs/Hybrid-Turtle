-- Add Breakout Integrity Score column to SnapshotTicker
-- BIS is 0–15, computed from latest candle OHLCV data.
-- Defaults to 0 for existing rows (neutral — no penalty, no bonus).
ALTER TABLE "SnapshotTicker" ADD COLUMN "bisScore" REAL DEFAULT 0;
