// ============================================================
// Dual Score Engine — TypeScript port of scoring.py
// BQS (Breakout Quality Score), FWS (Fatal Weakness Score),
// NCS (Net Composite Score)
// ============================================================

// ── Helpers ──────────────────────────────────────────────────

export function clamp(x: number, lo = 0, hi = 100): number {
  if (!Number.isFinite(x)) return lo;
  return Math.max(lo, Math.min(hi, x));
}

export function safeNum(value: unknown, fallback = 0): number {
  if (value == null) return fallback;
  const n = Number(value);
  return Number.isFinite(n) ? n : fallback;
}

export function safeBool(value: unknown, fallback = false): boolean {
  if (value == null) return fallback;
  if (typeof value === 'boolean') return value;
  if (typeof value === 'string') {
    return ['true', '1', 'yes'].includes(value.trim().toLowerCase());
  }
  return Boolean(value);
}

// ── Types ────────────────────────────────────────────────────

export interface SnapshotRow {
  ticker: string;
  name: string;
  sleeve: string;
  status: string;
  currency?: string;
  close: number;
  atr_14: number;
  atr_pct: number;
  adx_14: number;
  plus_di: number;
  minus_di: number;
  vol_ratio: number;
  dollar_vol_20?: number;
  liquidity_ok?: boolean;
  market_regime: string;
  market_regime_stable: boolean;
  high_20?: number;
  high_55?: number;
  distance_to_20d_high_pct: number;
  distance_to_55d_high_pct?: number;
  entry_trigger: number;
  stop_level: number;
  chasing_20_last5: boolean;
  chasing_55_last5: boolean;
  atr_spiking: boolean;
  atr_collapsing: boolean;
  rs_vs_benchmark_pct: number;
  days_to_earnings?: number | null;
  earnings_in_next_5d?: boolean;
  cluster_name?: string;
  super_cluster_name?: string;
  cluster_exposure_pct?: number;
  super_cluster_exposure_pct?: number;
  max_cluster_pct?: number;
  max_super_cluster_pct?: number;
  [key: string]: unknown;
}

export interface BQSComponents {
  bqs_trend: number;
  bqs_direction: number;
  bqs_volatility: number;
  bqs_proximity: number;
  bqs_tailwind: number;
  bqs_rs: number;
  bqs_vol_bonus: number;
  BQS: number;
}

export interface FWSComponents {
  fws_volume: number;
  fws_extension: number;
  fws_marginal_trend: number;
  fws_vol_shock: number;
  fws_regime_instability: number;
  FWS: number;
}

export interface Penalties {
  EarningsPenalty: number;
  ClusterPenalty: number;
  SuperClusterPenalty: number;
}

export interface NCSResult {
  BaseNCS: number;
  NCS: number;
}

export interface ScoredTicker extends SnapshotRow, BQSComponents, FWSComponents, Penalties, NCSResult {
  di_spread: number;
  ActionNote: string;
}

// ── BQS Components (0–100 total across 6 sub-scores + bonus) ─────────

function trendStrength(row: SnapshotRow): number {
  const adx = safeNum(row.adx_14);
  return 25 * clamp((adx - 15) / 20, 0, 1);
}

function directionDominance(row: SnapshotRow): number {
  const diSpread = safeNum(row.plus_di) - safeNum(row.minus_di);
  return 10 * clamp(diSpread / 25, 0, 1);
}

function volatilityHealth(row: SnapshotRow): number {
  const atrPct = safeNum(row.atr_pct);
  if (atrPct < 1.0) return 15 * clamp(atrPct / 1.0, 0, 1);
  if (atrPct <= 4.0) return 15;
  if (atrPct <= 6.0) return 15 * clamp(1 - (atrPct - 4.0) / 2.0, 0, 1);
  return 0;
}

function proximity(row: SnapshotRow): number {
  const d20 = row.distance_to_20d_high_pct;
  const d55 = row.distance_to_55d_high_pct;
  const dist = safeNum(d20 != null ? d20 : d55);
  return 15 * clamp(1 - dist / 3.0, 0, 1);
}

function marketTailwind(row: SnapshotRow): number {
  const regime = (row.market_regime || 'NEUTRAL').toUpperCase();
  const stable = safeBool(row.market_regime_stable, true);
  if (regime === 'BULLISH') return stable ? 15 : 9;
  if (regime === 'NEUTRAL') return 6;
  if (regime === 'BEARISH') return 1.5;
  return 6;
}

function rsScore(row: SnapshotRow): number {
  const rsPct = safeNum(row.rs_vs_benchmark_pct);
  return 15 * clamp((rsPct + 5) / 20, 0, 1);
}

export function computeBQS(row: SnapshotRow): BQSComponents {
  const trend = trendStrength(row);
  const direction = directionDominance(row);
  const vol = volatilityHealth(row);
  const prox = proximity(row);
  const tailwind = marketTailwind(row);
  const rs = rsScore(row);

  const volRatio = safeNum(row.vol_ratio, 1.0);
  const volBonus = volRatio > 1.2
    ? 5 * clamp((volRatio - 1.2) / 0.6, 0, 1)
    : 0;

  const bqs = clamp(trend + direction + vol + prox + tailwind + rs + volBonus);

  return {
    bqs_trend: round2(trend),
    bqs_direction: round2(direction),
    bqs_volatility: round2(vol),
    bqs_proximity: round2(prox),
    bqs_tailwind: round2(tailwind),
    bqs_rs: round2(rs),
    bqs_vol_bonus: round2(volBonus),
    BQS: round2(bqs),
  };
}

// ── FWS Components (0–100, higher = worse) ───────────────────

function volumeRisk(row: SnapshotRow): number {
  const vr = safeNum(row.vol_ratio, 1.0);
  return 30 * clamp(1 - (vr - 0.6) / 0.6, 0, 1);
}

function extensionRisk(row: SnapshotRow): number {
  const c20 = safeBool(row.chasing_20_last5);
  const c55 = safeBool(row.chasing_55_last5);
  if (c20 && c55) return 25;
  if (c20 || c55) return 15;
  return 0;
}

function marginalTrendRisk(row: SnapshotRow): number {
  const adx = safeNum(row.adx_14);
  if (adx < 20) return 10;
  if (adx <= 25) return 7;
  if (adx <= 30) return 3;
  return 0;
}

function volShockRisk(row: SnapshotRow): number {
  if (safeBool(row.atr_spiking)) return 20;
  if (safeBool(row.atr_collapsing)) return 10;
  return 0;
}

function regimeInstabilityRisk(row: SnapshotRow): number {
  return safeBool(row.market_regime_stable, true) ? 0 : 10;
}

export function computeFWS(row: SnapshotRow): FWSComponents {
  const vol = volumeRisk(row);
  const ext = extensionRisk(row);
  const marginal = marginalTrendRisk(row);
  const shock = volShockRisk(row);
  const regime = regimeInstabilityRisk(row);

  const fws = clamp(vol + ext + marginal + shock + regime);

  return {
    fws_volume: round2(vol),
    fws_extension: round2(ext),
    fws_marginal_trend: round2(marginal),
    fws_vol_shock: round2(shock),
    fws_regime_instability: round2(regime),
    FWS: round2(fws),
  };
}

// ── Penalties & NCS ─────────────────────────────────────────

function earningsPenalty(row: SnapshotRow): number {
  const d = row.days_to_earnings;
  if (d != null && Number.isFinite(Number(d))) {
    const days = Number(d);
    if (days <= 1) return 20;
    if (days <= 3) return 15;
    if (days <= 5) return 10;
    return 0;
  }
  if (safeBool(row.earnings_in_next_5d)) return 12;
  return 0;
}

function clusterPenalty(row: SnapshotRow): number {
  const exposure = safeNum(row.cluster_exposure_pct);
  const mx = safeNum(row.max_cluster_pct);
  if (mx <= 0) return 0;
  const x = exposure / mx;
  if (x <= 0.8) return 0;
  if (x <= 1.0) return 20 * (x - 0.8) / 0.2;
  return 20 + 30 * (x - 1.0);
}

function superClusterPenalty(row: SnapshotRow): number {
  const exposure = safeNum(row.super_cluster_exposure_pct);
  const mx = safeNum(row.max_super_cluster_pct);
  if (mx <= 0) return 0;
  const x = exposure / mx;
  if (x <= 0.8) return 0;
  if (x <= 1.0) return 25 * (x - 0.8) / 0.2;
  return 25 + 40 * (x - 1.0);
}

export function computePenalties(row: SnapshotRow): Penalties {
  return {
    EarningsPenalty: round2(earningsPenalty(row)),
    ClusterPenalty: round2(clusterPenalty(row)),
    SuperClusterPenalty: round2(superClusterPenalty(row)),
  };
}

export function computeNCS(bqs: number, fws: number, penalties: Penalties): NCSResult {
  const baseNCS = clamp(bqs - 0.8 * fws + 10);
  const ncs = clamp(
    baseNCS - penalties.EarningsPenalty - penalties.ClusterPenalty - penalties.SuperClusterPenalty
  );
  return {
    BaseNCS: round2(baseNCS),
    NCS: round2(ncs),
  };
}

export function actionNote(fws: number, ncs: number, earningsPen: number): string {
  let classification: string;
  if (fws > 65) {
    classification = 'Auto-No (fragile)';
  } else if (ncs >= 70 && fws <= 30) {
    classification = 'Auto-Yes';
  } else {
    classification = 'Conditional: needs confirmation (e.g., volume >=1.0 on breakout day)';
  }
  if (earningsPen > 0) {
    return `${classification} (Earnings headwind: -${Math.round(earningsPen)})`;
  }
  return classification;
}

// ── Full row scoring ────────────────────────────────────────

export function scoreRow(row: SnapshotRow): ScoredTicker {
  const bqs = computeBQS(row);
  const fws = computeFWS(row);
  const penalties = computePenalties(row);
  const ncs = computeNCS(bqs.BQS, fws.FWS, penalties);
  const note = actionNote(fws.FWS, ncs.NCS, penalties.EarningsPenalty);

  return {
    ...row,
    ...bqs,
    ...fws,
    ...penalties,
    ...ncs,
    di_spread: round2(safeNum(row.plus_di) - safeNum(row.minus_di)),
    ActionNote: note,
  };
}

export function scoreAll(rows: SnapshotRow[]): ScoredTicker[] {
  return rows.map(scoreRow);
}

// ── Column Mapping ──────────────────────────────────────────

const COLUMN_MAP: Record<string, string> = {
  instrument_name: 'name',
  adx: 'adx_14',
  atr: 'atr_14',
  '20d_high': 'high_20',
  '55d_high': 'high_55',
  breakout_entry_trigger: 'entry_trigger',
  stop_price: 'stop_level',
  rs_vs_benchmark: 'rs_vs_benchmark_pct',
  rs_pct: 'rs_vs_benchmark_pct',
  cluster: 'cluster_name',
  super_cluster: 'super_cluster_name',
  cluster_risk_pct: 'cluster_exposure_pct',
  super_cluster_risk_pct: 'super_cluster_exposure_pct',
  max_cluster_pct_default: 'max_cluster_pct',
  max_supercluster_pct_default: 'max_super_cluster_pct',
  t212_currency: 'currency',
};

const DEFAULTS: Record<string, unknown> = {
  ticker: '', name: '', sleeve: '', status: '', currency: '',
  close: 0, atr_14: 0, atr_pct: 0, adx_14: 0, plus_di: 0, minus_di: 0,
  vol_ratio: 1, dollar_vol_20: 0, liquidity_ok: true,
  market_regime: 'NEUTRAL', market_regime_stable: true,
  high_20: 0, high_55: 0, distance_to_20d_high_pct: 0, distance_to_55d_high_pct: 0,
  entry_trigger: 0, stop_level: 0,
  chasing_20_last5: false, chasing_55_last5: false,
  atr_spiking: false, atr_collapsing: false,
  rs_vs_benchmark_pct: 0, days_to_earnings: null, earnings_in_next_5d: false,
  cluster_name: '', super_cluster_name: '',
  cluster_exposure_pct: 0, super_cluster_exposure_pct: 0,
  max_cluster_pct: 0, max_super_cluster_pct: 0,
};

const BOOL_COLS: string[] = [
  'liquidity_ok', 'market_regime_stable',
  'chasing_20_last5', 'chasing_55_last5',
  'atr_spiking', 'atr_collapsing', 'earnings_in_next_5d',
];

const NUMERIC_COLS: string[] = [
  'close', 'atr_14', 'atr_pct', 'adx_14', 'plus_di', 'minus_di',
  'vol_ratio', 'dollar_vol_20', 'high_20', 'high_55',
  'distance_to_20d_high_pct', 'distance_to_55d_high_pct',
  'entry_trigger', 'stop_level', 'rs_vs_benchmark_pct',
  'cluster_exposure_pct', 'super_cluster_exposure_pct',
  'max_cluster_pct', 'max_super_cluster_pct',
];

/**
 * Normalise a raw CSV row (any column names) into a canonical SnapshotRow.
 */
export function normaliseRow(raw: Record<string, unknown>): SnapshotRow {
  const mapped: Record<string, unknown> = {};

  // apply column mapping
  for (const [key, value] of Object.entries(raw)) {
    const canonical = COLUMN_MAP[key] ?? key;
    // keep last (like Python: keep="last")
    mapped[canonical] = value;
  }

  // fill defaults
  for (const [key, def] of Object.entries(DEFAULTS)) {
    if (mapped[key] == null || mapped[key] === '') {
      mapped[key] = def;
    }
  }

  // coerce bools
  for (const col of BOOL_COLS) {
    mapped[col] = safeBool(mapped[col], DEFAULTS[col] as boolean);
  }

  // coerce numerics
  for (const col of NUMERIC_COLS) {
    mapped[col] = safeNum(mapped[col], DEFAULTS[col] as number);
  }

  // days_to_earnings → number | null
  if (mapped.days_to_earnings != null && mapped.days_to_earnings !== '') {
    const v = Number(mapped.days_to_earnings);
    mapped.days_to_earnings = Number.isFinite(v) ? v : null;
  } else {
    mapped.days_to_earnings = null;
  }

  // Auto-convert rs_vs_benchmark_pct from decimal fractions → %
  // Only convert if value looks like a true decimal (e.g. 0.03 for 3%)
  // Values from snapshot-sync already come as percentages (e.g. 3 = 3%),
  // so only convert values clearly < 1 in absolute terms.
  const rsVal = safeNum(mapped.rs_vs_benchmark_pct);
  if (Math.abs(rsVal) > 0 && Math.abs(rsVal) < 1) {
    mapped.rs_vs_benchmark_pct = rsVal * 100;
  }

  // Auto-convert atr_pct from decimal fractions → %
  // Only values < 0.01 (i.e. 0.005 = 0.5%) are converted.
  // Real ATR% values like 0.3 (meaning 0.3%) should NOT be converted.
  const atrVal = safeNum(mapped.atr_pct);
  if (atrVal > 0 && atrVal < 0.01) {
    mapped.atr_pct = atrVal * 100;
  }

  // name fallback
  if (!mapped.name && mapped.ticker) {
    mapped.name = mapped.ticker;
  }

  return mapped as unknown as SnapshotRow;
}

// ── Utility ─────────────────────────────────────────────────

function round2(v: number): number {
  return Math.round(v * 100) / 100;
}
