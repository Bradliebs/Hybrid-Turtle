/**
 * DEPENDENCIES
 * Consumed by: /backtest page (comparison tab)
 * Consumes: /api/backtest (internally called)
 * Risk-sensitive: NO — read-only comparison
 * Last modified: 2026-03-06
 *
 * Notes: Runs the backtest in both FULL and CORE_LITE modes and returns
 *        a side-by-side comparison of signal counts, win rates, and R-metrics.
 *        Helps answer: "Does the full scoring overlay add value vs. a minimal
 *        trend-following system?"
 */
import { NextRequest, NextResponse } from 'next/server';

interface ModeMeta {
  scanMode: string;
  totalSignals: number;
  withOutcomes: number;
  avgR20: number | null;
  winRate: number | null;
  stopsHit: number;
  stopsHitPct: number | null;
  avgMaxFavorableR: number | null;
  avgMaxAdverseR: number | null;
  hit1RPct: number | null;
  hit2RPct: number | null;
}

export async function GET(request: NextRequest) {
  const { searchParams } = request.nextUrl;
  const sleeve = searchParams.get('sleeve') || '';
  const regime = searchParams.get('regime') || '';
  const limit = searchParams.get('limit') || '500';

  // Build common query params
  const baseParams = new URLSearchParams();
  if (sleeve) baseParams.set('sleeve', sleeve);
  if (regime) baseParams.set('regime', regime);
  baseParams.set('limit', limit);

  // Determine base URL from the request
  const proto = request.headers.get('x-forwarded-proto') || 'http';
  const host = request.headers.get('host') || 'localhost:3000';
  const baseUrl = `${proto}://${host}`;

  // Run both modes in parallel
  const fullParams = new URLSearchParams(baseParams);
  fullParams.set('mode', 'FULL');
  const liteParams = new URLSearchParams(baseParams);
  liteParams.set('mode', 'CORE_LITE');

  const [fullRes, liteRes] = await Promise.all([
    fetch(`${baseUrl}/api/backtest?${fullParams}`).then((r) => r.json()),
    fetch(`${baseUrl}/api/backtest?${liteParams}`).then((r) => r.json()),
  ]);

  if (!fullRes.ok || !liteRes.ok) {
    return NextResponse.json({
      ok: false,
      error: 'One or both backtest runs failed',
      fullError: fullRes.ok ? null : fullRes,
      liteError: liteRes.ok ? null : liteRes,
    }, { status: 500 });
  }

  const fullMeta: ModeMeta = fullRes.meta;
  const liteMeta: ModeMeta = liteRes.meta;

  // Compute deltas
  const delta = {
    signalsDiff: liteMeta.totalSignals - fullMeta.totalSignals,
    signalsDiffPct: fullMeta.totalSignals > 0
      ? Math.round(((liteMeta.totalSignals - fullMeta.totalSignals) / fullMeta.totalSignals) * 100)
      : null,
    winRateDiff: fullMeta.winRate != null && liteMeta.winRate != null
      ? liteMeta.winRate - fullMeta.winRate
      : null,
    avgR20Diff: fullMeta.avgR20 != null && liteMeta.avgR20 != null
      ? Math.round((liteMeta.avgR20 - fullMeta.avgR20) * 100) / 100
      : null,
    stopsHitPctDiff: fullMeta.stopsHitPct != null && liteMeta.stopsHitPct != null
      ? liteMeta.stopsHitPct - fullMeta.stopsHitPct
      : null,
    hit1RPctDiff: fullMeta.hit1RPct != null && liteMeta.hit1RPct != null
      ? liteMeta.hit1RPct - fullMeta.hit1RPct
      : null,
    hit2RPctDiff: fullMeta.hit2RPct != null && liteMeta.hit2RPct != null
      ? liteMeta.hit2RPct - fullMeta.hit2RPct
      : null,
  };

  // Interpretation
  const fullBetter = (fullMeta.avgR20 ?? 0) > (liteMeta.avgR20 ?? 0);
  const interpretation = fullBetter
    ? 'FULL mode outperforms CORE_LITE — scoring overlays add value.'
    : 'CORE_LITE matches or exceeds FULL — scoring overlays may need rebalancing.';

  return NextResponse.json({
    ok: true,
    generatedAt: new Date().toISOString(),
    full: fullMeta,
    coreLite: liteMeta,
    delta,
    interpretation,
  });
}
