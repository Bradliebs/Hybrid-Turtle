/**
 * DEPENDENCIES
 * Consumed by: Analytics UI
 * Consumes: filter-attribution.ts, prisma.ts
 * Risk-sensitive: NO — read-only analytics
 * Last modified: 2026-03-06
 */
import { NextResponse } from 'next/server';
import prisma from '@/lib/prisma';
import { backfillFilterOutcomes } from '@/lib/filter-attribution';

export async function GET(request: Request) {
  const { searchParams } = new URL(request.url);
  const regime = searchParams.get('regime');
  const filterName = searchParams.get('filter');
  const from = searchParams.get('from');
  const to = searchParams.get('to');
  const withOutcomes = searchParams.get('withOutcomes') === 'true';
  const limit = Math.min(Number(searchParams.get('limit')) || 500, 2000);

  const where: Record<string, unknown> = {};
  if (regime) where.regime = regime;
  if (from || to) {
    where.scanDate = {
      ...(from ? { gte: new Date(from) } : {}),
      ...(to ? { lte: new Date(to) } : {}),
    };
  }
  if (withOutcomes) {
    where.outcomeR = { not: null };
  }

  const rows = await prisma.filterAttribution.findMany({
    where,
    orderBy: { scanDate: 'desc' },
    take: limit,
  });

  // If a specific filter is requested, compute hit-rate stats
  if (filterName && rows.length > 0) {
    const passedRows = rows.filter((r) => {
      const val = r[filterName as keyof typeof r];
      return typeof val === 'boolean' ? val : false;
    });
    const failedRows = rows.filter((r) => {
      const val = r[filterName as keyof typeof r];
      return typeof val === 'boolean' ? !val : false;
    });

    const avgR = (arr: typeof rows) => {
      const withR = arr.filter((r) => r.outcomeR != null);
      if (withR.length === 0) return null;
      return withR.reduce((sum, r) => sum + (r.outcomeR ?? 0), 0) / withR.length;
    };

    return NextResponse.json({
      ok: true,
      filter: filterName,
      total: rows.length,
      passed: passedRows.length,
      failed: failedRows.length,
      passRate: rows.length > 0 ? passedRows.length / rows.length : 0,
      passedAvgR: avgR(passedRows),
      failedAvgR: avgR(failedRows),
      rows,
    });
  }

  return NextResponse.json({ ok: true, count: rows.length, rows });
}

/**
 * POST /api/analytics/filter-attribution
 * Triggers backfill of outcomes from closed trades.
 */
export async function POST() {
  const updated = await backfillFilterOutcomes();
  return NextResponse.json({ ok: true, updated });
}
