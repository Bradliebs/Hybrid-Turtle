/**
 * DEPENDENCIES
 * Consumed by: GlossaryTerm.tsx
 * Consumes: nothing
 * Risk-sensitive: NO
 * Last modified: 2026-03-01
 * Notes: Plain English definitions — no jargon. Max 2 sentences each.
 */

export const GLOSSARY: Record<string, string> = {
  ATR: 'Average True Range — measures how much a stock\'s price typically moves in a day. Higher ATR means more volatile price swings.',
  ADX: 'Average Directional Index — measures trend strength on a scale of 0–100. Above 20 means a meaningful trend is present.',
  BQS: 'Breakout Quality Score (0–100) — rates how strong a potential breakout setup is. Higher is better.',
  FWS: 'Fatal Weakness Score (0–95) — flags hidden risks in a setup. Higher is worse — scores above 65 block the trade automatically.',
  NCS: 'Net Composite Score — combines BQS and FWS into one number. Above 70 with low FWS means the system says "go".',
  Hurst: 'Hurst Exponent — measures whether price movements tend to continue (trending) or reverse. Above 0.5 favours momentum strategies.',
  'R-Multiple': 'How many times your initial risk you\'ve gained or lost. 2R means you made twice what you risked; −1R means you lost your full risk amount.',
  Regime: 'The overall market environment — Bullish (uptrend), Bearish (downtrend), or Sideways (choppy). The system only buys in Bullish regimes.',
  Donchian: 'Donchian Channel — draws lines at the highest high and lowest low over a set number of days. A breakout above the channel signals a potential buy.',
  'Stop-loss': 'A pre-set price where you exit a losing trade to limit damage. In this system, stops only move up, never down.',
  Sleeve: 'A category grouping for positions — CORE (large stable stocks), HIGH_RISK (smaller or volatile stocks), or HEDGE (market protection).',
  MACD: 'Moving Average Convergence Divergence — shows when short-term momentum is shifting. Useful for confirming trend direction.',
  'Pyramid add': 'Adding more shares to a winning position at a higher price. Only done when the trade is already profitable and the trend is strong.',
  BPS: 'Breakout Probability Score (0–19) — rates how likely a breakout is to succeed based on 7 factors like volume, consolidation, and relative strength.',
  DRS: 'Dynamic Risk Scaling — adjusts position size based on recent win/loss streaks and current market conditions.',
};
