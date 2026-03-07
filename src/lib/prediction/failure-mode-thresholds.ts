/**
 * DEPENDENCIES
 * Consumed by: failure-mode-scorer.ts, /api/prediction/failure-modes/route.ts, FailureModePanel.tsx
 * Consumes: (standalone — no imports)
 * Risk-sensitive: NO — configuration only
 * Last modified: 2026-03-07
 * Notes: Configurable rejection thresholds per failure mode.
 *        A trade is rejected if ANY single FM exceeds its threshold.
 *        Tightest threshold on FM5 (events are catastrophic when they surprise).
 */

// ── Failure Mode IDs ─────────────────────────────────────────

export type FailureModeId = 'fm1' | 'fm2' | 'fm3' | 'fm4' | 'fm5';

// ── Labels & Descriptions ────────────────────────────────────

export interface FailureModeInfo {
  id: FailureModeId;
  name: string;
  shortName: string;
  description: string;
  icon: string;
}

export const FAILURE_MODES: Record<FailureModeId, FailureModeInfo> = {
  fm1: {
    id: 'fm1',
    name: 'Breakout Failure Risk',
    shortName: 'Breakout',
    description: 'Probability of false break / immediate reversal',
    icon: '💥',
  },
  fm2: {
    id: 'fm2',
    name: 'Liquidity Trap Risk',
    shortName: 'Liquidity',
    description: 'Volume drying up post-entry; inability to exit cleanly',
    icon: '🏜️',
  },
  fm3: {
    id: 'fm3',
    name: 'Correlation Cascade Risk',
    shortName: 'Correlation',
    description: 'Portfolio correlation concentration; forced exit contagion',
    icon: '🔗',
  },
  fm4: {
    id: 'fm4',
    name: 'Regime Flip Risk',
    shortName: 'Regime',
    description: 'Trend environment collapses mid-trade',
    icon: '🌪️',
  },
  fm5: {
    id: 'fm5',
    name: 'Event Gap Risk',
    shortName: 'Event',
    description: 'Known earnings / macro event within stop distance',
    icon: '📅',
  },
};

// ── Thresholds ───────────────────────────────────────────────
// Score > threshold → BLOCK. Each threshold was set based on
// the severity of the failure mode's impact on the position.

export const FM_THRESHOLDS: Record<FailureModeId, number> = {
  fm1: 65,  // breakout failure
  fm2: 70,  // liquidity trap
  fm3: 75,  // correlation cascade
  fm4: 60,  // regime flip
  fm5: 55,  // event gap (tightest — surprise events are catastrophic)
};

// Warning threshold: score > warn but ≤ block → WARN
export const FM_WARN_THRESHOLDS: Record<FailureModeId, number> = {
  fm1: 45,
  fm2: 50,
  fm3: 55,
  fm4: 40,
  fm5: 35,
};

// ── Status Classification ────────────────────────────────────

export type FMStatus = 'PASS' | 'WARN' | 'BLOCK';

export function classifyFMStatus(id: FailureModeId, score: number): FMStatus {
  if (score > FM_THRESHOLDS[id]) return 'BLOCK';
  if (score > FM_WARN_THRESHOLDS[id]) return 'WARN';
  return 'PASS';
}

// ── Types ────────────────────────────────────────────────────

export interface FMScores {
  fm1: number;
  fm2: number;
  fm3: number;
  fm4: number;
  fm5: number;
}

export interface FMResult {
  id: FailureModeId;
  score: number;
  status: FMStatus;
  reason?: string;
}

export interface FailureModeGateResult {
  pass: boolean;
  blockedBy: FailureModeId[];
  warnedBy: FailureModeId[];
  results: FMResult[];
}

/**
 * Evaluate all failure mode scores against thresholds.
 * Returns pass=false if ANY single FM exceeds its block threshold.
 */
export function failureModeGate(scores: FMScores, reasons?: Record<FailureModeId, string>): FailureModeGateResult {
  const allIds: FailureModeId[] = ['fm1', 'fm2', 'fm3', 'fm4', 'fm5'];

  const results: FMResult[] = allIds.map(id => ({
    id,
    score: scores[id],
    status: classifyFMStatus(id, scores[id]),
    reason: reasons?.[id],
  }));

  const blockedBy = results.filter(r => r.status === 'BLOCK').map(r => r.id);
  const warnedBy = results.filter(r => r.status === 'WARN').map(r => r.id);

  return {
    pass: blockedBy.length === 0,
    blockedBy,
    warnedBy,
    results,
  };
}
