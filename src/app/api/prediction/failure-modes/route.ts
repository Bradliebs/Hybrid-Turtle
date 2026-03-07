/**
 * DEPENDENCIES
 * Consumed by: FailureModePanel component, TodayPanel
 * Consumes: failure-mode-scorer.ts, prisma.ts, api-response.ts, request-validation.ts
 * Risk-sensitive: NO — advisory scoring, no position changes
 * Last modified: 2026-03-07
 * Notes: POST computes FM scores for a given ticker and portfolio context.
 *        GET retrieves latest stored FM scores for a ticker.
 */

import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';
import { parseJsonBody } from '@/lib/request-validation';
import { apiError } from '@/lib/api-response';
import { computeFailureModes, type FMCandidateInput, type FMPortfolioContext } from '@/lib/prediction/failure-mode-scorer';
import type { TechnicalData, Sleeve } from '@/types';
import { prisma } from '@/lib/prisma';

export const dynamic = 'force-dynamic';

const fmRequestSchema = z.object({
  ticker: z.string().trim().min(1),
  price: z.number().positive(),
  entryTrigger: z.number().positive(),
  stopPrice: z.number().positive(),
  sleeve: z.enum(['CORE', 'ETF', 'HIGH_RISK', 'HEDGE']),
  sector: z.string().optional(),
  cluster: z.string().optional(),
  technicals: z.object({
    currentPrice: z.number(),
    ma200: z.number(),
    adx: z.number(),
    plusDI: z.number(),
    minusDI: z.number(),
    atr: z.number(),
    atr20DayAgo: z.number().default(0),
    atrSpiking: z.boolean().default(false),
    medianAtr14: z.number().default(0),
    atrPercent: z.number(),
    twentyDayHigh: z.number(),
    efficiency: z.number(),
    relativeStrength: z.number().default(0),
    volumeRatio: z.number(),
    failedBreakoutAt: z.string().nullable().default(null),
    bis: z.number().optional(),
  }),
  // Portfolio context — caller provides open position info
  openTickers: z.array(z.string()).default([]),
  openSectors: z.array(z.string()).default([]),
  openClusters: z.array(z.string()).default([]),
});

export async function POST(request: NextRequest) {
  const parsed = await parseJsonBody(request, fmRequestSchema);
  if (!parsed.ok) return parsed.response;

  const data = parsed.data;

  try {
    const candidate: FMCandidateInput = {
      ticker: data.ticker,
      price: data.price,
      entryTrigger: data.entryTrigger,
      stopPrice: data.stopPrice,
      sleeve: data.sleeve as Sleeve,
      sector: data.sector,
      cluster: data.cluster,
      technicals: {
        ...data.technicals,
        failedBreakoutAt: data.technicals.failedBreakoutAt
          ? new Date(data.technicals.failedBreakoutAt)
          : null,
      } as TechnicalData,
    };

    const context: FMPortfolioContext = {
      openTickers: data.openTickers,
      openSectors: data.openSectors,
      openClusters: data.openClusters,
    };

    const result = await computeFailureModes(candidate, context);

    // Persist the score for audit/backtest
    await prisma.failureModeScore.create({
      data: {
        ticker: data.ticker,
        fm1: result.scores.fm1,
        fm2: result.scores.fm2,
        fm3: result.scores.fm3,
        fm4: result.scores.fm4,
        fm5: result.scores.fm5,
        gatePass: result.gate.pass,
        blockedBy: result.gate.blockedBy.length > 0 ? result.gate.blockedBy.join(',') : null,
        reasons: JSON.stringify(result.reasons),
      },
    });

    return NextResponse.json({
      ok: true,
      data: {
        scores: result.scores,
        gate: result.gate,
        reasons: result.reasons,
      },
    });
  } catch (error) {
    console.error('[FM] Failure mode scoring error:', (error as Error).message);
    return apiError(500, 'FM_SCORING_FAILED', 'Failed to compute failure mode scores', (error as Error).message);
  }
}

export async function GET(request: NextRequest) {
  const { searchParams } = new URL(request.url);
  const ticker = searchParams.get('ticker');

  if (!ticker) {
    return apiError(400, 'MISSING_TICKER', 'ticker query parameter is required');
  }

  try {
    const latest = await prisma.failureModeScore.findFirst({
      where: { ticker },
      orderBy: { scoredAt: 'desc' },
    });

    if (!latest) {
      return NextResponse.json({
        ok: true,
        data: { hasScore: false, score: null },
      });
    }

    return NextResponse.json({
      ok: true,
      data: {
        hasScore: true,
        score: {
          scoredAt: latest.scoredAt,
          fm1: latest.fm1,
          fm2: latest.fm2,
          fm3: latest.fm3,
          fm4: latest.fm4,
          fm5: latest.fm5,
          gatePass: latest.gatePass,
          blockedBy: latest.blockedBy?.split(',') ?? [],
          reasons: latest.reasons ? JSON.parse(latest.reasons) : {},
        },
      },
    });
  } catch (error) {
    return apiError(500, 'FM_FETCH_FAILED', 'Failed to fetch failure mode scores', (error as Error).message);
  }
}
