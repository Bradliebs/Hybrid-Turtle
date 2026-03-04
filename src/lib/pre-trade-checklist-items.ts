/**
 * DEPENDENCIES
 * Consumed by: PreTradeChecklist.tsx (/plan), BuyConfirmationModal.tsx (/portfolio)
 * Consumes: (pure data — no imports)
 * Risk-sensitive: NO (display constants only)
 * Last modified: 2026-03-03
 * Notes: Single source of truth for pre-trade checklist items.
 *        Auto-verified items (REGIME, RISK) are system-checked at runtime.
 *        Manual items (SETUP, EXECUTION) require human confirmation per trade.
 */

// ── Types ──

export type ChecklistCategory = 'REGIME' | 'RISK' | 'SETUP' | 'EXECUTION';

export interface ChecklistItem {
  id: string;
  label: string;
  description?: string;
  category: ChecklistCategory;
}

// ── Category display metadata ──

export const CATEGORY_LABELS: Record<ChecklistCategory, string> = {
  REGIME: 'Market Conditions',
  RISK: 'Risk Gate',
  SETUP: 'System Health',
  EXECUTION: 'Entry Rules',
};

// ── Checklist items ──
// Items are grouped by category and presented in this order.
// Categories REGIME and RISK are auto-verified by the system in the buy modal.
// Categories SETUP and EXECUTION require manual user confirmation.

export const PRE_TRADE_CHECKLIST_ITEMS: ChecklistItem[] = [
  // ── REGIME: Auto-verified by system ──
  {
    id: 'regime-bullish',
    label: 'Market regime is not BEARISH',
    description: 'Dual benchmark (SPY + VWRL) regime must not be BEARISH to enter new positions',
    category: 'REGIME',
  },
  {
    id: 'fear-greed-ok',
    label: 'Fear & Greed not in Extreme Fear',
    description: 'CNN Fear & Greed index — extreme fear often signals capitulation, not entry',
    category: 'REGIME',
  },
  {
    id: 'spy-above-ma200',
    label: 'S&P above 200-day MA',
    description: 'Broad market health check — SPY should be above its 200-day moving average',
    category: 'REGIME',
  },

  // ── RISK: Auto-verified by system ──
  {
    id: 'risk-gates-pass',
    label: 'All 6 risk gates pass for this trade',
    description: 'Total risk, position count, sleeve cap, cluster cap, sector cap, position size cap',
    category: 'RISK',
  },
  {
    id: 'open-risk-ok',
    label: 'Total open risk within limit',
    description: 'Current open risk + new trade risk must be within profile max',
    category: 'RISK',
  },
  {
    id: 'position-count-ok',
    label: 'Position count below maximum',
    description: 'Open positions must be fewer than profile limit (SMALL_ACCOUNT: 4)',
    category: 'RISK',
  },
  {
    id: 'sleeve-caps-ok',
    label: 'Sleeve caps not breached',
    description: 'CORE ≤ 80%, HIGH_RISK ≤ 40% of portfolio',
    category: 'RISK',
  },

  // ── SETUP: Manual confirmation ──
  {
    id: 'health-green',
    label: 'Health check is GREEN',
    description: 'The 16-point health audit should show no RED items',
    category: 'SETUP',
  },
  {
    id: 'data-fresh',
    label: 'Data is fresh (nightly ran < 24h ago)',
    description: 'Stale data means prices, stops, and indicators may be wrong',
    category: 'SETUP',
  },

  // ── EXECUTION: Manual confirmation ──
  {
    id: 'candidate-passed-filters',
    label: 'Candidate passed all scan filters',
    description: 'Price > MA200, ADX ≥ 20, +DI > −DI, ATR% cap, data quality',
    category: 'EXECUTION',
  },
  {
    id: 'entry-trigger-correct',
    label: 'Entry trigger uses 20-day high + ATR buffer',
    description: 'Do not chase — only enter at the calculated trigger level',
    category: 'EXECUTION',
  },
  {
    id: 'stop-pre-set',
    label: 'Stop-loss is pre-set before entry',
    description: 'Never enter without a calculated stop — stops protect capital',
    category: 'EXECUTION',
  },
  {
    id: 'sizing-formula',
    label: 'Position sized by formula: Shares = (Eq × R%) / (E − S)',
    description: 'Risk-based sizing ensures consistent exposure — never size by feel',
    category: 'EXECUTION',
  },
  {
    id: 'shares-rounded-down',
    label: 'Shares rounded DOWN (never up)',
    description: 'floorShares() — integer brokers floor to whole shares, T212 to 0.01',
    category: 'EXECUTION',
  },
];

// ── Helpers ──

/** Items the user must manually check before each trade */
export const MANUAL_CHECKLIST_ITEMS = PRE_TRADE_CHECKLIST_ITEMS.filter(
  (item) => item.category === 'SETUP' || item.category === 'EXECUTION'
);

/** Items auto-verified by the system (regime + risk gates) */
export const AUTO_CHECKLIST_ITEMS = PRE_TRADE_CHECKLIST_ITEMS.filter(
  (item) => item.category === 'REGIME' || item.category === 'RISK'
);
