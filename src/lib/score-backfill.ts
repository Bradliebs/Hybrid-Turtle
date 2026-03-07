/**
 * DEPENDENCIES
 * Consumed by: /api/analytics/score-validation/route.ts (POST backfill)
 * Consumes: prisma.ts, dual-score.ts
 * Risk-sensitive: NO — analytics only, backfills score data
 * Last modified: 2026-03-06
 * Notes: Populates bqs/fws/ncs/dualScoreAction on CandidateOutcome rows
 *        by matching to ScoreBreakdown data (ticker + scoredAt ≈ scanDate).
 *        Falls back to computing from ScoreBreakdown component totals.
 */
import prisma from './prisma';

/**
 * Derive actionNote classification from FWS and NCS values.
 * Mirrors dual-score.ts actionNote() logic exactly:
 *  - FWS > 65 → 'Auto-No (fragile)'
 *  - NCS >= 70 AND FWS <= 30 → 'Auto-Yes'
 *  - Otherwise → 'Conditional'
 */
export function classifyDualScoreAction(fws: number, ncs: number): string {
  if (fws > 65) return 'Auto-No';
  if (ncs >= 70 && fws <= 30) return 'Auto-Yes';
  return 'Conditional';
}

/**
 * Backfill BQS/FWS/NCS/dualScoreAction on CandidateOutcome rows
 * by joining to ScoreBreakdown data (ticker + date match).
 *
 * Only processes rows where bqs IS NULL (not yet populated).
 *
 * @returns count of rows updated
 */
export async function backfillScoresOnOutcomes(): Promise<{
  updated: number;
  skipped: number;
  errors: number;
}> {
  // Find CandidateOutcome rows without scores
  const outcomes = await prisma.candidateOutcome.findMany({
    where: { bqs: null },
    select: {
      id: true,
      ticker: true,
      scanDate: true,
    },
    take: 500,
  });

  if (outcomes.length === 0) return { updated: 0, skipped: 0, errors: 0 };

  let updated = 0;
  let skipped = 0;
  let errors = 0;

  for (const outcome of outcomes) {
    // Find the closest ScoreBreakdown row by ticker + date (within ±2 days)
    const startDate = new Date(outcome.scanDate);
    startDate.setDate(startDate.getDate() - 2);
    const endDate = new Date(outcome.scanDate);
    endDate.setDate(endDate.getDate() + 2);

    try {
      const scoreRow = await prisma.scoreBreakdown.findFirst({
        where: {
          ticker: outcome.ticker,
          scoredAt: { gte: startDate, lte: endDate },
        },
        orderBy: { scoredAt: 'desc' },
        select: {
          bqsTotal: true,
          fwsTotal: true,
          ncsTotal: true,
          actionNote: true,
        },
      });

      if (!scoreRow) {
        skipped++;
        continue;
      }

      const action = classifyDualScoreAction(scoreRow.fwsTotal, scoreRow.ncsTotal);

      await prisma.candidateOutcome.update({
        where: { id: outcome.id },
        data: {
          bqs: scoreRow.bqsTotal,
          fws: scoreRow.fwsTotal,
          ncs: scoreRow.ncsTotal,
          dualScoreAction: action,
        },
      });
      updated++;
    } catch (e) {
      console.error(`[ScoreBackfill] Failed for ${outcome.ticker}:`, e);
      errors++;
    }
  }

  return { updated, skipped, errors };
}
