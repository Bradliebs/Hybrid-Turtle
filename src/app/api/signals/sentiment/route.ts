/**
 * DEPENDENCIES
 * Consumed by: SentimentPanel component
 * Consumes: sentiment-fusion.ts, prisma.ts, api-response.ts
 * Risk-sensitive: NO — signal computation only
 * Last modified: 2026-03-07
 * Notes: GET returns SCS for a ticker. Uses 6h cache.
 */

import { NextRequest, NextResponse } from 'next/server';
import { apiError } from '@/lib/api-response';
import { computeSentimentComposite } from '@/lib/signals/sentiment/sentiment-fusion';
import { prisma } from '@/lib/prisma';

export const dynamic = 'force-dynamic';

const CACHE_TTL_MS = 6 * 60 * 60 * 1000; // 6 hours

export async function GET(request: NextRequest) {
  const { searchParams } = new URL(request.url);
  const ticker = searchParams.get('ticker');

  if (!ticker) {
    return apiError(400, 'MISSING_TICKER', 'ticker query parameter is required');
  }

  try {
    // Check cache
    const cutoff = new Date(Date.now() - CACHE_TTL_MS);
    const cached = await prisma.sentimentHistory.findFirst({
      where: { ticker, computedAt: { gte: cutoff } },
      orderBy: { computedAt: 'desc' },
    });

    if (cached) {
      return NextResponse.json({
        ok: true,
        data: {
          ticker, scs: cached.scs, signal: cached.signal, ncsAdjustment: cached.ncsAdjustment,
          divergenceDetected: cached.divergenceDetected,
          sources: { newsScore: cached.newsScore, revisionScore: cached.revisionScore, shortScore: cached.shortScore },
          fromCache: true, computedAt: cached.computedAt,
        },
      });
    }

    // Compute fresh
    const result = await computeSentimentComposite(ticker);

    // Cache
    await prisma.sentimentHistory.create({
      data: {
        ticker, scs: result.scs, signal: result.signal, ncsAdjustment: result.ncsAdjustment,
        newsScore: result.sources.news.normalisedScore,
        revisionScore: result.sources.revision.revisionScore,
        shortScore: result.sources.shortInterest.shortScore,
        divergenceDetected: result.divergenceDetected,
      },
    });

    return NextResponse.json({ ok: true, data: { ...result, fromCache: false } });
  } catch (error) {
    return apiError(500, 'SENTIMENT_FAILED', 'Failed to compute sentiment', (error as Error).message);
  }
}
