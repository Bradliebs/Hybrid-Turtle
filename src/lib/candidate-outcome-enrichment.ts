/**
 * DEPENDENCIES
 * Consumed by: /api/analytics/candidate-outcomes/route.ts (POST enrich), nightly.ts (optional hook)
 * Consumes: prisma.ts, market-data.ts
 * Risk-sensitive: NO — analytics only, read-only market data calls
 * Last modified: 2026-03-06
 * Notes: Enriches CandidateOutcome rows with forward price returns, MFE/MAE,
 *        and R-threshold crossings. Only processes rows that are old enough to
 *        have forward data (≥ 5 trading days) and not yet enriched.
 *        Calls Yahoo/EODHD for price data — respects rate limits via getDailyPrices.
 */
import prisma from './prisma';
import { getDailyPrices } from './market-data';

// ── Types ───────────────────────────────────────────────────────────

interface PriceBar {
  date: string;
  close: number;
  high: number;
  low: number;
}

interface EnrichmentResult {
  fwdReturn5d: number | null;
  fwdReturn10d: number | null;
  fwdReturn20d: number | null;
  mfeR: number | null;
  maeR: number | null;
  reached1R: boolean | null;
  reached2R: boolean | null;
  reached3R: boolean | null;
  stopHit: boolean | null;
}

// ── Pure computation ────────────────────────────────────────────────

/**
 * Compute forward returns and R-based metrics from price bars.
 * Pure function — no DB or API calls.
 *
 * @param scanPrice  - close price at the time of scan
 * @param entryTrigger - planned entry price
 * @param stopPrice - planned stop price
 * @param forwardBars - daily bars AFTER the scan date, chronological
 */
export function computeForwardMetrics(
  scanPrice: number,
  entryTrigger: number,
  stopPrice: number,
  forwardBars: PriceBar[]
): EnrichmentResult {
  if (forwardBars.length === 0 || scanPrice <= 0) {
    return {
      fwdReturn5d: null, fwdReturn10d: null, fwdReturn20d: null,
      mfeR: null, maeR: null,
      reached1R: null, reached2R: null, reached3R: null, stopHit: null,
    };
  }

  // Forward returns (% change from scan close)
  const fwdReturn5d = forwardBars.length >= 5
    ? ((forwardBars[4].close - scanPrice) / scanPrice) * 100
    : null;
  const fwdReturn10d = forwardBars.length >= 10
    ? ((forwardBars[9].close - scanPrice) / scanPrice) * 100
    : null;
  const fwdReturn20d = forwardBars.length >= 20
    ? ((forwardBars[19].close - scanPrice) / scanPrice) * 100
    : null;

  // R-based metrics require valid entry/stop
  const rPerShare = entryTrigger - stopPrice;
  if (rPerShare <= 0) {
    return {
      fwdReturn5d, fwdReturn10d, fwdReturn20d,
      mfeR: null, maeR: null,
      reached1R: null, reached2R: null, reached3R: null, stopHit: null,
    };
  }

  // Compute MFE/MAE over 20 bars (or however many are available, up to 20)
  const barsToCheck = forwardBars.slice(0, 20);
  let maxFavourable = 0;  // highest R above entry
  let maxAdverse = 0;     // lowest R below entry (stored as negative)
  let hit1R = false;
  let hit2R = false;
  let hit3R = false;
  let hitStop = false;

  for (const bar of barsToCheck) {
    // Favourable: how high did price go above entry?
    const favR = (bar.high - entryTrigger) / rPerShare;
    if (favR > maxFavourable) maxFavourable = favR;

    // Adverse: how low did price go below entry?
    const advR = (entryTrigger - bar.low) / rPerShare;
    if (advR > maxAdverse) maxAdverse = advR;

    // R-threshold crossings (using close, not intraday)
    const closeR = (bar.close - entryTrigger) / rPerShare;
    if (closeR >= 1) hit1R = true;
    if (closeR >= 2) hit2R = true;
    if (closeR >= 3) hit3R = true;

    // Stop hit: low touched or breached stop level
    if (bar.low <= stopPrice) hitStop = true;
  }

  return {
    fwdReturn5d,
    fwdReturn10d,
    fwdReturn20d,
    mfeR: Math.round(maxFavourable * 100) / 100,
    maeR: Math.round(-maxAdverse * 100) / 100,  // negative = adverse
    reached1R: hit1R,
    reached2R: hit2R,
    reached3R: hit3R,
    stopHit: hitStop,
  };
}

// ── Batch enrichment ────────────────────────────────────────────────

/**
 * Enrich CandidateOutcome rows with forward price data.
 *
 * Only processes rows where:
 * - enrichedAt is null (not yet enriched)
 * - scanDate is old enough to have forward data (≥ minDaysOld trading days)
 *
 * @param minDaysOld - minimum calendar days since scan to attempt enrichment (default: 8 — gives ~5 trading days)
 * @param maxRows - maximum rows to process per batch (default: 100 — rate-limit friendly)
 * @returns count of rows enriched
 */
export async function enrichCandidateOutcomes(
  minDaysOld = 8,
  maxRows = 100
): Promise<{ enriched: number; skipped: number; errors: number }> {
  const cutoff = new Date();
  cutoff.setDate(cutoff.getDate() - minDaysOld);

  const rows = await prisma.candidateOutcome.findMany({
    where: {
      enrichedAt: null,
      scanDate: { lte: cutoff },
    },
    orderBy: { scanDate: 'asc' },
    take: maxRows,
    select: {
      id: true,
      ticker: true,
      scanDate: true,
      price: true,
      entryTrigger: true,
      stopPrice: true,
    },
  });

  let enriched = 0;
  let skipped = 0;
  let errors = 0;

  // Group by ticker to minimize Yahoo calls (one call per ticker)
  const byTicker = new Map<string, typeof rows>();
  for (const row of rows) {
    const existing = byTicker.get(row.ticker) || [];
    existing.push(row);
    byTicker.set(row.ticker, existing);
  }

  for (const ticker of Array.from(byTicker.keys())) {
    const tickerRows = byTicker.get(ticker)!;
    let bars: PriceBar[];
    try {
      const rawBars = await getDailyPrices(ticker, 'compact');
      bars = rawBars.map((b) => ({
        date: b.date,
        close: b.close,
        high: b.high,
        low: b.low,
      }));
    } catch (e) {
      console.warn(`[CandidateOutcome] Failed to fetch prices for ${ticker}:`, e);
      errors += tickerRows.length;
      continue;
    }

    if (bars.length === 0) {
      skipped += tickerRows.length;
      continue;
    }

    for (const row of tickerRows) {
      // Find bars after the scan date
      const scanDateStr = row.scanDate.toISOString().split('T')[0];
      const forwardBars = bars.filter((b) => b.date > scanDateStr);

      if (forwardBars.length < 5) {
        skipped++;
        continue;
      }

      const metrics = computeForwardMetrics(
        row.price,
        row.entryTrigger,
        row.stopPrice,
        forwardBars
      );

      try {
        await prisma.candidateOutcome.update({
          where: { id: row.id },
          data: {
            fwdReturn5d: metrics.fwdReturn5d,
            fwdReturn10d: metrics.fwdReturn10d,
            fwdReturn20d: metrics.fwdReturn20d,
            mfeR: metrics.mfeR,
            maeR: metrics.maeR,
            reached1R: metrics.reached1R,
            reached2R: metrics.reached2R,
            reached3R: metrics.reached3R,
            stopHit: metrics.stopHit,
            enrichedAt: new Date(),
          },
        });
        enriched++;
      } catch (e) {
        console.error(`[CandidateOutcome] Enrichment update failed for ${ticker}:`, e);
        errors++;
      }
    }
  }

  return { enriched, skipped, errors };
}
