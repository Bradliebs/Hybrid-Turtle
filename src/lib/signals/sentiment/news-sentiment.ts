/**
 * DEPENDENCIES
 * Consumed by: sentiment-fusion.ts
 * Consumes: sentiment-lexicon.ts
 * Risk-sensitive: NO — signal computation only
 * Last modified: 2026-03-07
 * Notes: Fetches Yahoo Finance RSS headlines for a ticker and scores them
 *        using the Loughran-McDonald financial sentiment lexicon.
 *        Returns average sentiment over recent headlines.
 *        ⛔ Does NOT modify sacred files.
 */

import { scoreSentiment } from './sentiment-lexicon';

// ── Types ────────────────────────────────────────────────────

export interface NewsSentimentResult {
  ticker: string;
  /** Average sentiment score across headlines (-1 to +1) */
  averageScore: number;
  /** Normalised to 0–100 for fusion (50 = neutral) */
  normalisedScore: number;
  /** Number of headlines analysed */
  headlineCount: number;
  /** Top positive headline (if any) */
  topPositive?: string;
  /** Top negative headline (if any) */
  topNegative?: string;
}

// ── RSS Fetch ────────────────────────────────────────────────

/**
 * Fetch headlines from Yahoo Finance RSS.
 * Falls back gracefully if RSS is unavailable.
 */
async function fetchYahooHeadlines(ticker: string): Promise<string[]> {
  try {
    const url = `https://feeds.finance.yahoo.com/rss/2.0/headline?s=${encodeURIComponent(ticker)}&region=US&lang=en-US`;
    const response = await fetch(url, {
      headers: { 'User-Agent': 'HybridTurtle/1.0' },
      signal: AbortSignal.timeout(10000),
    });

    if (!response.ok) return [];

    const text = await response.text();

    // Parse RSS XML — extract <title> elements (simple regex, no XML parser needed)
    const titles: string[] = [];
    const titleRegex = /<title><!\[CDATA\[(.*?)\]\]><\/title>|<title>(.*?)<\/title>/g;
    let match;
    while ((match = titleRegex.exec(text)) !== null) {
      const title = match[1] || match[2];
      if (title && !title.includes('Yahoo Finance') && title.length > 10) {
        titles.push(title);
      }
    }

    return titles.slice(0, 20); // max 20 headlines
  } catch {
    return [];
  }
}

// ── Main ─────────────────────────────────────────────────────

/**
 * Compute news sentiment for a ticker from Yahoo Finance RSS headlines.
 */
export async function computeNewsSentiment(ticker: string): Promise<NewsSentimentResult> {
  const headlines = await fetchYahooHeadlines(ticker);

  if (headlines.length === 0) {
    return {
      ticker,
      averageScore: 0,
      normalisedScore: 50,
      headlineCount: 0,
    };
  }

  const scored = headlines.map(h => ({ headline: h, score: scoreSentiment(h) }));
  const avgScore = scored.reduce((s, h) => s + h.score, 0) / scored.length;

  // Find top positive and negative headlines
  const sorted = [...scored].sort((a, b) => b.score - a.score);
  const topPositive = sorted.find(s => s.score > 0);
  const topNegative = [...sorted].reverse().find(s => s.score < 0);

  // Normalise to 0–100 (50 = neutral)
  const normalised = Math.max(0, Math.min(100, 50 + avgScore * 50));

  return {
    ticker,
    averageScore: Math.round(avgScore * 1000) / 1000,
    normalisedScore: Math.round(normalised),
    headlineCount: headlines.length,
    topPositive: topPositive?.headline,
    topNegative: topNegative?.headline,
  };
}
