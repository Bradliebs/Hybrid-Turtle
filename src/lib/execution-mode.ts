/**
 * DEPENDENCIES
 * Consumed by: TodayPanel, BuyConfirmationModal, /api/positions, /api/dashboard/today-directive
 * Consumes: @/types (ExecutionMode, OPPORTUNISTIC_GATES)
 * Risk-sensitive: YES — determines whether entries are allowed
 * Last modified: 2026-03-04
 * Notes: Single source of truth for phase-based entry logic.
 *        Monday is ALWAYS blocked. Tuesday is PLANNED. Wed-Fri is OPPORTUNISTIC (BULLISH only).
 */

import type { ExecutionMode, OpportunisticGates } from '@/types';
import { OPPORTUNISTIC_GATES } from '@/types';

export interface ExecutionModeResult {
  mode: ExecutionMode;
  canEnter: boolean;
  reason: string;
  gates: OpportunisticGates | null;
  isOpportunistic: boolean;
  isPlanned: boolean;
}

/**
 * Determines the current execution mode based on day and regime.
 * @param dayOfWeek 0=Sun, 1=Mon, 2=Tue, 3=Wed, 4=Thu, 5=Fri, 6=Sat
 * @param regime Current market regime
 */
export function getExecutionMode(
  dayOfWeek: number,
  regime: string
): ExecutionModeResult {
  // Sunday
  if (dayOfWeek === 0) {
    return {
      mode: 'PLANNING',
      canEnter: false,
      reason: 'Planning day. Run the scan and prepare for Tuesday.',
      gates: null,
      isOpportunistic: false,
      isPlanned: false,
    };
  }

  // Monday — hard block, no exceptions
  if (dayOfWeek === 1) {
    return {
      mode: 'BLOCKED',
      canEnter: false,
      reason: 'Observation day. No entries on Monday — ever.',
      gates: null,
      isOpportunistic: false,
      isPlanned: false,
    };
  }

  // Tuesday — planned execution
  if (dayOfWeek === 2) {
    return {
      mode: 'PLANNED',
      canEnter: regime !== 'BEARISH',
      reason: regime === 'BEARISH'
        ? 'Regime is BEARISH. Planned entries blocked.'
        : 'Execution day. Execute planned trades.',
      gates: null,
      isOpportunistic: false,
      isPlanned: true,
    };
  }

  // Wednesday, Thursday, Friday — opportunistic
  if (dayOfWeek >= 3 && dayOfWeek <= 5) {
    const canEnter = regime === 'BULLISH';
    return {
      mode: 'OPPORTUNISTIC',
      canEnter,
      reason: !canEnter
        ? regime === 'BEARISH'
          ? 'Regime is BEARISH. Mid-week entries blocked.'
          : 'Regime is SIDEWAYS. Opportunistic entries require BULLISH regime.'
        : 'Opportunistic execution. Auto-Yes candidates only.',
      gates: canEnter ? OPPORTUNISTIC_GATES : null,
      isOpportunistic: true,
      isPlanned: false,
    };
  }

  // Saturday
  return {
    mode: 'PLANNING',
    canEnter: false,
    reason: 'Weekend. System is resting.',
    gates: null,
    isOpportunistic: false,
    isPlanned: false,
  };
}

/**
 * Get the current execution mode using UK time.
 */
export function getCurrentExecutionMode(regime: string): ExecutionModeResult {
  const ukDay = new Date().toLocaleDateString('en-GB', {
    weekday: 'short',
    timeZone: 'Europe/London',
  });
  const dayMap: Record<string, number> = { Sun: 0, Mon: 1, Tue: 2, Wed: 3, Thu: 4, Fri: 5, Sat: 6 };
  const dayOfWeek = dayMap[ukDay] ?? 0;
  return getExecutionMode(dayOfWeek, regime);
}
