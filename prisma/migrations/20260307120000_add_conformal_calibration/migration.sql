-- Conformal Prediction Intervals: calibration parameter storage
-- Stores quantile thresholds computed from NCS residual analysis.
-- Supports multiple coverage levels (80%, 90%, 95%) and regime-specific calibrations.

CREATE TABLE "ConformalCalibration" (
    "id" INTEGER NOT NULL PRIMARY KEY AUTOINCREMENT,
    "calibratedAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "coverageLevel" REAL NOT NULL,
    "qHat" REAL NOT NULL,
    "qHatUp" REAL NOT NULL,
    "qHatDown" REAL NOT NULL,
    "sampleSize" INTEGER NOT NULL,
    "regime" TEXT,
    "source" TEXT NOT NULL
);

CREATE INDEX "ConformalCalibration_regime_idx" ON "ConformalCalibration"("regime");
CREATE INDEX "ConformalCalibration_calibratedAt_idx" ON "ConformalCalibration"("calibratedAt");
