/**
 * DEPENDENCIES
 * Consumed by: threat-library.ts, danger-matcher.ts, /api/prediction/danger-level/route.ts
 * Consumes: market-data.ts (VIX, SPY quotes + daily prices), correlation-matrix.ts, prisma.ts
 * Risk-sensitive: NO — read-only market state encoding
 * Last modified: 2026-03-07
 * Notes: Converts current market state to a normalised feature vector for
 *        cosine similarity matching against the threat library.
 *        ⛔ Does NOT modify risk-gates.ts — danger tightening is applied
 *        by reducing max open risk at the API/display layer.
 */

import { getStockQuote, getDailyPrices } from '@/lib/market-data';
import { getAllCorrelationFlags } from '@/lib/correlation-matrix';
import { prisma } from '@/lib/prisma';

// ── Types ────────────────────────────────────────────────────

export interface MarketEnvironment {
  vix: number;
  vixChange5d: number;
  spyMomentum20d: number;
  spyVolatilityRealised10d: number;
  drsScore: number;
  averagePortfolioCorrelation: number;
  daysInCurrentRegime: number;
}

/** Normalised feature vector — values scaled to 0–1 range for cosine similarity */
export type EnvironmentVector = number[];

// ── Feature Ranges for Normalisation ─────────────────────────
// Each feature is mapped to [0, 1] using known historical extremes.

const FEATURE_RANGES: Array<{ min: number; max: number }> = [
  { min: 9, max: 80 },      // vix: 9 (extreme calm) to 80 (March 2020 peak)
  { min: -30, max: 100 },   // vixChange5d: % change over 5 days
  { min: -20, max: 15 },    // spyMomentum20d: 20-day return %
  { min: 0.3, max: 5 },     // spyVolatilityRealised10d: annualised vol %
  { min: 0, max: 100 },     // drsScore: regime score from 0–100
  { min: 0, max: 1 },       // averagePortfolioCorrelation: 0–1
  { min: 0, max: 30 },      // daysInCurrentRegime: 0–30+
];

// ── Normalisation ────────────────────────────────────────────

function normalise(value: number, min: number, max: number): number {
  if (max === min) return 0.5;
  return Math.max(0, Math.min(1, (value - min) / (max - min)));
}

/**
 * Convert a MarketEnvironment to a normalised [0,1] vector.
 */
export function encodeEnvironment(env: MarketEnvironment): EnvironmentVector {
  const raw = [
    env.vix,
    env.vixChange5d,
    env.spyMomentum20d,
    env.spyVolatilityRealised10d,
    env.drsScore,
    env.averagePortfolioCorrelation,
    env.daysInCurrentRegime,
  ];

  return raw.map((v, i) => normalise(v, FEATURE_RANGES[i].min, FEATURE_RANGES[i].max));
}

/**
 * Decode a stored vector back to labelled values (for display).
 */
export function decodeVector(vec: EnvironmentVector): Record<string, number> {
  const labels = [
    'vix', 'vixChange5d', 'spyMomentum20d', 'spyVolatilityRealised10d',
    'drsScore', 'averagePortfolioCorrelation', 'daysInCurrentRegime',
  ];
  const result: Record<string, number> = {};
  for (let i = 0; i < labels.length; i++) {
    result[labels[i]] = vec[i] ?? 0;
  }
  return result;
}

// ── Live Environment Builder ─────────────────────────────────

/**
 * Build the current market environment from live data.
 * Falls back to sensible defaults if any data source is unavailable.
 */
export async function buildCurrentEnvironment(): Promise<MarketEnvironment> {
  let vix = 20;
  let vixChange5d = 0;
  let spyMomentum20d = 0;
  let spyVolRealised = 1.5;
  let drsScore = 50;
  let avgCorrelation = 0.3;
  let daysInRegime = 5;

  // VIX current price
  try {
    const vixQuote = await getStockQuote('^VIX');
    if (vixQuote) {
      vix = vixQuote.price;
    }
  } catch { /* use default */ }

  // VIX 5-day change from daily prices
  try {
    const vixBars = await getDailyPrices('^VIX', 'compact');
    if (vixBars && vixBars.length >= 6) {
      const current = vixBars[0].close;
      const fiveDaysAgo = vixBars[5].close;
      vixChange5d = fiveDaysAgo > 0 ? ((current - fiveDaysAgo) / fiveDaysAgo) * 100 : 0;
    }
  } catch { /* use default */ }

  // SPY momentum and realised volatility
  try {
    const spyBars = await getDailyPrices('SPY', 'compact');
    if (spyBars && spyBars.length >= 21) {
      // 20-day momentum
      const spyCurrent = spyBars[0].close;
      const spy20Ago = spyBars[20].close;
      spyMomentum20d = spy20Ago > 0 ? ((spyCurrent - spy20Ago) / spy20Ago) * 100 : 0;

      // 10-day realised volatility (annualised)
      const returns: number[] = [];
      for (let i = 0; i < Math.min(10, spyBars.length - 1); i++) {
        const r = Math.log(spyBars[i].close / spyBars[i + 1].close);
        returns.push(r);
      }
      if (returns.length >= 5) {
        const mean = returns.reduce((s, r) => s + r, 0) / returns.length;
        const variance = returns.reduce((s, r) => s + (r - mean) ** 2, 0) / returns.length;
        spyVolRealised = Math.sqrt(variance * 252) * 100; // annualised %
      }
    }
  } catch { /* use default */ }

  // Regime stability from RegimeHistory
  try {
    const latestRegime = await prisma.regimeHistory.findFirst({
      orderBy: { date: 'desc' },
      select: { consecutive: true, adx: true },
    });
    if (latestRegime) {
      daysInRegime = latestRegime.consecutive;
      drsScore = latestRegime.adx ?? 50;
    }
  } catch { /* use default */ }

  // Average portfolio correlation from nightly-computed flags
  try {
    const flags = await getAllCorrelationFlags();
    if (flags.length > 0) {
      avgCorrelation = flags.reduce((s, f) => s + f.correlation, 0) / flags.length;
    }
  } catch { /* use default */ }

  return {
    vix,
    vixChange5d,
    spyMomentum20d,
    spyVolatilityRealised10d: spyVolRealised,
    drsScore,
    averagePortfolioCorrelation: avgCorrelation,
    daysInCurrentRegime: daysInRegime,
  };
}
