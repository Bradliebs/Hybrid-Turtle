/**
 * DEPENDENCIES
 * Consumed by: TodayPanel, OpportunisticCandidatesPanel
 * Consumes: @/types (OPPORTUNISTIC_GATES)
 * Risk-sensitive: NO (filter only — does not create positions)
 * Last modified: 2026-03-04
 * Notes: Filters existing scan candidates to only those eligible for
 *        mid-week opportunistic entry. Does not trigger a new scan.
 */

import { OPPORTUNISTIC_GATES } from '@/types';

// Minimal candidate shape — matches fields available from cross-ref/scan data
export interface OpportunisticInput {
  ticker: string;
  dualNCS?: number | null;
  dualFWS?: number | null;
  dualAction?: string | null;
  [key: string]: unknown; // pass-through for other fields
}

export interface OpportunisticFilterResult<T extends OpportunisticInput> {
  eligible: T[];
  blocked: Array<{ candidate: T; reason: string }>;
  atDailyLimit: boolean;
}

/**
 * Filter candidates to only those eligible for mid-week opportunistic entry.
 * @param candidates All READY/trigger-met candidates from last scan
 * @param todayEntryCount Number of non-HEDGE positions opened today
 */
export function filterOpportunisticCandidates<T extends OpportunisticInput>(
  candidates: T[],
  todayEntryCount: number
): OpportunisticFilterResult<T> {
  const { minNCS, maxFWS, maxNewPositions } = OPPORTUNISTIC_GATES;

  // Daily limit check
  if (todayEntryCount >= maxNewPositions) {
    return {
      eligible: [],
      blocked: candidates.map((c) => ({
        candidate: c,
        reason: `Daily limit reached (${maxNewPositions} mid-week entry per day)`,
      })),
      atDailyLimit: true,
    };
  }

  const eligible: T[] = [];
  const blocked: Array<{ candidate: T; reason: string }> = [];

  for (const candidate of candidates) {
    // Must be Auto-Yes
    const action = candidate.dualAction ?? '';
    if (!action.startsWith('Auto-Yes')) {
      blocked.push({ candidate, reason: `Not Auto-Yes (${action || 'no score'})` });
      continue;
    }

    // NCS threshold
    const ncs = candidate.dualNCS ?? 0;
    if (ncs < minNCS) {
      blocked.push({ candidate, reason: `NCS ${ncs.toFixed(0)} below mid-week minimum of ${minNCS}` });
      continue;
    }

    // FWS threshold
    const fws = candidate.dualFWS ?? 100;
    if (fws > maxFWS) {
      blocked.push({ candidate, reason: `FWS ${fws.toFixed(0)} above mid-week maximum of ${maxFWS}` });
      continue;
    }

    eligible.push(candidate);
  }

  return { eligible, blocked, atDailyLimit: false };
}
