/**
 * DEPENDENCIES
 * Consumed by: policy-network.ts, maml-trainer.ts, /api/prediction/trade-recommendation/route.ts
 * Consumes: (standalone — pure data encoding, no imports)
 * Risk-sensitive: NO — observation encoding only
 * Last modified: 2026-03-07
 * Notes: Encodes open trade state as a normalised observation vector for
 *        the Meta-RL policy network. 14 features, all normalised to [0, 1].
 *        ⛔ Does NOT modify sacred files.
 */

// ── Types ────────────────────────────────────────────────────

export interface TradeObservation {
  // Position state
  rMultipleCurrent: number;
  daysInTrade: number;
  stopDistanceAtr: number;
  pyramidLevel: number;
  // Market state
  regimeScore: number;
  vixPercentile: number;
  volumeTrend3d: number;
  priceVsEntryPercent: number;
  // Signal state
  currentNCS: number;
  beliefWeightedNCS: number;
  fm1Score: number;
  fm4Score: number;
  // Risk state
  openRiskPercent: number;
  correlationWithPortfolio: number;
}

export const OBSERVATION_DIM = 14;

export type TradeAction =
  | 'HOLD'
  | 'TIGHTEN_STOP'
  | 'TRAIL_STOP_ATR'
  | 'PYRAMID_ADD'
  | 'PARTIAL_EXIT_25'
  | 'PARTIAL_EXIT_50'
  | 'FULL_EXIT';

export const ACTIONS: TradeAction[] = [
  'HOLD', 'TIGHTEN_STOP', 'TRAIL_STOP_ATR', 'PYRAMID_ADD',
  'PARTIAL_EXIT_25', 'PARTIAL_EXIT_50', 'FULL_EXIT',
];

export const ACTION_DIM = ACTIONS.length; // 7

export const ACTION_LABELS: Record<TradeAction, string> = {
  HOLD: 'Hold position',
  TIGHTEN_STOP: 'Tighten stop to swing low',
  TRAIL_STOP_ATR: 'Trail stop (2× ATR)',
  PYRAMID_ADD: 'Add to position',
  PARTIAL_EXIT_25: 'Take 25% profit',
  PARTIAL_EXIT_50: 'Take 50% profit',
  FULL_EXIT: 'Close entire position',
};

export const ACTION_ICONS: Record<TradeAction, string> = {
  HOLD: '⏸️',
  TIGHTEN_STOP: '🔒',
  TRAIL_STOP_ATR: '📏',
  PYRAMID_ADD: '📈',
  PARTIAL_EXIT_25: '💰',
  PARTIAL_EXIT_50: '💵',
  FULL_EXIT: '🚪',
};

// ── Normalisation Ranges ─────────────────────────────────────

interface Range { min: number; max: number }

const RANGES: Range[] = [
  { min: -3, max: 5 },      // rMultipleCurrent
  { min: 0, max: 60 },      // daysInTrade
  { min: 0, max: 5 },       // stopDistanceAtr
  { min: 0, max: 2 },       // pyramidLevel
  { min: 0, max: 100 },     // regimeScore
  { min: 0, max: 100 },     // vixPercentile
  { min: -2, max: 2 },      // volumeTrend3d (ratio)
  { min: -20, max: 30 },    // priceVsEntryPercent
  { min: 0, max: 100 },     // currentNCS
  { min: 0, max: 100 },     // beliefWeightedNCS
  { min: 0, max: 100 },     // fm1Score
  { min: 0, max: 100 },     // fm4Score
  { min: 0, max: 15 },      // openRiskPercent
  { min: 0, max: 1 },       // correlationWithPortfolio
];

// ── Encoding ─────────────────────────────────────────────────

function normalise(value: number, min: number, max: number): number {
  if (max === min) return 0.5;
  return Math.max(0, Math.min(1, (value - min) / (max - min)));
}

/**
 * Encode a trade observation into a normalised [0,1] vector.
 */
export function encodeObservation(obs: TradeObservation): number[] {
  const raw = [
    obs.rMultipleCurrent,
    obs.daysInTrade,
    obs.stopDistanceAtr,
    obs.pyramidLevel,
    obs.regimeScore,
    obs.vixPercentile,
    obs.volumeTrend3d,
    obs.priceVsEntryPercent,
    obs.currentNCS,
    obs.beliefWeightedNCS,
    obs.fm1Score,
    obs.fm4Score,
    obs.openRiskPercent,
    obs.correlationWithPortfolio,
  ];

  return raw.map((v, i) => normalise(v, RANGES[i].min, RANGES[i].max));
}

/**
 * Get the top-2 feature indices driving a decision.
 * Used for explaining recommendations to the human.
 */
export function getTopFeatures(vec: number[]): Array<{ name: string; value: number }> {
  const FEATURE_NAMES = [
    'R-multiple', 'Days held', 'Stop distance', 'Pyramid level',
    'Regime', 'VIX', 'Volume trend', 'Price vs entry',
    'NCS', 'Belief NCS', 'FM1 (breakout)', 'FM4 (regime)',
    'Open risk %', 'Correlation',
  ];

  const indexed = vec.map((v, i) => ({ idx: i, deviation: Math.abs(v - 0.5) }));
  indexed.sort((a, b) => b.deviation - a.deviation);

  return indexed.slice(0, 2).map(f => ({
    name: FEATURE_NAMES[f.idx],
    value: Math.round(vec[f.idx] * 100) / 100,
  }));
}
