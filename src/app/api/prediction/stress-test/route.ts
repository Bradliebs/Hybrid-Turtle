/**
 * DEPENDENCIES
 * Consumed by: StressTestGauge component, TodayPanel
 * Consumes: adversarial-simulator.ts, prisma.ts, api-response.ts
 * Risk-sensitive: NO — simulation only
 * Last modified: 2026-03-07
 * Notes: POST runs stress test for a ticker. GET returns cached result.
 *        Results cached for 4 hours per ticker to avoid re-running simulations.
 *        Run on-demand when reviewing trades — NOT during nightly scan.
 */

import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';
import { parseJsonBody } from '@/lib/request-validation';
import { apiError } from '@/lib/api-response';
import {
  runAdversarialTest,
  DEFAULT_CONFIG,
  type StressTestConfig,
} from '@/lib/prediction/adversarial-simulator';
import { prisma } from '@/lib/prisma';

export const dynamic = 'force-dynamic';

/** Cache TTL: 4 hours */
const CACHE_TTL_MS = 4 * 60 * 60 * 1000;

const stressTestSchema = z.object({
  ticker: z.string().trim().min(1),
  entryPrice: z.number().positive(),
  stopPrice: z.number().positive(),
  atr: z.number().positive(),
  regime: z.string().default('BULLISH'),
  nPaths: z.number().int().min(100).max(5000).default(DEFAULT_CONFIG.nPaths),
  horizonDays: z.number().int().min(1).max(30).default(DEFAULT_CONFIG.horizonDays),
  adversarialBias: z.number().min(0).max(1).default(DEFAULT_CONFIG.adversarialBias),
});

export async function POST(request: NextRequest) {
  const parsed = await parseJsonBody(request, stressTestSchema);
  if (!parsed.ok) return parsed.response;

  const data = parsed.data;

  // Check cache first
  const cached = await getCachedResult(data.ticker);
  if (cached) {
    return NextResponse.json({
      ok: true,
      data: { ...cached, fromCache: true },
    });
  }

  try {
    const config: StressTestConfig = {
      ticker: data.ticker,
      entryPrice: data.entryPrice,
      stopPrice: data.stopPrice,
      atr: data.atr,
      regime: data.regime,
      nPaths: data.nPaths,
      horizonDays: data.horizonDays,
      adversarialBias: data.adversarialBias,
    };

    const result = runAdversarialTest(config);

    // Cache the result
    await prisma.stressTestResult.create({
      data: {
        ticker: data.ticker,
        entryPrice: data.entryPrice,
        stopPrice: data.stopPrice,
        atr: data.atr,
        regime: data.regime,
        nPaths: result.pathsRun,
        horizonDays: result.horizonDays,
        adversarialBias: result.adversarialBias,
        stopHitProbability: result.stopHitProbability,
        gate: result.gate,
        percentileP5: result.percentiles.p5,
        percentileP50: result.percentiles.p50,
        percentileP95: result.percentiles.p95,
        avgDaysToStopHit: result.avgDaysToStopHit,
      },
    });

    return NextResponse.json({
      ok: true,
      data: { ...result, fromCache: false },
    });
  } catch (error) {
    console.error('[StressTest] Simulation error:', (error as Error).message);
    return apiError(500, 'STRESS_TEST_FAILED', 'Failed to run stress test', (error as Error).message);
  }
}

export async function GET(request: NextRequest) {
  const { searchParams } = new URL(request.url);
  const ticker = searchParams.get('ticker');

  if (!ticker) {
    return apiError(400, 'MISSING_TICKER', 'ticker query parameter is required');
  }

  try {
    const cached = await getCachedResult(ticker);

    if (!cached) {
      return NextResponse.json({
        ok: true,
        data: { hasResult: false, result: null },
      });
    }

    return NextResponse.json({
      ok: true,
      data: { hasResult: true, result: cached, fromCache: true },
    });
  } catch (error) {
    return apiError(500, 'STRESS_TEST_FETCH_FAILED', 'Failed to fetch stress test result', (error as Error).message);
  }
}

// ── Cache helper ─────────────────────────────────────────────

async function getCachedResult(ticker: string) {
  const cutoff = new Date(Date.now() - CACHE_TTL_MS);

  const latest = await prisma.stressTestResult.findFirst({
    where: {
      ticker,
      testedAt: { gte: cutoff },
    },
    orderBy: { testedAt: 'desc' },
  });

  if (!latest) return null;

  return {
    ticker: latest.ticker,
    stopHitProbability: latest.stopHitProbability,
    gate: latest.gate as 'PASS' | 'FAIL',
    pathsRun: latest.nPaths,
    horizonDays: latest.horizonDays,
    adversarialBias: latest.adversarialBias,
    percentiles: {
      p5: latest.percentileP5,
      p50: latest.percentileP50,
      p95: latest.percentileP95,
    },
    avgDaysToStopHit: latest.avgDaysToStopHit,
    testedAt: latest.testedAt,
  };
}
