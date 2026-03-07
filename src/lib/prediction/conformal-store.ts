/**
 * DEPENDENCIES
 * Consumed by: bootstrap-calibration.ts, /api/prediction/calibrate/route.ts,
 *              /api/prediction/interval/route.ts, nightly.ts
 * Consumes: prisma.ts, conformal-calibrator.ts
 * Risk-sensitive: NO — stores/retrieves calibration parameters only
 * Last modified: 2026-03-07
 * Notes: Persist and load conformal calibration parameters via Prisma.
 *        Handles recalibration eligibility checks (sample size growth / age).
 */

import { prisma } from '@/lib/prisma';
import type { ConformalInterval } from './conformal-calibrator';
import { getInterval } from './conformal-calibrator';

// ── Types ────────────────────────────────────────────────────

export interface StoredCalibration {
  id: number;
  calibratedAt: Date;
  coverageLevel: number;
  qHat: number;
  qHatUp: number;
  qHatDown: number;
  sampleSize: number;
  regime: string | null;
  source: string;
}

// ── Persistence ──────────────────────────────────────────────

/**
 * Save a new calibration result to the database.
 */
export async function saveCalibration(params: {
  coverageLevel: number;
  qHat: number;
  qHatUp: number;
  qHatDown: number;
  sampleSize: number;
  regime: string | null;
  source: 'bootstrap' | 'live_trades';
}): Promise<StoredCalibration> {
  return prisma.conformalCalibration.create({
    data: {
      coverageLevel: params.coverageLevel,
      qHat: params.qHat,
      qHatUp: params.qHatUp,
      qHatDown: params.qHatDown,
      sampleSize: params.sampleSize,
      regime: params.regime,
      source: params.source,
    },
  });
}

/**
 * Get the latest calibration for a given coverage level and regime.
 * Falls back to all-regime calibration if regime-specific one doesn't exist.
 */
export async function getLatestCalibration(
  coverageLevel: number,
  regime?: string | null
): Promise<StoredCalibration | null> {
  // Try regime-specific first
  if (regime) {
    const specific = await prisma.conformalCalibration.findFirst({
      where: { coverageLevel, regime },
      orderBy: { calibratedAt: 'desc' },
    });
    if (specific) return specific;
  }

  // Fall back to all-regime calibration
  return prisma.conformalCalibration.findFirst({
    where: { coverageLevel, regime: null },
    orderBy: { calibratedAt: 'desc' },
  });
}

/**
 * Get a prediction interval for an NCS score using the latest stored calibration.
 * Returns null if no calibration exists yet.
 */
export async function getStoredInterval(
  ncs: number,
  coverageLevel = 0.9,
  regime?: string | null
): Promise<ConformalInterval | null> {
  const cal = await getLatestCalibration(coverageLevel, regime);
  if (!cal) return null;
  return getInterval(ncs, cal.qHatUp, cal.qHatDown, cal.coverageLevel);
}

// ── Recalibration Eligibility ────────────────────────────────

const MIN_SAMPLE_GROWTH = 20;
const MAX_CALIBRATION_AGE_DAYS = 30;

/**
 * Check whether recalibration should run.
 * Conditions:
 *   1. No calibration exists yet, OR
 *   2. Sample size has grown by ≥20 since last calibration, OR
 *   3. Last calibration is >30 days old
 */
export async function shouldRecalibrate(
  currentSampleSize: number,
  regime: string | null = null
): Promise<boolean> {
  const latest = await getLatestCalibration(0.9, regime);

  // No calibration yet — definitely calibrate
  if (!latest) return true;

  // Sample size grew enough
  if (currentSampleSize - latest.sampleSize >= MIN_SAMPLE_GROWTH) return true;

  // Calibration too old
  const ageMs = Date.now() - latest.calibratedAt.getTime();
  const ageDays = ageMs / (1000 * 60 * 60 * 24);
  if (ageDays > MAX_CALIBRATION_AGE_DAYS) return true;

  return false;
}
