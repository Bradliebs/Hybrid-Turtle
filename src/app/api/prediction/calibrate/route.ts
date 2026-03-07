/**
 * DEPENDENCIES
 * Consumed by: Settings page, manual trigger
 * Consumes: bootstrap-calibration.ts, request-validation.ts, api-response.ts
 * Risk-sensitive: NO — generates calibration data only
 * Last modified: 2026-03-07
 * Notes: POST triggers recalibration. GET returns latest calibration status.
 */

import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';
import { parseJsonBody } from '@/lib/request-validation';
import { apiError } from '@/lib/api-response';
import { runFullCalibration } from '@/lib/prediction/bootstrap-calibration';
import { getLatestCalibration } from '@/lib/prediction/conformal-store';

export const dynamic = 'force-dynamic';

const calibrateSchema = z.object({
  regime: z.string().nullable().optional().default(null),
  force: z.boolean().optional().default(false),
});

export async function POST(request: NextRequest) {
  const parsed = await parseJsonBody(request, calibrateSchema);
  if (!parsed.ok) return parsed.response;

  const { regime, force } = parsed.data;

  try {
    const result = await runFullCalibration(regime, force);
    return NextResponse.json({ ok: true, data: result });
  } catch (error) {
    console.error('[Conformal] Calibration error:', (error as Error).message);
    return apiError(500, 'CALIBRATION_FAILED', 'Failed to run calibration', (error as Error).message);
  }
}

export async function GET() {
  try {
    const cal90 = await getLatestCalibration(0.90);
    const cal80 = await getLatestCalibration(0.80);
    const cal95 = await getLatestCalibration(0.95);

    return NextResponse.json({
      ok: true,
      data: {
        hasCalibration: cal90 !== null,
        calibrations: {
          '0.80': cal80 ? {
            calibratedAt: cal80.calibratedAt,
            qHatUp: cal80.qHatUp,
            qHatDown: cal80.qHatDown,
            sampleSize: cal80.sampleSize,
            source: cal80.source,
            regime: cal80.regime,
          } : null,
          '0.90': cal90 ? {
            calibratedAt: cal90.calibratedAt,
            qHatUp: cal90.qHatUp,
            qHatDown: cal90.qHatDown,
            sampleSize: cal90.sampleSize,
            source: cal90.source,
            regime: cal90.regime,
          } : null,
          '0.95': cal95 ? {
            calibratedAt: cal95.calibratedAt,
            qHatUp: cal95.qHatUp,
            qHatDown: cal95.qHatDown,
            sampleSize: cal95.sampleSize,
            source: cal95.source,
            regime: cal95.regime,
          } : null,
        },
      },
    });
  } catch (error) {
    return apiError(500, 'CALIBRATION_STATUS_FAILED', 'Failed to fetch calibration status', (error as Error).message);
  }
}
