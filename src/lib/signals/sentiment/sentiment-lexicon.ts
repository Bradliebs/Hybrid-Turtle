/**
 * DEPENDENCIES
 * Consumed by: news-sentiment.ts
 * Consumes: (standalone — constants only)
 * Risk-sensitive: NO
 * Last modified: 2026-03-07
 * Notes: Subset of the Loughran-McDonald financial sentiment word list.
 *        Public domain academic resource for financial text analysis.
 *        Focused on words relevant to momentum breakout trading context.
 */

/** Positive financial words — presence suggests optimism */
export const POSITIVE_WORDS = new Set([
  'upgrade', 'upgrades', 'upgraded', 'beat', 'beats', 'beating',
  'exceed', 'exceeds', 'exceeded', 'exceeding', 'outperform',
  'strong', 'stronger', 'strongest', 'surge', 'surges', 'surging',
  'rally', 'rallies', 'rallying', 'gain', 'gains', 'gained',
  'growth', 'growing', 'grew', 'profit', 'profitable', 'profitability',
  'boost', 'boosts', 'boosted', 'boosting', 'improve', 'improved',
  'breakthrough', 'record', 'high', 'highs', 'bullish',
  'optimistic', 'optimism', 'confidence', 'confident',
  'momentum', 'accelerate', 'accelerating', 'expansion',
  'dividend', 'buyback', 'acquisition', 'partnership',
  'innovation', 'launch', 'launched', 'approval', 'approved',
  'upside', 'positive', 'rebound', 'recovery', 'recovering',
  'opportunity', 'promising', 'robust', 'solid', 'resilient',
]);

/** Negative financial words — presence suggests pessimism */
export const NEGATIVE_WORDS = new Set([
  'downgrade', 'downgrades', 'downgraded', 'miss', 'misses', 'missed',
  'below', 'decline', 'declines', 'declined', 'declining',
  'weak', 'weaker', 'weakest', 'weakness', 'drop', 'drops', 'dropped',
  'fall', 'falls', 'falling', 'fell', 'loss', 'losses', 'lost',
  'cut', 'cuts', 'cutting', 'slash', 'slashed', 'reduce', 'reduced',
  'risk', 'risks', 'risky', 'concern', 'concerns', 'worried',
  'bearish', 'pessimistic', 'pessimism', 'warning', 'warns', 'warned',
  'disappointing', 'disappointed', 'disappointment',
  'lawsuit', 'investigation', 'probe', 'fraud', 'scandal',
  'bankruptcy', 'default', 'layoffs', 'restructuring',
  'recession', 'downturn', 'slowdown', 'slowing',
  'sell', 'selling', 'selloff', 'crash', 'plunge', 'plunges',
  'volatile', 'volatility', 'uncertainty', 'headwind', 'headwinds',
  'overvalued', 'bubble', 'correction', 'downside', 'negative',
]);

/**
 * Score a text string using the Loughran-McDonald word list.
 * Returns a score in roughly [-1, 1] range.
 * Positive = optimistic, Negative = pessimistic, 0 = neutral.
 */
export function scoreSentiment(text: string): number {
  const words = text.toLowerCase().replace(/[^a-z\s]/g, '').split(/\s+/);
  let positive = 0;
  let negative = 0;
  let total = 0;

  for (const word of words) {
    if (word.length < 3) continue;
    total++;
    if (POSITIVE_WORDS.has(word)) positive++;
    if (NEGATIVE_WORDS.has(word)) negative++;
  }

  if (total === 0) return 0;
  const financialWords = positive + negative;
  if (financialWords === 0) return 0;

  return (positive - negative) / financialWords;
}
