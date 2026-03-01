/**
 * DEPENDENCIES
 * Consumed by: /api/positions/route.ts (trade close), /api/ev-stats/route.ts, /api/ev-modifiers/route.ts
 * Consumes: prisma.ts
 * Risk-sensitive: NO
 * Last modified: 2026-03-01
 * Notes: Logging only — no actions or alerts. Records outcome data per closed
 *        trade for expectancy analysis sliced by regime, ATR bucket, cluster, sleeve.
 *        classifyAtrBucket exported for ev-modifier.ts to reuse thresholds.
 *        getExpectancyForCombination() queries the intersection of sleeve+ATR+regime.
 */
import prisma from './prisma';

// ── ATR Bucket classification ─────────────────────────────────────
// Buckets based on ATR% at entry. Thresholds are intentional —
// they align with the scan engine's volatility health bands.
export function classifyAtrBucket(atrPercent: number | null | undefined): string {
  if (atrPercent == null || atrPercent <= 0) return 'UNKNOWN';
  if (atrPercent < 2) return 'LOW';
  if (atrPercent < 4) return 'MEDIUM';
  if (atrPercent < 7) return 'HIGH';
  return 'EXTREME';
}

// ── Outcome classification ────────────────────────────────────────
function classifyOutcome(rMultiple: number): string {
  if (rMultiple > 0.1) return 'WIN';
  if (rMultiple < -0.1) return 'LOSS';
  return 'BREAKEVEN';
}

// ── LogEVRecord ───────────────────────────────────────────────────
// Called after a trade is closed. Best-effort — errors are logged,
// never thrown. This must not block or break the trade close workflow.
export async function logEVRecord(params: {
  tradeId: string;
  regime: string | null | undefined;
  atrAtEntry: number | null | undefined;
  cluster: string | null | undefined;
  sleeve: string;
  entryNCS: number | null | undefined;
  rMultiple: number;
  closedAt: Date;
}): Promise<void> {
  try {
    await prisma.evRecord.create({
      data: {
        tradeId: params.tradeId,
        regime: params.regime || 'UNKNOWN',
        atrBucket: classifyAtrBucket(params.atrAtEntry),
        cluster: params.cluster || null,
        sleeve: params.sleeve,
        entryNCS: params.entryNCS ?? null,
        outcome: classifyOutcome(params.rMultiple),
        rMultiple: params.rMultiple,
        closedAt: params.closedAt,
      },
    });
  } catch (err) {
    // Non-blocking — log and move on
    console.warn('EV record logging failed (non-blocking)', err);
  }
}

// ── Expectancy Stats ──────────────────────────────────────────────
// Returns expectancy breakdowns sliced by optional filters.
// Used by the /api/ev-stats endpoint for dashboard analytics.
export interface ExpectancySlice {
  key: string;
  tradeCount: number;
  winCount: number;
  lossCount: number;
  breakevenCount: number;
  winRate: number;
  avgWin: number;
  avgLoss: number;
  expectancy: number;       // avgWin * winRate + avgLoss * (1 - winRate)
  totalR: number;
}

export interface ExpectancyStats {
  overall: ExpectancySlice;
  byRegime: ExpectancySlice[];
  byAtrBucket: ExpectancySlice[];
  byCluster: ExpectancySlice[];
  bySleeve: ExpectancySlice[];
}

function computeSlice(key: string, records: { rMultiple: number; outcome: string }[]): ExpectancySlice {
  const tradeCount = records.length;
  const wins = records.filter(r => r.outcome === 'WIN');
  const losses = records.filter(r => r.outcome === 'LOSS');
  const breakevens = records.filter(r => r.outcome === 'BREAKEVEN');

  const winRate = tradeCount > 0 ? wins.length / tradeCount : 0;
  const avgWin = wins.length > 0
    ? wins.reduce((sum, r) => sum + r.rMultiple, 0) / wins.length
    : 0;
  const avgLoss = losses.length > 0
    ? losses.reduce((sum, r) => sum + r.rMultiple, 0) / losses.length
    : 0;

  // Expectancy = avgWin * winRate + avgLoss * lossRate
  const lossRate = tradeCount > 0 ? losses.length / tradeCount : 0;
  const expectancy = (avgWin * winRate) + (avgLoss * lossRate);
  const totalR = records.reduce((sum, r) => sum + r.rMultiple, 0);

  return {
    key,
    tradeCount,
    winCount: wins.length,
    lossCount: losses.length,
    breakevenCount: breakevens.length,
    winRate: Math.round(winRate * 10000) / 10000,  // 4 decimal places
    avgWin: Math.round(avgWin * 100) / 100,
    avgLoss: Math.round(avgLoss * 100) / 100,
    expectancy: Math.round(expectancy * 100) / 100,
    totalR: Math.round(totalR * 100) / 100,
  };
}

function groupSlices(
  records: { rMultiple: number; outcome: string; [k: string]: unknown }[],
  field: string
): ExpectancySlice[] {
  const groups = new Map<string, { rMultiple: number; outcome: string }[]>();
  for (const r of records) {
    const key = (r[field] as string) || 'UNKNOWN';
    if (!groups.has(key)) groups.set(key, []);
    groups.get(key)!.push(r);
  }
  return Array.from(groups.entries())
    .map(([key, recs]) => computeSlice(key, recs))
    .sort((a, b) => b.tradeCount - a.tradeCount);
}

export async function getExpectancyStats(filters?: {
  regime?: string;
  sleeve?: string;
  atrBucket?: string;
  cluster?: string;
}): Promise<ExpectancyStats> {
  const where: Record<string, string> = {};
  if (filters?.regime) where.regime = filters.regime;
  if (filters?.sleeve) where.sleeve = filters.sleeve;
  if (filters?.atrBucket) where.atrBucket = filters.atrBucket;
  if (filters?.cluster) where.cluster = filters.cluster;

  const records = await prisma.evRecord.findMany({
    where,
    select: {
      rMultiple: true,
      outcome: true,
      regime: true,
      atrBucket: true,
      cluster: true,
      sleeve: true,
    },
  });

  return {
    overall: computeSlice('ALL', records),
    byRegime: groupSlices(records, 'regime'),
    byAtrBucket: groupSlices(records, 'atrBucket'),
    byCluster: groupSlices(records, 'cluster'),
    bySleeve: groupSlices(records, 'sleeve'),
  };
}

// ── Combination Expectancy Query ──────────────────────────────
// Queries the intersection of sleeve + ATR bucket + regime.
// Returns a single ExpectancySlice for the specific combination,
// or null if no matching records exist.
// Used by /api/ev-modifiers to feed into ev-modifier.ts scoring.
export async function getExpectancyForCombination(
  sleeve: string,
  atrBucket: string,
  regime: string
): Promise<ExpectancySlice | null> {
  const records = await prisma.evRecord.findMany({
    where: {
      sleeve,
      atrBucket,
      regime,
    },
    select: {
      rMultiple: true,
      outcome: true,
    },
  });

  if (records.length === 0) return null;

  return computeSlice(`${sleeve}|${atrBucket}|${regime}`, records);
}
