/**
 * DEPENDENCIES
 * Consumed by: lead-lag-graph.ts, /api/prediction/lead-lag/route.ts
 * Consumes: market-data.ts (getDailyPrices)
 * Risk-sensitive: NO — analysis only, no position changes
 * Last modified: 2026-03-07
 * Notes: Computes pairwise lead-lag relationships via lagged cross-correlation.
 *        For pair (A, B), if corr(A[t], B[t+k]) is significant for k=1..2,
 *        then A leads B. Only stores statistically significant edges.
 *        Recomputed weekly (Sunday nightly pipeline).
 *        ⛔ Does NOT modify sacred files.
 */

import { getDailyPrices } from '@/lib/market-data';

// ── Constants ────────────────────────────────────────────────

/** Macro proxies always included as potential upstream nodes */
export const MACRO_PROXIES = [
  'HYG',   // high-yield credit → leads equities by 1-2d in risk-off
  'TLT',   // long bonds → leads growth stocks
  'GLD',   // gold → leads defensive sectors
  'UUP',   // dollar → leads commodity exporters (inverse)
  'XLF',   // financials → leads broad market
  'CPER',  // copper → leads industrials by 3-5d
] as const;

/** Maximum lag days to test */
const MAX_LAG = 5;

/** Minimum overlapping return days for a valid correlation */
const MIN_OVERLAP = 60;

/** Significance threshold for p-value (Bonferroni-adjusted at call site) */
const BASE_P_VALUE = 0.05;

/** Minimum absolute correlation to consider as a lead-lag signal */
const MIN_CORRELATION = 0.15;

// ── Types ────────────────────────────────────────────────────

export interface LeadLagEdge {
  leader: string;        // ticker of the leading asset
  follower: string;      // ticker of the following asset
  lag: number;           // lead time in days (1–5)
  correlation: number;   // lagged cross-correlation value
  pValue: number;        // statistical significance
  direction: 'POSITIVE' | 'NEGATIVE'; // positive = move in same direction; negative = inverse
}

export interface LeadLagComputeResult {
  edges: LeadLagEdge[];
  tickersProcessed: number;
  pairsComputed: number;
  computedAt: Date;
}

// ── Daily Returns ────────────────────────────────────────────

interface ReturnSeries {
  ticker: string;
  dates: string[];       // sorted oldest → newest
  returns: number[];     // log returns aligned with dates
}

/**
 * Compute daily log returns from price bars.
 * Bars from getDailyPrices are newest-first; we reverse to oldest-first.
 */
function computeReturns(bars: Array<{ date: string; close: number }>): { dates: string[]; returns: number[] } {
  if (bars.length < 2) return { dates: [], returns: [] };

  // Reverse to chronological order (oldest first)
  const chrono = [...bars].reverse();

  const dates: string[] = [];
  const returns: number[] = [];

  for (let i = 1; i < chrono.length; i++) {
    if (chrono[i].close > 0 && chrono[i - 1].close > 0) {
      dates.push(chrono[i].date);
      returns.push(Math.log(chrono[i].close / chrono[i - 1].close));
    }
  }

  return { dates, returns };
}

// ── Lagged Cross-Correlation ─────────────────────────────────

/**
 * Compute Pearson correlation between A[t] and B[t+lag].
 * A leads B by `lag` days if this correlation is significant.
 */
function laggedCorrelation(
  datesA: string[],
  returnsA: number[],
  datesB: string[],
  returnsB: number[],
  lag: number
): { correlation: number; n: number } | null {
  // Build date → return lookup for B
  const bMap = new Map<string, number>();
  for (let i = 0; i < datesB.length; i++) {
    bMap.set(datesB[i], returnsB[i]);
  }

  // For each date in A, find B's return `lag` days later in the calendar
  // Since dates may not align perfectly (weekends/holidays), we find the
  // closest B date within lag trading days
  const pairedA: number[] = [];
  const pairedB: number[] = [];

  for (let i = 0; i < datesA.length; i++) {
    // Find the B return that is `lag` positions later
    const dateA = datesA[i];
    const idxInB = datesB.indexOf(dateA);
    if (idxInB >= 0 && idxInB + lag < datesB.length) {
      pairedA.push(returnsA[i]);
      pairedB.push(returnsB[idxInB + lag]);
    }
  }

  if (pairedA.length < MIN_OVERLAP) return null;

  // Pearson correlation
  const n = pairedA.length;
  const meanA = pairedA.reduce((s, v) => s + v, 0) / n;
  const meanB = pairedB.reduce((s, v) => s + v, 0) / n;

  let cov = 0;
  let varA = 0;
  let varB = 0;
  for (let i = 0; i < n; i++) {
    const da = pairedA[i] - meanA;
    const db = pairedB[i] - meanB;
    cov += da * db;
    varA += da * da;
    varB += db * db;
  }

  const denom = Math.sqrt(varA * varB);
  if (denom === 0) return null;

  return { correlation: cov / denom, n };
}

/**
 * Approximate p-value for a Pearson correlation given sample size.
 * Uses the t-test transformation: t = r × sqrt(n-2) / sqrt(1-r²)
 * Then approximates the two-tailed p-value from the t-distribution.
 */
function correlationPValue(r: number, n: number): number {
  if (n <= 2) return 1;
  const absR = Math.abs(r);
  if (absR >= 1) return 0;

  const t = absR * Math.sqrt(n - 2) / Math.sqrt(1 - absR * absR);
  const df = n - 2;

  // Approximate p-value using the normal distribution for large df
  // For df > 30, t-distribution ≈ normal
  if (df > 30) {
    // Two-tailed p ≈ 2 × Φ(-|t|) using logistic approximation
    const p = 2 / (1 + Math.exp(0.7 * t));
    return Math.max(0, Math.min(1, p));
  }

  // For smaller df, use a rougher approximation
  const p = 2 * Math.exp(-0.5 * t * t) / Math.sqrt(2 * Math.PI);
  return Math.max(0, Math.min(1, p));
}

// ── Main Computation ─────────────────────────────────────────

/**
 * Fetch returns for a list of tickers.
 * Skips tickers that fail to fetch.
 */
async function fetchReturnSeries(tickers: string[]): Promise<ReturnSeries[]> {
  const series: ReturnSeries[] = [];

  for (const ticker of tickers) {
    try {
      const bars = await getDailyPrices(ticker, 'full');
      if (!bars || bars.length < MIN_OVERLAP + MAX_LAG + 10) continue;

      const { dates, returns } = computeReturns(bars);
      if (dates.length >= MIN_OVERLAP) {
        series.push({ ticker, dates, returns });
      }
    } catch {
      // Skip tickers that fail
      continue;
    }
  }

  return series;
}

/**
 * Compute all lead-lag edges between macro proxies and a set of candidate tickers.
 * Tests each macro proxy as a potential leader for each ticker.
 *
 * @param candidateTickers - Tickers to test as followers (subset of universe)
 * @param maxCandidates - Max candidates to process (for speed control)
 */
export async function computeLeadLagEdges(
  candidateTickers: string[],
  maxCandidates = 50
): Promise<LeadLagComputeResult> {
  // Limit candidates for speed
  const candidates = candidateTickers.slice(0, maxCandidates);

  // Fetch macro proxy returns
  const macroSeries = await fetchReturnSeries([...MACRO_PROXIES]);
  if (macroSeries.length === 0) {
    return { edges: [], tickersProcessed: 0, pairsComputed: 0, computedAt: new Date() };
  }

  // Fetch candidate returns
  const candidateSeries = await fetchReturnSeries(candidates);

  const edges: LeadLagEdge[] = [];
  let pairsComputed = 0;

  // Bonferroni correction: adjust p-value for multiple comparisons
  const totalComparisons = macroSeries.length * candidateSeries.length * MAX_LAG;
  const adjustedPValue = BASE_P_VALUE / Math.max(totalComparisons, 1);

  // Test each macro proxy → each candidate at each lag
  for (const macro of macroSeries) {
    for (const candidate of candidateSeries) {
      if (macro.ticker === candidate.ticker) continue;

      let bestLag = 0;
      let bestCorr = 0;
      let bestN = 0;

      for (let lag = 1; lag <= MAX_LAG; lag++) {
        const result = laggedCorrelation(
          macro.dates, macro.returns,
          candidate.dates, candidate.returns,
          lag
        );
        pairsComputed++;

        if (!result) continue;

        const absCorr = Math.abs(result.correlation);
        if (absCorr > Math.abs(bestCorr) && absCorr >= MIN_CORRELATION) {
          bestLag = lag;
          bestCorr = result.correlation;
          bestN = result.n;
        }
      }

      // Check significance
      if (bestLag > 0 && Math.abs(bestCorr) >= MIN_CORRELATION) {
        const pValue = correlationPValue(bestCorr, bestN);
        if (pValue < adjustedPValue) {
          edges.push({
            leader: macro.ticker,
            follower: candidate.ticker,
            lag: bestLag,
            correlation: Math.round(bestCorr * 1000) / 1000,
            pValue: Math.round(pValue * 10000) / 10000,
            direction: bestCorr > 0 ? 'POSITIVE' : 'NEGATIVE',
          });
        }
      }
    }
  }

  // Sort by absolute correlation descending
  edges.sort((a, b) => Math.abs(b.correlation) - Math.abs(a.correlation));

  return {
    edges,
    tickersProcessed: candidateSeries.length + macroSeries.length,
    pairsComputed,
    computedAt: new Date(),
  };
}
