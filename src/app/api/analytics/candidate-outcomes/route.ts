/**
 * DEPENDENCIES
 * Consumed by: Analytics UI, research tooling
 * Consumes: candidate-outcome.ts, candidate-outcome-enrichment.ts, prisma.ts
 * Risk-sensitive: NO — read-only analytics
 * Last modified: 2026-03-06
 */
import { NextResponse } from 'next/server';
import prisma from '@/lib/prisma';
import { backfillTradeLinks } from '@/lib/candidate-outcome';
import { enrichCandidateOutcomes } from '@/lib/candidate-outcome-enrichment';

/**
 * GET /api/analytics/candidate-outcomes
 * Query candidate outcome records with filtering.
 */
export async function GET(request: Request) {
  const { searchParams } = new URL(request.url);
  const regime = searchParams.get('regime');
  const status = searchParams.get('status');
  const ticker = searchParams.get('ticker');
  const sleeve = searchParams.get('sleeve');
  const from = searchParams.get('from');
  const to = searchParams.get('to');
  const enriched = searchParams.get('enriched'); // 'true' or 'false'
  const traded = searchParams.get('traded');     // 'true' or 'false'
  const limit = Math.min(Number(searchParams.get('limit')) || 500, 5000);

  const where: Record<string, unknown> = {};
  if (regime) where.regime = regime;
  if (status) where.status = status;
  if (ticker) where.ticker = ticker;
  if (sleeve) where.sleeve = sleeve;
  if (from || to) {
    where.scanDate = {
      ...(from ? { gte: new Date(from) } : {}),
      ...(to ? { lte: new Date(to) } : {}),
    };
  }
  if (enriched === 'true') where.enrichedAt = { not: null };
  if (enriched === 'false') where.enrichedAt = null;
  if (traded === 'true') where.tradePlaced = true;
  if (traded === 'false') where.tradePlaced = false;

  const rows = await prisma.candidateOutcome.findMany({
    where,
    orderBy: { scanDate: 'desc' },
    take: limit,
  });

  // Compute summary stats for the result set
  const total = rows.length;
  const enrichedCount = rows.filter((r) => r.enrichedAt != null).length;
  const tradedCount = rows.filter((r) => r.tradePlaced).length;
  const readyCount = rows.filter((r) => r.status === 'READY').length;
  const avgNcs = rows.filter((r) => r.ncs != null).length > 0
    ? rows.filter((r) => r.ncs != null).reduce((s, r) => s + (r.ncs ?? 0), 0) / rows.filter((r) => r.ncs != null).length
    : null;

  // Forward return stats (only enriched rows)
  const enrichedRows = rows.filter((r) => r.fwdReturn5d != null);
  const avgFwd5d = enrichedRows.length > 0
    ? enrichedRows.reduce((s, r) => s + (r.fwdReturn5d ?? 0), 0) / enrichedRows.length
    : null;
  const avgFwd20d = enrichedRows.filter((r) => r.fwdReturn20d != null).length > 0
    ? enrichedRows.filter((r) => r.fwdReturn20d != null).reduce((s, r) => s + (r.fwdReturn20d ?? 0), 0) / enrichedRows.filter((r) => r.fwdReturn20d != null).length
    : null;

  return NextResponse.json({
    ok: true,
    count: total,
    summary: {
      total,
      enriched: enrichedCount,
      traded: tradedCount,
      ready: readyCount,
      avgNcs: avgNcs != null ? Math.round(avgNcs * 100) / 100 : null,
      avgFwd5d: avgFwd5d != null ? Math.round(avgFwd5d * 100) / 100 : null,
      avgFwd20d: avgFwd20d != null ? Math.round(avgFwd20d * 100) / 100 : null,
    },
    rows,
  });
}

/**
 * POST /api/analytics/candidate-outcomes
 * Trigger enrichment and/or trade linkage.
 * Body: { action: 'enrich' | 'link-trades' | 'both' }
 */
export async function POST(request: Request) {
  let action = 'both';
  try {
    const body = await request.json();
    if (body.action) action = body.action;
  } catch {
    // Default to 'both' if no body
  }

  const results: Record<string, unknown> = {};

  if (action === 'enrich' || action === 'both') {
    const enrichResult = await enrichCandidateOutcomes();
    results.enrichment = enrichResult;
  }

  if (action === 'link-trades' || action === 'both') {
    const linked = await backfillTradeLinks();
    results.tradesLinked = linked;
  }

  return NextResponse.json({ ok: true, ...results });
}
