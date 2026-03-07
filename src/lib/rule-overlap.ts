/**
 * DEPENDENCIES
 * Consumed by: /api/analytics/rule-overlap/route.ts
 * Consumes: prisma.ts
 * Risk-sensitive: NO — read-only analytics
 * Last modified: 2026-03-06
 * Notes: Computes co-occurrence rates between filter decisions and score
 *        components. Identifies pairs with >80% correlation that may be
 *        redundant. Requires FilterAttribution data (populated by scans).
 */
import type { RuleOverlapPair } from '@/types';
import prisma from './prisma';

// The binary filter rules to compare
const FILTER_RULES = [
  'priceAboveMa200',
  'adxAbove20',
  'plusDIAboveMinusDI',
  'atrPctBelow8',
  'efficiencyAbove30',
  'dataQuality',
  'atrSpiking',
  'hurstWarn',
  'passesRiskGates',
  'passesAntiChase',
] as const;

type FilterRuleName = (typeof FILTER_RULES)[number];

/**
 * Compute rule overlap matrix from stored FilterAttribution data.
 * Returns pairs where co-occurrence > threshold (default 50%).
 */
export async function computeRuleOverlap(opts?: {
  regime?: string;
  minSampleSize?: number;
  coOccurrenceThreshold?: number;
}): Promise<RuleOverlapPair[]> {
  const minSamples = opts?.minSampleSize ?? 30;
  const threshold = opts?.coOccurrenceThreshold ?? 0.5;

  const where: Record<string, unknown> = {};
  if (opts?.regime) where.regime = opts.regime;

  const rows = await prisma.filterAttribution.findMany({
    where,
    select: {
      priceAboveMa200: true,
      adxAbove20: true,
      plusDIAboveMinusDI: true,
      atrPctBelow8: true,
      efficiencyAbove30: true,
      dataQuality: true,
      atrSpiking: true,
      hurstWarn: true,
      passesRiskGates: true,
      passesAntiChase: true,
      outcomeR: true,
    },
  });

  if (rows.length < minSamples) {
    return []; // not enough data to draw conclusions
  }

  const pairs: RuleOverlapPair[] = [];

  for (let i = 0; i < FILTER_RULES.length; i++) {
    for (let j = i + 1; j < FILTER_RULES.length; j++) {
      const ruleA = FILTER_RULES[i];
      const ruleB = FILTER_RULES[j];

      // For "negative" rules (atrSpiking, hurstWarn), invert so we're comparing
      // "blocks" consistently (true = good for most, true = bad for spiking/hurst)
      const isNegA = ruleA === 'atrSpiking' || ruleA === 'hurstWarn';
      const isNegB = ruleB === 'atrSpiking' || ruleB === 'hurstWarn';

      let bothPass = 0;
      let aOnlyPass = 0;
      let bOnlyPass = 0;
      let neitherPass = 0;

      const aOnlyOutcomes: number[] = [];
      const bOnlyOutcomes: number[] = [];
      const bothOutcomes: number[] = [];

      for (const row of rows) {
        const aVal = isNegA ? !(row[ruleA as keyof typeof row] as boolean) : (row[ruleA as keyof typeof row] as boolean);
        const bVal = isNegB ? !(row[ruleB as keyof typeof row] as boolean) : (row[ruleB as keyof typeof row] as boolean);
        const outcome = row.outcomeR;

        if (aVal && bVal) {
          bothPass++;
          if (outcome != null) bothOutcomes.push(outcome);
        } else if (aVal && !bVal) {
          aOnlyPass++;
          if (outcome != null) aOnlyOutcomes.push(outcome);
        } else if (!aVal && bVal) {
          bOnlyPass++;
          if (outcome != null) bOnlyOutcomes.push(outcome);
        } else {
          neitherPass++;
        }
      }

      const total = bothPass + aOnlyPass + bOnlyPass + neitherPass;
      if (total < minSamples) continue;

      // Co-occurrence: when A passes, how often does B also pass?
      const aTotal = bothPass + aOnlyPass;
      const coOccurrence = aTotal > 0 ? bothPass / aTotal : 0;

      if (coOccurrence < threshold) continue;

      // Redundancy: if both co-fire > threshold AND outcomes are similar,
      // one rule may be redundant
      const avg = (arr: number[]) => arr.length > 0 ? arr.reduce((a, b) => a + b, 0) / arr.length : null;
      const aAloneAvg = avg(aOnlyOutcomes);
      const bAloneAvg = avg(bOnlyOutcomes);
      const bothAvg = avg(bothOutcomes);

      // Redundancy score: high co-occurrence + similar outcome when alone vs together
      let redundancy = coOccurrence;
      if (bothAvg != null && aAloneAvg != null) {
        const outcomeDiff = Math.abs(bothAvg - aAloneAvg);
        if (outcomeDiff < 0.5) redundancy = Math.min(1, redundancy * 1.2);
        else redundancy *= 0.7;
      }

      pairs.push({
        ruleA,
        ruleB,
        coOccurrenceRate: Math.round(coOccurrence * 1000) / 1000,
        sampleSize: total,
        aAloneAvgR: aAloneAvg != null ? Math.round(aAloneAvg * 100) / 100 : null,
        bAloneAvgR: bAloneAvg != null ? Math.round(bAloneAvg * 100) / 100 : null,
        bothAvgR: bothAvg != null ? Math.round(bothAvg * 100) / 100 : null,
        redundancyScore: Math.round(redundancy * 1000) / 1000,
      });
    }
  }

  // Sort by redundancy score descending
  pairs.sort((a, b) => b.redundancyScore - a.redundancyScore);

  return pairs;
}
