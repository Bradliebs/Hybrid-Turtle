/**
 * DEPENDENCIES
 * Consumed by: NCSIntervalBadge component, TodayPanel
 * Consumes: conformal-store.ts, conformal-calibrator.ts, api-response.ts
 * Risk-sensitive: NO — read-only interval computation
 * Last modified: 2026-03-07
 * Notes: GET with query params returns NCS prediction interval.
 *        Returns null interval if no calibration exists yet.
 */

import { NextRequest, NextResponse } from 'next/server';
import { apiError } from '@/lib/api-response';
import { getStoredInterval } from '@/lib/prediction/conformal-store';
import {
  classifyConfidence,
  getConformalDecision,
  DEFAULT_CONFORMAL_THRESHOLDS,
} from '@/lib/prediction/conformal-calibrator';

export const dynamic = 'force-dynamic';

export async function GET(request: NextRequest) {
  const { searchParams } = new URL(request.url);

  const ncsParam = searchParams.get('ncs');
  const fwsParam = searchParams.get('fws');
  const coverageParam = searchParams.get('coverage');
  const regimeParam = searchParams.get('regime');

  if (!ncsParam) {
    return apiError(400, 'MISSING_NCS', 'ncs query parameter is required');
  }

  const ncs = parseFloat(ncsParam);
  if (!Number.isFinite(ncs)) {
    return apiError(400, 'INVALID_NCS', 'ncs must be a valid number');
  }

  const fws = fwsParam ? parseFloat(fwsParam) : null;
  const coverage = coverageParam ? parseFloat(coverageParam) : 0.9;
  const regime = regimeParam || null;

  try {
    const interval = await getStoredInterval(ncs, coverage, regime);

    if (!interval) {
      return NextResponse.json({
        ok: true,
        data: {
          hasCalibration: false,
          interval: null,
          confidence: null,
          decision: null,
        },
      });
    }

    const confidence = classifyConfidence(interval.width);
    const decision = fws != null
      ? getConformalDecision(interval, fws, DEFAULT_CONFORMAL_THRESHOLDS)
      : null;

    return NextResponse.json({
      ok: true,
      data: {
        hasCalibration: true,
        interval: {
          point: Math.round(interval.point * 10) / 10,
          lower: Math.round(interval.lower * 10) / 10,
          upper: Math.round(interval.upper * 10) / 10,
          width: Math.round(interval.width * 10) / 10,
          coverageLevel: interval.coverageLevel,
        },
        confidence,
        decision,
      },
    });
  } catch (error) {
    return apiError(500, 'INTERVAL_FAILED', 'Failed to compute interval', (error as Error).message);
  }
}
