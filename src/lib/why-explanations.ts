/**
 * DEPENDENCIES
 * Consumed by: WhyCardPopover.tsx (shared component)
 * Consumes: (pure data — no imports)
 * Risk-sensitive: NO (display constants only)
 * Last modified: 2026-03-03
 * Notes: All explanation text for Why Cards lives here.
 *        Never hardcode explanation text inside a component.
 */

// ── Scan Status Explanations ──

export interface ScanStatusExplanation {
  title: string;
  description: string;
  tip: string;
}

export const SCAN_STATUS_EXPLANATIONS: Record<string, ScanStatusExplanation> = {
  READY: {
    title: 'Ready to Trade',
    description: 'Close ≤ 2% from entry trigger. All technical filters pass.',
    tip: 'This candidate is near its breakout level — monitor for trigger.',
  },
  WATCH: {
    title: 'On Watch',
    description: 'Close is 2–3% from entry trigger, or efficiency < 30.',
    tip: 'Not yet actionable. Wait for price to approach the trigger level.',
  },
  WAIT_PULLBACK: {
    title: 'Wait for Pullback',
    description: 'Price has moved past the trigger but may be extended.',
    tip: 'If the gap is ≤ 1 ATR, a pullback to the entry zone could offer a safer entry.',
  },
  FAR: {
    title: 'Too Far',
    description: 'Close is > 3% from entry trigger.',
    tip: 'Not actionable yet — too far from a valid entry point.',
  },
};

// ── Filter Explanations ──

export interface FilterExplanation {
  label: string;
  description: string;
  passText: string;
  failText: string;
}

export const FILTER_EXPLANATIONS: Record<string, FilterExplanation> = {
  priceAboveMa200: {
    label: 'Price > 200-day MA',
    description: 'Primary trend filter — only buy stocks in long-term uptrends.',
    passText: 'Price is above the 200-day moving average.',
    failText: 'Price is below the 200-day MA — stock is not in an uptrend.',
  },
  adxAbove20: {
    label: 'ADX ≥ 20',
    description: 'Trend strength — ADX below 20 means the stock is range-bound.',
    passText: 'ADX confirms a trending market (≥ 20).',
    failText: 'ADX is below 20 — no strong trend present.',
  },
  plusDIAboveMinusDI: {
    label: '+DI > −DI',
    description: 'Directional dominance — bullish pressure exceeds bearish pressure.',
    passText: 'Bullish direction (+DI) dominates.',
    failText: 'Bearish direction (−DI) dominates — momentum is against the position.',
  },
  atrPercentBelow8: {
    label: 'ATR% < 8%',
    description: 'Volatility cap — extremely volatile stocks have unpredictable stops.',
    passText: 'Volatility is within acceptable limits.',
    failText: 'ATR% exceeds 8% — too volatile for systematic entry.',
  },
  efficiencyAbove30: {
    label: 'Efficiency ≥ 30',
    description: 'Price path efficiency — below 30 means price is choppy, not trending.',
    passText: 'Price movement is efficient (trending cleanly).',
    failText: 'Low efficiency — price action is choppy, placed on WATCH instead.',
  },
  dataQuality: {
    label: 'Data Quality',
    description: 'Requires a minimum of 200 candles of clean data.',
    passText: 'Sufficient data available for indicator calculation.',
    failText: 'Insufficient or corrupted data — cannot reliably compute indicators.',
  },
};

// ── Risk Gate Explanations ──

export interface RiskGateExplanation {
  description: string;
  tip: string;
}

export const RISK_GATE_EXPLANATIONS: Record<string, RiskGateExplanation> = {
  'Total Open Risk': {
    description: 'Sum of all open position risk (entry − stop × shares) as a percentage of equity.',
    tip: 'Wait for an existing position to close or move its stop to breakeven to free up risk budget.',
  },
  'Max Positions': {
    description: 'Number of non-hedge open positions vs. the profile limit.',
    tip: 'Close or let a position hit its stop before adding a new one.',
  },
  'Sleeve Limit': {
    description: 'Percentage of portfolio allocated to this sleeve (CORE, ETF, HIGH_RISK).',
    tip: 'Consider candidates from a different sleeve, or exit an existing same-sleeve position.',
  },
  'Cluster Concentration': {
    description: 'Percentage of portfolio in positions from the same industry cluster.',
    tip: 'Diversify — look for candidates in a different cluster.',
  },
  'Sector Concentration': {
    description: 'Percentage of portfolio in positions from the same sector.',
    tip: 'Diversify — look for candidates in a different sector.',
  },
  'Position Size': {
    description: 'Value of this single position as a percentage of portfolio.',
    tip: 'The position is too large — reduce shares or wait for equity to grow.',
  },
};

// ── Laggard Explanations ──

export interface LaggardExplanation {
  title: string;
  description: string;
  tip: string;
}

export const LAGGARD_EXPLANATIONS: Record<string, LaggardExplanation> = {
  TRIM_LAGGARD: {
    title: 'Underwater Position',
    description: 'This position has been held ≥ 10 days and is down ≥ 2% from entry. Capital is trapped in a losing trade that isn\'t hitting its stop.',
    tip: 'Consider trimming to free up capital for a stronger candidate. The system flagged this because the entry thesis may have failed even though the stop hasn\'t triggered.',
  },
  DEAD_MONEY: {
    title: 'Dead Money — Stalled',
    description: 'This position has been held ≥ 30 days and is below 0.5R. It\'s not losing enough to hit the stop but not gaining enough to justify the capital allocation.',
    tip: 'Capital deployed here could be working harder elsewhere. If ADX is declining and the stock is range-bound, consider exiting on a bounce.',
  },
  TRIM: {
    title: 'Consider Trimming',
    description: 'This position has been flagged for potential trimming based on poor recent performance.',
    tip: 'Review the position\'s recent price action. If the trend structure has broken down, trimming recycles capital into stronger setups.',
  },
  WATCH: {
    title: 'Stalled — Watching',
    description: 'This position isn\'t progressing. It\'s below the expected R-multiple for the time held.',
    tip: 'Keep monitoring. If ADX starts declining or the stock breaks below its 20-day MA, consider exiting.',
  },
};

// ── Anti-Chase Explanations ──

export interface AntiChaseExplanation {
  title: string;
  description: string;
}

export const ANTI_CHASE_EXPLANATIONS: AntiChaseExplanation = {
  title: 'Anti-Chase Guard (Monday Only)',
  description: 'Blocks entries on Mondays if the stock gapped > 0.75 ATR above its entry trigger or is > 3% above. This prevents chasing weekend gaps.',
};
