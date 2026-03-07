/**
 * DEPENDENCIES
 * Consumed by: /api/analytics/score-validation/route.ts, /score-validation page
 * Consumes: prisma.ts
 * Risk-sensitive: NO — read-only analytics
 * Last modified: 2026-03-06
 *
 * Notes: Score Validation Analytics — tests whether BQS, FWS, and NCS
 *        genuinely predict better outcomes by bucketing candidates and
 *        comparing forward returns, R-metrics, and conversion rates.
 *
 *        Key questions this report answers:
 *        1. Do higher NCS candidates produce better forward returns? (monotonicity)
 *        2. Do higher FWS candidates produce worse forward returns? (inverse monotonicity)
 *        3. Does the Auto-Yes / Conditional / Auto-No classification work?
 *        4. Which BQS components correlate most with positive outcomes?
 *
 *        All calculations are deterministic: counts, means, rates.
 *        Only rows with enrichedAt != null contribute to outcome metrics.
 */
import prisma from './prisma';

// ── Types ───────────────────────────────────────────────────────────

/** Outcome statistics for a group of candidates */
export interface BucketStats {
  count: number;
  withOutcomes: number;
  tradedCount: number;
  tradeConversionRate: number | null;  // % of candidates that became actual trades
  avgFwd5d: number | null;
  avgFwd10d: number | null;
  avgFwd20d: number | null;
  avgMfeR: number | null;
  avgMaeR: number | null;
  hit1RRate: number | null;
  hit2RRate: number | null;
  stopHitRate: number | null;
}

/** One row in a score band table */
export interface ScoreBandRow {
  score: string;      // NCS, FWS, BQS
  band: string;       // e.g. "70–79"
  bandLow: number;
  bandHigh: number;
  stats: BucketStats;
}

/** Auto-action classification breakdown */
export interface ActionClassRow {
  action: string;     // Auto-Yes, Conditional, Auto-No
  stats: BucketStats;
}

/** Monotonicity test result */
export interface MonotonicityResult {
  score: string;
  direction: 'ascending' | 'descending';
  metric: string;
  values: (number | null)[];
  isMonotonic: boolean;
  violations: number;    // count of band-to-band reversals
  interpretation: string;
}

/** Full score validation response */
export interface ScoreValidationResponse {
  ok: boolean;
  generatedAt: string;
  totalCandidates: number;
  totalWithScores: number;
  totalEnriched: number;
  ncsBands: ScoreBandRow[];
  fwsBands: ScoreBandRow[];
  bqsBands: ScoreBandRow[];
  actionClassification: ActionClassRow[];
  monotonicity: MonotonicityResult[];
}

// ── Helpers ─────────────────────────────────────────────────────────

export type OutcomeRow = {
  bqs: number | null;
  fws: number | null;
  ncs: number | null;
  dualScoreAction: string | null;
  tradePlaced: boolean;
  fwdReturn5d: number | null;
  fwdReturn10d: number | null;
  fwdReturn20d: number | null;
  mfeR: number | null;
  maeR: number | null;
  reached1R: boolean | null;
  reached2R: boolean | null;
  stopHit: boolean | null;
  enrichedAt: Date | null;
};

export function mean(values: number[]): number | null {
  if (values.length === 0) return null;
  return Math.round((values.reduce((a, b) => a + b, 0) / values.length) * 100) / 100;
}

export function pctRate(trueCount: number, total: number): number | null {
  if (total === 0) return null;
  return Math.round((trueCount / total) * 1000) / 10;
}

export function computeStats(rows: OutcomeRow[]): BucketStats {
  const enriched = rows.filter((r) => r.enrichedAt != null);
  const traded = rows.filter((r) => r.tradePlaced);

  const fwd5 = enriched.map((r) => r.fwdReturn5d).filter((v): v is number => v != null);
  const fwd10 = enriched.map((r) => r.fwdReturn10d).filter((v): v is number => v != null);
  const fwd20 = enriched.map((r) => r.fwdReturn20d).filter((v): v is number => v != null);
  const mfe = enriched.map((r) => r.mfeR).filter((v): v is number => v != null);
  const mae = enriched.map((r) => r.maeR).filter((v): v is number => v != null);
  const r1 = enriched.filter((r) => r.reached1R != null);
  const r2 = enriched.filter((r) => r.reached2R != null);
  const sh = enriched.filter((r) => r.stopHit != null);

  return {
    count: rows.length,
    withOutcomes: enriched.length,
    tradedCount: traded.length,
    tradeConversionRate: pctRate(traded.length, rows.length),
    avgFwd5d: mean(fwd5),
    avgFwd10d: mean(fwd10),
    avgFwd20d: mean(fwd20),
    avgMfeR: mean(mfe),
    avgMaeR: mean(mae),
    hit1RRate: pctRate(r1.filter((r) => r.reached1R === true).length, r1.length),
    hit2RRate: pctRate(r2.filter((r) => r.reached2R === true).length, r2.length),
    stopHitRate: pctRate(sh.filter((r) => r.stopHit === true).length, sh.length),
  };
}

// ── Band definitions ────────────────────────────────────────────────
// Match the exact ranges from dual-score.ts component ceilings

export const NCS_BANDS = [
  { band: '< 50', low: -Infinity, high: 50 },
  { band: '50–59', low: 50, high: 60 },
  { band: '60–69', low: 60, high: 70 },
  { band: '70–79', low: 70, high: 80 },
  { band: '80+', low: 80, high: Infinity },
];

// FWS: 0 = no weakness, 95 = max achievable.
// Bands designed around the dual-score thresholds:
//   ≤ 30 = Auto-Yes eligible (if NCS ≥ 70)
//   > 65 = Auto-No (reject)
export const FWS_BANDS = [
  { band: '0–15 (clean)', low: 0, high: 15 },
  { band: '15–30 (safe)', low: 15, high: 30 },
  { band: '30–50 (caution)', low: 30, high: 50 },
  { band: '50–65 (risky)', low: 50, high: 65 },
  { band: '65+ (fragile)', low: 65, high: Infinity },
];

// BQS: 0 = worst, 100 = best.
export const BQS_BANDS = [
  { band: '< 40', low: -Infinity, high: 40 },
  { band: '40–54', low: 40, high: 55 },
  { band: '55–69', low: 55, high: 70 },
  { band: '70–84', low: 70, high: 85 },
  { band: '85+', low: 85, high: Infinity },
];

export function bucketRows(
  rows: OutcomeRow[],
  scoreName: string,
  bands: { band: string; low: number; high: number }[],
  getValue: (r: OutcomeRow) => number | null
): ScoreBandRow[] {
  return bands.map(({ band, low, high }) => {
    const bucket = rows.filter((r) => {
      const v = getValue(r);
      return v != null && v >= low && v < high;
    });
    return {
      score: scoreName,
      band,
      bandLow: low === -Infinity ? 0 : low,
      bandHigh: high === Infinity ? 100 : high,
      stats: computeStats(bucket),
    };
  });
}

// ── Monotonicity test ───────────────────────────────────────────────

/**
 * Test whether a metric increases (or decreases) monotonically across score bands.
 * Perfect monotonicity means the score is perfectly predictive for that metric.
 * Violations count how many band-to-band reversals occur.
 */
export function testMonotonicity(
  bands: ScoreBandRow[],
  metricName: string,
  getMetric: (s: BucketStats) => number | null,
  direction: 'ascending' | 'descending'
): MonotonicityResult {
  const values = bands.map((b) => getMetric(b.stats));
  const nonNull = values.filter((v): v is number => v != null);

  if (nonNull.length < 2) {
    return {
      score: bands[0]?.score ?? '',
      direction,
      metric: metricName,
      values,
      isMonotonic: false,
      violations: 0,
      interpretation: 'Insufficient data (need ≥ 2 bands with outcomes)',
    };
  }

  let violations = 0;
  for (let i = 1; i < values.length; i++) {
    if (values[i] == null || values[i - 1] == null) continue;
    const curr = values[i]!;
    const prev = values[i - 1]!;
    if (direction === 'ascending' && curr < prev) violations++;
    if (direction === 'descending' && curr > prev) violations++;
  }

  const isMonotonic = violations === 0;
  const maxPossible = nonNull.length - 1;
  const pct = maxPossible > 0 ? Math.round(((maxPossible - violations) / maxPossible) * 100) : 0;

  let interpretation: string;
  if (isMonotonic) {
    interpretation = `${direction === 'ascending' ? 'Higher' : 'Lower'} ${bands[0]?.score} → better ${metricName}. Score is predictive.`;
  } else if (violations <= 1) {
    interpretation = `Mostly ${direction} (${pct}% consistent). Minor noise — score is largely predictive.`;
  } else {
    interpretation = `Non-monotonic (${violations}/${maxPossible} violations). Score may not reliably predict ${metricName}.`;
  }

  return {
    score: bands[0]?.score ?? '',
    direction,
    metric: metricName,
    values,
    isMonotonic,
    violations,
    interpretation,
  };
}

// ── Public API ──────────────────────────────────────────────────────

export async function generateScoreValidation(opts?: {
  from?: Date;
  to?: Date;
  sleeve?: string;
}): Promise<ScoreValidationResponse> {
  const where: Record<string, unknown> = {};
  if (opts?.sleeve) where.sleeve = opts.sleeve;
  if (opts?.from || opts?.to) {
    where.scanDate = {
      ...(opts?.from ? { gte: opts.from } : {}),
      ...(opts?.to ? { lte: opts.to } : {}),
    };
  }

  const rows: OutcomeRow[] = await prisma.candidateOutcome.findMany({
    where,
    select: {
      bqs: true,
      fws: true,
      ncs: true,
      dualScoreAction: true,
      tradePlaced: true,
      fwdReturn5d: true,
      fwdReturn10d: true,
      fwdReturn20d: true,
      mfeR: true,
      maeR: true,
      reached1R: true,
      reached2R: true,
      stopHit: true,
      enrichedAt: true,
    },
  });

  const withScores = rows.filter((r) => r.ncs != null || r.bqs != null || r.fws != null);
  const totalEnriched = rows.filter((r) => r.enrichedAt != null).length;

  // ── Score bands ───────────────────────────────────────────────────

  const scored = rows.filter((r) => r.ncs != null);
  const ncsBands = bucketRows(scored, 'NCS', NCS_BANDS, (r) => r.ncs);
  const fwsBands = bucketRows(scored, 'FWS', FWS_BANDS, (r) => r.fws);
  const bqsBands = bucketRows(rows.filter((r) => r.bqs != null), 'BQS', BQS_BANDS, (r) => r.bqs);

  // ── Auto-action classification ────────────────────────────────────

  const actionGroups: ActionClassRow[] = ['Auto-Yes', 'Conditional', 'Auto-No'].map((action) => {
    const bucket = rows.filter((r) => {
      if (r.dualScoreAction == null) return false;
      return r.dualScoreAction === action;
    });
    return { action, stats: computeStats(bucket) };
  });

  // ── Monotonicity tests ────────────────────────────────────────────
  // Test: does each score's metric improve monotonically across bands?

  const monotonicity: MonotonicityResult[] = [
    // NCS: higher should → better outcomes (ascending)
    testMonotonicity(ncsBands, 'Fwd 20d Return', (s) => s.avgFwd20d, 'ascending'),
    testMonotonicity(ncsBands, '1R Hit Rate', (s) => s.hit1RRate, 'ascending'),
    testMonotonicity(ncsBands, 'MFE (R)', (s) => s.avgMfeR, 'ascending'),
    testMonotonicity(ncsBands, 'Stop Hit Rate', (s) => s.stopHitRate, 'descending'),

    // FWS: higher should → worse outcomes (descending returns)
    testMonotonicity(fwsBands, 'Fwd 20d Return', (s) => s.avgFwd20d, 'descending'),
    testMonotonicity(fwsBands, '1R Hit Rate', (s) => s.hit1RRate, 'descending'),
    testMonotonicity(fwsBands, 'Stop Hit Rate', (s) => s.stopHitRate, 'ascending'),

    // BQS: higher should → better outcomes (ascending)
    testMonotonicity(bqsBands, 'Fwd 20d Return', (s) => s.avgFwd20d, 'ascending'),
    testMonotonicity(bqsBands, 'MFE (R)', (s) => s.avgMfeR, 'ascending'),
  ];

  return {
    ok: true,
    generatedAt: new Date().toISOString(),
    totalCandidates: rows.length,
    totalWithScores: withScores.length,
    totalEnriched,
    ncsBands,
    fwsBands,
    bqsBands,
    actionClassification: actionGroups,
    monotonicity,
  };
}
