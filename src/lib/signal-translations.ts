/**
 * DEPENDENCIES
 * Consumed by: TodayPanel.tsx
 * Consumes: none (pure functions)
 * Risk-sensitive: NO
 * Last modified: 2026-03-01
 * Notes: Translates raw technical values into plain English labels.
 *        Every function is pure and independently testable.
 *        These translations power the "What Should I Do Today?" panel.
 *        compositeScore() accepts optional evModifier from ev-modifier.ts.
 */

// ── NCS → Star Rating ────────────────────────────────────────

export interface StarRating {
  stars: number;       // 1–5
  label: string;       // "Excellent", "Very Good", etc.
  display: string;     // "★★★★★ Excellent"
}

export function ncsToStars(ncs: number | null | undefined): StarRating {
  if (ncs == null || !Number.isFinite(ncs)) {
    return { stars: 1, label: 'Unknown', display: '★☆☆☆☆ Unknown' };
  }
  if (ncs >= 90) return { stars: 5, label: 'Excellent', display: '★★★★★ Excellent' };
  if (ncs >= 75) return { stars: 4, label: 'Very Good', display: '★★★★☆ Very Good' };
  if (ncs >= 60) return { stars: 3, label: 'Good', display: '★★★☆☆ Good' };
  if (ncs >= 45) return { stars: 2, label: 'Moderate', display: '★★☆☆☆ Moderate' };
  return { stars: 1, label: 'Weak — system says wait', display: '★☆☆☆☆ Weak' };
}

// ── Hurst → Trend Persistence ────────────────────────────────

export type SignalStatus = 'positive' | 'uncertain' | 'negative';

export interface SignalLabel {
  text: string;
  status: SignalStatus;
}

export function hurstToLabel(h: number | null | undefined): SignalLabel {
  if (h == null || !Number.isFinite(h)) {
    return { text: 'No data', status: 'uncertain' };
  }
  if (h > 0.6) return { text: 'Confirmed', status: 'positive' };
  if (h >= 0.5) return { text: 'Uncertain', status: 'uncertain' };
  return { text: 'Fading', status: 'negative' };
}

export function hurstToReason(h: number | null | undefined): string {
  if (h == null) return '';
  if (h > 0.6) return 'Trend has been building for weeks';
  if (h >= 0.5) return 'Trend is developing';
  return 'Price movement looks random';
}

// ── ADX → Trend Strength ────────────────────────────────────

export function adxToLabel(adx: number | null | undefined): SignalLabel {
  if (adx == null || !Number.isFinite(adx)) {
    return { text: 'No data', status: 'uncertain' };
  }
  if (adx > 40) return { text: 'Strong', status: 'positive' };
  if (adx >= 25) return { text: 'Good', status: 'positive' };
  if (adx >= 20) return { text: 'Weak — be careful', status: 'uncertain' };
  return { text: 'Weak', status: 'negative' };
}

export function adxToReason(adx: number | null | undefined): string {
  if (adx == null) return '';
  if (adx > 40) return 'Strong upward trend confirmed';
  if (adx >= 25) return 'Good trend in place';
  if (adx >= 20) return 'Trend is emerging — proceed carefully';
  return 'Trend is weak';
}

// ── BPS → Breakout Quality ──────────────────────────────────

export function bpsToLabel(bps: number | null | undefined): SignalLabel {
  if (bps == null || !Number.isFinite(bps)) {
    return { text: 'No data', status: 'uncertain' };
  }
  if (bps >= 14) return { text: 'Very convincing', status: 'positive' };
  if (bps >= 10) return { text: 'Solid', status: 'positive' };
  if (bps >= 7) return { text: 'Moderate', status: 'uncertain' };
  return { text: 'Weak', status: 'negative' };
}

export function bpsToReason(bps: number | null | undefined): string {
  if (bps == null) return '';
  if (bps >= 14) return 'Breakout looks very convincing';
  if (bps >= 10) return 'Breakout looks solid';
  if (bps >= 7) return 'Breakout is moderate';
  return 'Breakout structure is weak';
}

// ── FWS → Risk Warning ─────────────────────────────────────

export function fwsToLabel(fws: number | null | undefined): SignalLabel {
  if (fws == null || !Number.isFinite(fws)) {
    return { text: 'No data', status: 'uncertain' };
  }
  if (fws < 20) return { text: 'Low', status: 'positive' };
  if (fws <= 40) return { text: 'Some caution', status: 'uncertain' };
  return { text: 'High', status: 'negative' };
}

export function fwsToReason(fws: number | null | undefined): string {
  if (fws == null) return '';
  if (fws < 20) return 'Low risk of sudden reversal';
  if (fws <= 40) return 'Some caution needed';
  return 'High risk — system says skip';
}

// ── Regime → Market Mood ────────────────────────────────────

export function regimeToLabel(regime: string | null | undefined, stable = true): SignalLabel {
  const r = (regime || '').toUpperCase();
  if (r === 'BULLISH' && stable) return { text: 'Positive', status: 'positive' };
  if (r === 'BULLISH') return { text: 'Uncertain', status: 'uncertain' };
  if (r === 'BEARISH') return { text: 'Negative', status: 'negative' };
  return { text: 'Uncertain', status: 'uncertain' };
}

export function regimeToReason(regime: string | null | undefined): string {
  const r = (regime || '').toUpperCase();
  if (r === 'BULLISH') return 'Market conditions support this move';
  if (r === 'BEARISH') return 'Market is falling — system is protecting you';
  return 'Market is sideways — wait for clear trend';
}

// ── R-Multiple → Position Description ───────────────────────

export interface PositionDescription {
  emoji: string;
  summary: string;
  action: string;
  needsAttention: boolean;
}

export function rMultipleToDescription(r: number | null | undefined): PositionDescription {
  if (r == null || !Number.isFinite(r)) {
    return { emoji: '➡', summary: 'Holding', action: 'No action needed', needsAttention: false };
  }
  if (r < 0) return { emoji: '📉', summary: 'Down — stop is protecting you', action: 'No action needed', needsAttention: false };
  if (r < 0.5) return { emoji: '➡', summary: 'Flat — holding steady', action: 'No action needed', needsAttention: false };
  if (r < 1) return { emoji: '📈', summary: 'Up slightly — looking good', action: 'No action needed', needsAttention: false };
  if (r < 2) return { emoji: '📈', summary: 'Up well', action: 'Consider moving stop to breakeven', needsAttention: true };
  if (r < 3) return { emoji: '🚀', summary: 'Up strongly', action: 'Lock in some profit — review your stop', needsAttention: true };
  return { emoji: '🏆', summary: 'Excellent move', action: 'Trail your stop', needsAttention: true };
}

// ── Portfolio Space ─────────────────────────────────────────

export function portfolioSpaceLabel(used: number, max: number): SignalLabel {
  const available = max - used;
  if (available <= 0) return { text: 'Full — no new trades', status: 'negative' };
  return { text: `${available} slot${available > 1 ? 's' : ''} available`, status: 'positive' };
}

// ── Risk Budget ─────────────────────────────────────────────

export function riskBudgetLabel(usedPct: number, maxPct: number): SignalLabel {
  const remaining = maxPct - usedPct;
  if (remaining <= 0) return { text: 'Full — no new trades', status: 'negative' };
  if (remaining < maxPct * 0.25) return { text: 'Nearly full — be careful', status: 'uncertain' };
  return { text: 'Healthy — room for trades', status: 'positive' };
}

// ── Composite Candidate Score ───────────────────────────────
// Used to rank trigger-met candidates in the TodayPanel.
// NCS × 0.4 + BPS_norm × 0.35 + hurstBonus × 0.25 + evModifier
// Redistributes weights proportionally when data is missing.
// evModifier is an additive term from EV tracker history (-10 to +5).
// Result clamped to [0, 100].

export function hurstToBonus(h: number | null | undefined): number {
  if (h == null || !Number.isFinite(h)) return -1; // signal: missing
  if (h >= 0.7) return 100;
  if (h >= 0.6) return 75;
  if (h >= 0.5) return 40;
  return 0;
}

export function compositeScore(
  ncs: number | null | undefined,
  bps: number | null | undefined,
  hurstExponent: number | null | undefined,
  evModifier?: number | null
): number {
  const ncsVal = ncs != null && Number.isFinite(ncs) ? ncs : 50; // neutral default

  // Normalise BPS (0–19 → 0–100)
  const hasBps = bps != null && Number.isFinite(bps);
  const bpsNorm = hasBps ? (bps! / 19) * 100 : -1;

  // Hurst bonus (0–100)
  const hBonus = hurstToBonus(hurstExponent);

  // Determine available weights
  let ncsWeight = 0.4;
  let bpsWeight = hasBps ? 0.35 : 0;
  let hurstWeight = hBonus >= 0 ? 0.25 : 0;

  const totalWeight = ncsWeight + bpsWeight + hurstWeight;
  if (totalWeight === 0) return Math.max(0, Math.min(100, ncsVal + (evModifier ?? 0)));

  // Normalise weights to sum to 1
  ncsWeight /= totalWeight;
  bpsWeight /= totalWeight;
  hurstWeight /= totalWeight;

  const baseScore =
    ncsVal * ncsWeight +
    (bpsNorm >= 0 ? bpsNorm : 0) * bpsWeight +
    (hBonus >= 0 ? hBonus : 0) * hurstWeight;

  // Apply EV modifier as additive term, then clamp [0, 100]
  const final = baseScore + (evModifier ?? 0);
  return Math.round(Math.max(0, Math.min(100, final)));
}

// ── Build "Why System Likes It" reasons list ────────────────

export interface TradeReason {
  text: string;
  status: SignalStatus;
}

export function buildTradeReasons(opts: {
  adx?: number | null;
  hurst?: number | null;
  bps?: number | null;
  fws?: number | null;
  regime?: string | null;
  volRatio?: number | null;
}): TradeReason[] {
  const reasons: TradeReason[] = [];

  // ADX → trend strength
  if (opts.adx != null) {
    const label = adxToLabel(opts.adx);
    reasons.push({ text: adxToReason(opts.adx), status: label.status });
  }

  // Hurst → trend persistence
  if (opts.hurst != null) {
    const label = hurstToLabel(opts.hurst);
    reasons.push({ text: hurstToReason(opts.hurst), status: label.status });
  }

  // Volume confirmation (from BPS)
  if (opts.bps != null && opts.bps >= 10) {
    reasons.push({ text: 'Volume picked up on the breakout', status: 'positive' });
  } else if (opts.bps != null && opts.bps >= 7) {
    reasons.push({ text: 'Volume is moderate', status: 'uncertain' });
  }

  // Regime → market conditions
  if (opts.regime) {
    const label = regimeToLabel(opts.regime);
    reasons.push({ text: regimeToReason(opts.regime), status: label.status });
  }

  // FWS → risk of failure
  if (opts.fws != null) {
    const label = fwsToLabel(opts.fws);
    reasons.push({ text: fwsToReason(opts.fws), status: label.status });
  }

  return reasons;
}

// ── Status Icon Helper ──────────────────────────────────────

export function statusIcon(status: SignalStatus): string {
  if (status === 'positive') return '✓';
  if (status === 'uncertain') return '⚠';
  return '✗';
}

export function statusColor(status: SignalStatus): string {
  if (status === 'positive') return 'text-emerald-400';
  if (status === 'uncertain') return 'text-amber-400';
  return 'text-red-400';
}
