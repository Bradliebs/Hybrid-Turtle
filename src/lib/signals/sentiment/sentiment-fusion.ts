/**
 * DEPENDENCIES
 * Consumed by: /api/signals/sentiment/route.ts
 * Consumes: news-sentiment.ts, analyst-revision.ts
 * Risk-sensitive: NO — signal computation only
 * Last modified: 2026-03-07
 * Notes: Combines 3 sentiment sources into a single Sentiment Composite Score (SCS).
 *        Detects sentiment-price divergence (falling sentiment + rising price = warning).
 *        ⛔ Does NOT modify sacred files.
 */

import { computeNewsSentiment, type NewsSentimentResult } from './news-sentiment';
import { computeAnalystRevisionScore, computeShortInterestSignal, type AnalystRevisionResult, type ShortInterestResult } from './analyst-revision';

// ── Types ────────────────────────────────────────────────────

export interface SentimentCompositeResult {
  ticker: string;
  /** Sentiment Composite Score (0–100, 50 = neutral) */
  scs: number;
  /** Signal classification */
  signal: 'VERY_BULLISH' | 'BULLISH' | 'NEUTRAL' | 'BEARISH' | 'VERY_BEARISH';
  /** NCS adjustment from sentiment */
  ncsAdjustment: number;
  /** Sentiment-price divergence detected */
  divergenceDetected: boolean;
  /** FM1 (breakout failure) penalty if divergence detected */
  divergencePenalty: number;
  /** Individual source breakdowns */
  sources: {
    news: NewsSentimentResult;
    revision: AnalystRevisionResult;
    shortInterest: ShortInterestResult;
  };
  computedAt: Date;
}

// ── Constants ────────────────────────────────────────────────

/** Weights for each source in the composite */
const NEWS_WEIGHT = 0.35;
const REVISION_WEIGHT = 0.40;       // analyst revisions = highest quality
const SHORT_WEIGHT = 0.25;

/** Signal classification thresholds */
const VERY_BULLISH_THRESHOLD = 70;
const BULLISH_THRESHOLD = 58;
const BEARISH_THRESHOLD = 42;
const VERY_BEARISH_THRESHOLD = 30;

/** NCS adjustment range */
const MAX_SENTIMENT_BOOST = 8;
const MAX_SENTIMENT_PENALTY = -10;

/** Divergence: sentiment < 40 while price up > 2% in 5d */
const DIVERGENCE_SENTIMENT_THRESHOLD = 40;
const DIVERGENCE_PRICE_THRESHOLD = 2;
const DIVERGENCE_FM1_PENALTY = 15;

// ── Fusion ───────────────────────────────────────────────────

/**
 * Compute the full Sentiment Composite Score for a ticker.
 * Aggregates news, analyst revisions, and short interest signals.
 */
export async function computeSentimentComposite(ticker: string): Promise<SentimentCompositeResult> {
  // Fetch all sources in parallel
  const [news, revision, shortInterest] = await Promise.all([
    computeNewsSentiment(ticker),
    computeAnalystRevisionScore(ticker),
    computeShortInterestSignal(ticker),
  ]);

  // Weighted composite (each source normalised to 0–100)
  const scs = Math.round(
    news.normalisedScore * NEWS_WEIGHT +
    revision.revisionScore * REVISION_WEIGHT +
    shortInterest.shortScore * SHORT_WEIGHT
  );

  // Signal classification
  let signal: SentimentCompositeResult['signal'];
  if (scs >= VERY_BULLISH_THRESHOLD) signal = 'VERY_BULLISH';
  else if (scs >= BULLISH_THRESHOLD) signal = 'BULLISH';
  else if (scs <= VERY_BEARISH_THRESHOLD) signal = 'VERY_BEARISH';
  else if (scs <= BEARISH_THRESHOLD) signal = 'BEARISH';
  else signal = 'NEUTRAL';

  // NCS adjustment
  let ncsAdjustment = 0;
  if (scs >= VERY_BULLISH_THRESHOLD) {
    ncsAdjustment = Math.min(MAX_SENTIMENT_BOOST, Math.round((scs - 50) * 0.3));
  } else if (scs <= VERY_BEARISH_THRESHOLD) {
    ncsAdjustment = Math.max(MAX_SENTIMENT_PENALTY, Math.round((scs - 50) * 0.4));
  } else if (scs >= BULLISH_THRESHOLD) {
    ncsAdjustment = Math.round((scs - 50) * 0.2);
  } else if (scs <= BEARISH_THRESHOLD) {
    ncsAdjustment = Math.round((scs - 50) * 0.25);
  }

  // Sentiment-price divergence detection
  // Low sentiment + rising price = false breakout warning
  const divergenceDetected =
    scs < DIVERGENCE_SENTIMENT_THRESHOLD &&
    revision.priceReturn5d > DIVERGENCE_PRICE_THRESHOLD;
  const divergencePenalty = divergenceDetected ? DIVERGENCE_FM1_PENALTY : 0;

  return {
    ticker,
    scs,
    signal,
    ncsAdjustment,
    divergenceDetected,
    divergencePenalty,
    sources: { news, revision, shortInterest },
    computedAt: new Date(),
  };
}
