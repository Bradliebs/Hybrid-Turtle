/**
 * DEPENDENCIES
 * Consumed by: /api/prediction/trade-pulse/route.ts, TradePulse dashboard
 * Consumes: (standalone — pure computation from pre-fetched signal data)
 * Risk-sensitive: NO — advisory scoring only
 * Last modified: 2026-03-07
 * Notes: Unified TradePulse score (0–100) compositing all prediction layers.
 *        Grade: A+ (90+), A (80+), B (65+), C (50+), D (<50).
 *        ⛔ Does NOT modify sacred files.
 */

// ── Types ────────────────────────────────────────────────────

export type TradePulseGrade = 'A+' | 'A' | 'B' | 'C' | 'D';

export interface TradePulseInput {
  ncs: number;                     // raw NCS (0–100)
  fws: number;                     // FWS (0–100, lower = better)
  conformalWidth: number | null;   // interval width from Phase 1
  fmMaxScore: number;              // highest FM score from Phase 2
  fmBlockCount: number;            // number of FM blocks
  stressTestProb: number | null;   // stop-hit probability from Phase 4 (0–1)
  gnnScore: number | null;         // GNN score from Phase 8 (0–1)
  beliefMean: number | null;       // Bayesian belief mean from Phase 9
  kellyVsFixed: number | null;     // Kelly ratio from Phase 11 (< 1 = Kelly says smaller)
  vpinDofi: number | null;         // directional OFI from Phase 12 (-1 to +1)
  sentimentScs: number | null;     // sentiment composite from Phase 13 (0–100)
  invarianceAvg: number | null;    // average invariance score from Phase 14 (0–1)
  dangerScore: number;             // danger level from Phase 6 (0–100)
}

export interface SignalContribution {
  name: string;
  shortName: string;
  score: number;       // 0–100 normalised
  weight: number;
  status: 'POSITIVE' | 'NEUTRAL' | 'NEGATIVE' | 'UNAVAILABLE';
  detail?: string;
}

export interface TradePulseResult {
  /** Overall score 0–100 */
  score: number;
  /** Grade: A+ / A / B / C / D */
  grade: TradePulseGrade;
  /** Decision classification */
  decision: 'AUTO_YES' | 'CONDITIONAL' | 'AUTO_NO';
  /** Per-signal contributions */
  signals: SignalContribution[];
  /** Flagged concerns (negative signals) */
  concerns: string[];
  /** Confirming opportunities (positive signals) */
  opportunities: string[];
}

// ── Grade Classification ─────────────────────────────────────

export function classifyGrade(score: number): TradePulseGrade {
  if (score >= 90) return 'A+';
  if (score >= 80) return 'A';
  if (score >= 65) return 'B';
  if (score >= 50) return 'C';
  return 'D';
}

export const GRADE_STYLES: Record<TradePulseGrade, { text: string; bg: string; border: string }> = {
  'A+': { text: 'text-emerald-300', bg: 'bg-emerald-500/15', border: 'border-emerald-500/40' },
  'A':  { text: 'text-emerald-400', bg: 'bg-emerald-500/10', border: 'border-emerald-500/30' },
  'B':  { text: 'text-blue-400',    bg: 'bg-blue-500/10',    border: 'border-blue-500/30' },
  'C':  { text: 'text-amber-400',   bg: 'bg-amber-500/10',   border: 'border-amber-500/30' },
  'D':  { text: 'text-red-400',     bg: 'bg-red-500/10',     border: 'border-red-500/30' },
};

// ── Score Computation ────────────────────────────────────────

/**
 * Compute the unified TradePulse score from all prediction layers.
 * Weighted composite of available signals, with penalty multipliers for risks.
 */
export function computeTradePulse(input: TradePulseInput): TradePulseResult {
  const signals: SignalContribution[] = [];
  const concerns: string[] = [];
  const opportunities: string[] = [];

  // ── Core NCS (40% weight) ──
  const ncsNorm = Math.max(0, Math.min(100, input.ncs));
  signals.push({
    name: 'Net Composite Score',
    shortName: 'NCS',
    score: ncsNorm,
    weight: 0.40,
    status: ncsNorm >= 70 ? 'POSITIVE' : ncsNorm >= 50 ? 'NEUTRAL' : 'NEGATIVE',
    detail: `NCS ${Math.round(ncsNorm)} / FWS ${Math.round(input.fws)}`,
  });
  if (ncsNorm >= 70 && input.fws <= 30) opportunities.push('NCS qualifies for Auto-Yes');
  if (input.fws > 65) concerns.push(`High fragility: FWS ${Math.round(input.fws)}`);

  // ── Conformal Confidence (10% weight) ──
  if (input.conformalWidth !== null) {
    const confScore = Math.max(0, 100 - input.conformalWidth * 3.3); // width 30 → 0
    signals.push({
      name: 'Prediction Confidence',
      shortName: 'Conf',
      score: confScore,
      weight: 0.10,
      status: confScore >= 70 ? 'POSITIVE' : confScore >= 40 ? 'NEUTRAL' : 'NEGATIVE',
      detail: `Interval width: ${input.conformalWidth.toFixed(1)}`,
    });
    if (confScore < 40) concerns.push('Wide prediction interval — high uncertainty');
    if (confScore >= 80) opportunities.push('Tight confidence interval — high conviction');
  }

  // ── Failure Modes (10% weight, penalty-only) ──
  const fmScore = Math.max(0, 100 - input.fmMaxScore);
  signals.push({
    name: 'Failure Mode Safety',
    shortName: 'FM',
    score: fmScore,
    weight: 0.10,
    status: input.fmBlockCount > 0 ? 'NEGATIVE' : fmScore >= 60 ? 'POSITIVE' : 'NEUTRAL',
    detail: input.fmBlockCount > 0 ? `${input.fmBlockCount} FM blocked` : `Max FM: ${Math.round(input.fmMaxScore)}`,
  });
  if (input.fmBlockCount > 0) concerns.push(`Failure mode blocked (${input.fmBlockCount} FM above threshold)`);

  // ── Stress Test (10% weight) ──
  if (input.stressTestProb !== null) {
    const stressScore = Math.max(0, 100 - input.stressTestProb * 250); // 40% → 0
    signals.push({
      name: 'Stress Test Survival',
      shortName: 'Stress',
      score: stressScore,
      weight: 0.10,
      status: stressScore >= 60 ? 'POSITIVE' : stressScore >= 30 ? 'NEUTRAL' : 'NEGATIVE',
      detail: `${Math.round(input.stressTestProb * 100)}% adversarial stop-hit`,
    });
    if (input.stressTestProb > 0.25) concerns.push(`High stress test failure: ${Math.round(input.stressTestProb * 100)}%`);
    if (input.stressTestProb < 0.15) opportunities.push('Low adversarial stop-hit risk');
  }

  // ── GNN Graph Signal (5% weight) ──
  if (input.gnnScore !== null) {
    const gnnNorm = input.gnnScore * 100;
    signals.push({
      name: 'Graph Network Signal',
      shortName: 'GNN',
      score: gnnNorm,
      weight: 0.05,
      status: gnnNorm >= 60 ? 'POSITIVE' : gnnNorm >= 40 ? 'NEUTRAL' : 'NEGATIVE',
      detail: `GNN: ${Math.round(gnnNorm)}%`,
    });
    if (gnnNorm >= 70) opportunities.push('Strong upstream graph signal');
  }

  // ── Bayesian Belief (5% weight) ──
  if (input.beliefMean !== null) {
    const beliefNorm = input.beliefMean * 100;
    signals.push({
      name: 'Signal Reliability',
      shortName: 'Belief',
      score: beliefNorm,
      weight: 0.05,
      status: beliefNorm >= 60 ? 'POSITIVE' : beliefNorm >= 40 ? 'NEUTRAL' : 'NEGATIVE',
      detail: `Belief mean: ${(input.beliefMean * 100).toFixed(0)}%`,
    });
  }

  // ── VPIN Order Flow (5% weight) ──
  if (input.vpinDofi !== null) {
    const vpinNorm = Math.max(0, Math.min(100, 50 + input.vpinDofi * 50));
    signals.push({
      name: 'Order Flow',
      shortName: 'VPIN',
      score: vpinNorm,
      weight: 0.05,
      status: input.vpinDofi > 0.15 ? 'POSITIVE' : input.vpinDofi < -0.15 ? 'NEGATIVE' : 'NEUTRAL',
      detail: `DOFI: ${input.vpinDofi > 0 ? '+' : ''}${(input.vpinDofi * 100).toFixed(0)}%`,
    });
    if (input.vpinDofi > 0.3) opportunities.push('Strong buying pressure (VPIN)');
    if (input.vpinDofi < -0.3) concerns.push('Strong selling pressure detected');
  }

  // ── Sentiment (5% weight) ──
  if (input.sentimentScs !== null) {
    signals.push({
      name: 'Sentiment',
      shortName: 'Sent',
      score: input.sentimentScs,
      weight: 0.05,
      status: input.sentimentScs >= 60 ? 'POSITIVE' : input.sentimentScs <= 40 ? 'NEGATIVE' : 'NEUTRAL',
      detail: `SCS: ${Math.round(input.sentimentScs)}`,
    });
    if (input.sentimentScs >= 70) opportunities.push('Positive sentiment alignment');
    if (input.sentimentScs <= 30) concerns.push('Bearish sentiment divergence');
  }

  // ── Danger Level (5% weight, penalty-only) ──
  const dangerNorm = Math.max(0, 100 - input.dangerScore);
  signals.push({
    name: 'Market Safety',
    shortName: 'Danger',
    score: dangerNorm,
    weight: 0.05,
    status: input.dangerScore > 75 ? 'NEGATIVE' : input.dangerScore > 50 ? 'NEUTRAL' : 'POSITIVE',
    detail: `Danger: ${input.dangerScore}/100`,
  });
  if (input.dangerScore > 75) concerns.push('High market danger — immune alert active');

  // ── Compute weighted score ──
  let totalWeight = 0;
  let weightedSum = 0;
  for (const s of signals) {
    if (s.status !== 'UNAVAILABLE') {
      weightedSum += s.score * s.weight;
      totalWeight += s.weight;
    }
  }

  const rawScore = totalWeight > 0 ? weightedSum / totalWeight : 50;

  // Apply hard penalties
  let penalisedScore = rawScore;
  if (input.fmBlockCount > 0) penalisedScore *= 0.6; // 40% penalty for any FM block
  if (input.fws > 65) penalisedScore *= 0.5;          // 50% penalty for Auto-No FWS
  if (input.dangerScore > 75) penalisedScore *= 0.85;  // 15% penalty for danger

  const score = Math.round(Math.max(0, Math.min(100, penalisedScore)));
  const grade = classifyGrade(score);

  // Decision classification
  let decision: TradePulseResult['decision'];
  if (input.fws > 65 || input.fmBlockCount > 0) decision = 'AUTO_NO';
  else if (input.ncs >= 70 && input.fws <= 30 && input.fmBlockCount === 0) decision = 'AUTO_YES';
  else decision = 'CONDITIONAL';

  return { score, grade, decision, signals, concerns, opportunities };
}
