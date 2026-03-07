/**
 * DEPENDENCIES
 * Consumed by: /api/analytics/filter-scorecard/route.ts, filter-scorecard page
 * Consumes: prisma.ts
 * Risk-sensitive: NO — read-only analytics
 * Last modified: 2026-03-06
 * Notes: Aggregates CandidateOutcome data by filter/gate/score rule.
 *        All computations are deterministic: simple counts, means, and rates.
 *        Only counts rows with enrichedAt != null for outcome metrics.
 */
import prisma from './prisma';

// ── Types ───────────────────────────────────────────────────────────

/** Stats for one side of a filter split (passed or blocked) */
export interface FilterBucketStats {
  count: number;
  /** count of rows with forward outcome data */
  withOutcomes: number;
  avgFwd5d: number | null;
  avgFwd10d: number | null;
  avgFwd20d: number | null;
  avgMfeR: number | null;
  avgMaeR: number | null;
  hit1RRate: number | null;
  hit2RRate: number | null;
  stopHitRate: number | null;
}

/** One row in the filter scorecard */
export interface FilterScorecardRow {
  rule: string;
  description: string;
  total: number;
  passedCount: number;
  blockedCount: number;
  passRate: number;
  passed: FilterBucketStats;
  blocked: FilterBucketStats;
}

/** One row in the score band analysis */
export interface ScoreBandRow {
  scoreName: string;     // NCS, FWS, BQS
  band: string;          // e.g. "< 50", "50–59", "60–69", "70–79", "80+"
  bandLow: number;
  bandHigh: number;
  count: number;
  withOutcomes: number;
  avgFwd5d: number | null;
  avgFwd10d: number | null;
  avgFwd20d: number | null;
  avgMfeR: number | null;
  hit1RRate: number | null;
  hit2RRate: number | null;
  stopHitRate: number | null;
}

/** Full scorecard response */
export interface FilterScorecardResponse {
  ok: boolean;
  generatedAt: string;
  totalCandidates: number;
  totalEnriched: number;
  filters: FilterScorecardRow[];
  scoreBands: ScoreBandRow[];
}

// ── Helpers ─────────────────────────────────────────────────────────

type OutcomeRow = {
  passedTechFilter: boolean;
  passedRiskGates: boolean;
  passedAntiChase: boolean;
  blockedByRegime: boolean;
  regime: string;
  status: string;
  sleeve: string;
  ncs: number | null;
  fws: number | null;
  bqs: number | null;
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

function mean(values: number[]): number | null {
  if (values.length === 0) return null;
  return Math.round((values.reduce((a, b) => a + b, 0) / values.length) * 100) / 100;
}

function rate(trueCount: number, total: number): number | null {
  if (total === 0) return null;
  return Math.round((trueCount / total) * 1000) / 10; // percentage with 1 decimal
}

function computeBucketStats(rows: OutcomeRow[]): FilterBucketStats {
  const enriched = rows.filter((r) => r.enrichedAt != null);
  const fwd5 = enriched.map((r) => r.fwdReturn5d).filter((v): v is number => v != null);
  const fwd10 = enriched.map((r) => r.fwdReturn10d).filter((v): v is number => v != null);
  const fwd20 = enriched.map((r) => r.fwdReturn20d).filter((v): v is number => v != null);
  const mfe = enriched.map((r) => r.mfeR).filter((v): v is number => v != null);
  const mae = enriched.map((r) => r.maeR).filter((v): v is number => v != null);
  const reached1 = enriched.filter((r) => r.reached1R != null);
  const reached2 = enriched.filter((r) => r.reached2R != null);
  const stopHit = enriched.filter((r) => r.stopHit != null);

  return {
    count: rows.length,
    withOutcomes: enriched.length,
    avgFwd5d: mean(fwd5),
    avgFwd10d: mean(fwd10),
    avgFwd20d: mean(fwd20),
    avgMfeR: mean(mfe),
    avgMaeR: mean(mae),
    hit1RRate: rate(reached1.filter((r) => r.reached1R === true).length, reached1.length),
    hit2RRate: rate(reached2.filter((r) => r.reached2R === true).length, reached2.length),
    stopHitRate: rate(stopHit.filter((r) => r.stopHit === true).length, stopHit.length),
  };
}

function splitAndScore(
  rows: OutcomeRow[],
  rule: string,
  description: string,
  predicate: (r: OutcomeRow) => boolean
): FilterScorecardRow {
  const passed = rows.filter(predicate);
  const blocked = rows.filter((r) => !predicate(r));
  return {
    rule,
    description,
    total: rows.length,
    passedCount: passed.length,
    blockedCount: blocked.length,
    passRate: rows.length > 0 ? Math.round((passed.length / rows.length) * 1000) / 10 : 0,
    passed: computeBucketStats(passed),
    blocked: computeBucketStats(blocked),
  };
}

// ── Score band helper ───────────────────────────────────────────────

const NCS_BANDS = [
  { band: '< 50', low: -Infinity, high: 50 },
  { band: '50–59', low: 50, high: 60 },
  { band: '60–69', low: 60, high: 70 },
  { band: '70–79', low: 70, high: 80 },
  { band: '80+', low: 80, high: Infinity },
];

const FWS_BANDS = [
  { band: '0–10', low: 0, high: 10 },
  { band: '10–20', low: 10, high: 20 },
  { band: '20–30', low: 20, high: 30 },
  { band: '30–50', low: 30, high: 50 },
  { band: '50+', low: 50, high: Infinity },
];

const BQS_BANDS = [
  { band: '< 40', low: -Infinity, high: 40 },
  { band: '40–54', low: 40, high: 55 },
  { band: '55–69', low: 55, high: 70 },
  { band: '70–84', low: 70, high: 85 },
  { band: '85+', low: 85, high: Infinity },
];

function computeScoreBands(
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
    const stats = computeBucketStats(bucket);
    return {
      scoreName,
      band,
      bandLow: low === -Infinity ? 0 : low,
      bandHigh: high === Infinity ? 100 : high,
      count: bucket.length,
      withOutcomes: stats.withOutcomes,
      avgFwd5d: stats.avgFwd5d,
      avgFwd10d: stats.avgFwd10d,
      avgFwd20d: stats.avgFwd20d,
      avgMfeR: stats.avgMfeR,
      hit1RRate: stats.hit1RRate,
      hit2RRate: stats.hit2RRate,
      stopHitRate: stats.stopHitRate,
    };
  });
}

// ── Public API ──────────────────────────────────────────────────────

/**
 * Generate the full filter scorecard from CandidateOutcome data.
 *
 * @param opts.from    - start date filter
 * @param opts.to      - end date filter
 * @param opts.sleeve  - filter by sleeve
 * @param opts.status  - filter by candidate status
 */
export async function generateFilterScorecard(opts?: {
  from?: Date;
  to?: Date;
  sleeve?: string;
  status?: string;
}): Promise<FilterScorecardResponse> {
  const where: Record<string, unknown> = {};
  if (opts?.sleeve) where.sleeve = opts.sleeve;
  if (opts?.status) where.status = opts.status;
  if (opts?.from || opts?.to) {
    where.scanDate = {
      ...(opts?.from ? { gte: opts.from } : {}),
      ...(opts?.to ? { lte: opts.to } : {}),
    };
  }

  const rows: OutcomeRow[] = await prisma.candidateOutcome.findMany({
    where,
    select: {
      passedTechFilter: true,
      passedRiskGates: true,
      passedAntiChase: true,
      blockedByRegime: true,
      regime: true,
      status: true,
      sleeve: true,
      ncs: true,
      fws: true,
      bqs: true,
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

  const totalEnriched = rows.filter((r) => r.enrichedAt != null).length;

  // ── Filter scorecard rows ─────────────────────────────────────────

  const filters: FilterScorecardRow[] = [
    splitAndScore(rows, 'Technical Filter', 'Stage 2: price > MA200, ADX ≥ 20, +DI > −DI, ATR% < cap, data quality', (r) => r.passedTechFilter),
    splitAndScore(rows, 'Risk Gates', 'Stage 5: all 6 gates must pass (open risk, positions, sleeve, cluster, sector, size cap)', (r) => r.passedRiskGates),
    splitAndScore(rows, 'Anti-Chase Guard', 'Stage 6: gap guard + volatility extension check', (r) => r.passedAntiChase),
    splitAndScore(rows, 'Regime (Bullish)', 'Market regime was BULLISH at scan time', (r) => r.regime === 'BULLISH'),
    splitAndScore(rows, 'Regime (Not Bearish)', 'Market regime was NOT BEARISH at scan time', (r) => r.regime !== 'BEARISH'),
    splitAndScore(rows, 'Status = READY', 'Candidate classified as READY (≤ 2% to trigger)', (r) => r.status === 'READY'),
    splitAndScore(rows, 'Status = READY or WATCH', 'Candidate classified as READY or WATCH (≤ 3% to trigger)', (r) => r.status === 'READY' || r.status === 'WATCH'),
  ];

  // NCS threshold filters (only for rows with NCS data)
  const withNcs = rows.filter((r) => r.ncs != null);
  if (withNcs.length > 0) {
    filters.push(
      splitAndScore(withNcs, 'NCS ≥ 70', 'Net Composite Score above Auto-Yes threshold', (r) => (r.ncs ?? 0) >= 70),
      splitAndScore(withNcs, 'NCS ≥ 60', 'Net Composite Score above 60 (strong candidate)', (r) => (r.ncs ?? 0) >= 60),
    );
  }

  // FWS threshold filters
  const withFws = rows.filter((r) => r.fws != null);
  if (withFws.length > 0) {
    filters.push(
      splitAndScore(withFws, 'FWS ≤ 30', 'Fatal Weakness Score below safe threshold', (r) => (r.fws ?? 100) <= 30),
      splitAndScore(withFws, 'FWS > 65 (Auto-No)', 'Fatal Weakness Score above rejection threshold', (r) => (r.fws ?? 0) > 65),
    );
  }

  // ── Score band analysis ───────────────────────────────────────────

  const scoreBands: ScoreBandRow[] = [
    ...computeScoreBands(withNcs, 'NCS', NCS_BANDS, (r) => r.ncs),
    ...computeScoreBands(withFws, 'FWS', FWS_BANDS, (r) => r.fws),
    ...computeScoreBands(rows.filter((r) => r.bqs != null), 'BQS', BQS_BANDS, (r) => r.bqs),
  ];

  return {
    ok: true,
    generatedAt: new Date().toISOString(),
    totalCandidates: rows.length,
    totalEnriched,
    filters,
    scoreBands,
  };
}

// ── Exported for testing ────────────────────────────────────────────
export { mean, rate, computeBucketStats, splitAndScore, computeScoreBands, NCS_BANDS, FWS_BANDS, BQS_BANDS };
export type { OutcomeRow };
