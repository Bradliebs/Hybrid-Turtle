/**
 * DEPENDENCIES
 * Consumed by: TDARegimeBadge component (via Navbar), TodayPanel
 * Consumes: prisma.ts, regime-detector.ts (READ ONLY)
 * Risk-sensitive: NO — read-only regime assessment
 * Last modified: 2026-03-07
 * Notes: GET returns TDA regime state derived from RegimeHistory stability.
 *        TDA is a topological approximation — no dedicated computation engine.
 *        Uses regime consecutive-day count as a proxy for topological stability.
 *        No POST endpoint — state is derived, not computed on-demand.
 */

import { NextResponse } from 'next/server';
import { apiError } from '@/lib/api-response';
import { prisma } from '@/lib/prisma';

export const dynamic = 'force-dynamic';

/**
 * Derive TDA regime state from RegimeHistory stability data.
 * Maps regime consecutive days to topological stability:
 *   ≥5 consecutive days same regime → STABLE
 *   2–4 consecutive days → TRANSITIONING
 *   <2 consecutive days → TURBULENT
 * Transition warning fires when primary regime is BULLISH but stability < 3 days.
 */
export async function GET() {
  try {
    const latest = await prisma.regimeHistory.findFirst({
      orderBy: { date: 'desc' },
      select: { regime: true, consecutive: true, date: true },
    });

    if (!latest) {
      return NextResponse.json({
        ok: true,
        data: {
          state: 'STABLE' as const,
          transitionWarning: false,
          primaryRegime: 'NEUTRAL',
          consecutiveDays: 0,
          computedAt: null,
        },
      });
    }

    const consecutive = latest.consecutive ?? 1;

    // Map stability to TDA state
    let state: 'STABLE' | 'TRANSITIONING' | 'TURBULENT';
    if (consecutive >= 5) {
      state = 'STABLE';
    } else if (consecutive >= 2) {
      state = 'TRANSITIONING';
    } else {
      state = 'TURBULENT';
    }

    // Transition warning: regime looks bullish but not yet stable (< 3 days)
    const transitionWarning = latest.regime === 'BULLISH' && consecutive < 3;

    return NextResponse.json({
      ok: true,
      data: {
        state,
        transitionWarning,
        primaryRegime: latest.regime,
        consecutiveDays: consecutive,
        computedAt: latest.date.toISOString(),
      },
    });
  } catch (error) {
    return apiError(500, 'TDA_REGIME_FAILED', 'Failed to assess TDA regime', (error as Error).message);
  }
}
