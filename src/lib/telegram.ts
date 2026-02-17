// ============================================================
// Telegram Bot Integration
// ============================================================

const BOT_TOKEN = process.env.TELEGRAM_BOT_TOKEN;
const CHAT_ID = process.env.TELEGRAM_CHAT_ID;

interface TelegramMessage {
  text: string;
  parseMode?: 'HTML' | 'Markdown' | 'MarkdownV2';
}

/**
 * Escape HTML special characters for Telegram parse_mode=HTML
 */
function escapeHtml(text: string): string {
  return text
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;');
}

/**
 * Send a message via Telegram Bot API.
 * Automatically splits messages longer than 4096 characters.
 */
export async function sendTelegramMessage(message: TelegramMessage): Promise<boolean> {
  if (!BOT_TOKEN || !CHAT_ID) {
    console.warn('Telegram credentials not configured');
    return false;
  }

  const MAX_LEN = 4096;
  const chunks: string[] = [];

  if (message.text.length <= MAX_LEN) {
    chunks.push(message.text);
  } else {
    // Split on newline boundaries to avoid breaking HTML tags
    let remaining = message.text;
    while (remaining.length > 0) {
      if (remaining.length <= MAX_LEN) {
        chunks.push(remaining);
        break;
      }
      // Find last newline within limit
      let splitIdx = remaining.lastIndexOf('\n', MAX_LEN);
      if (splitIdx <= 0) splitIdx = MAX_LEN; // fallback: hard split
      chunks.push(remaining.slice(0, splitIdx));
      remaining = remaining.slice(splitIdx + 1);
    }
  }

  try {
    for (const chunk of chunks) {
      const response = await fetch(
        `https://api.telegram.org/bot${BOT_TOKEN}/sendMessage`,
        {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            chat_id: CHAT_ID,
            text: chunk,
            parse_mode: message.parseMode || 'HTML',
            disable_web_page_preview: true,
          }),
        }
      );

      if (!response.ok) {
        const error = await response.json();
        console.error('Telegram API error:', error);
        return false;
      }
    }

    return true;
  } catch (error) {
    console.error('Failed to send Telegram message:', error);
    return false;
  }
}

/**
 * Position detail for the nightly Telegram message
 */
export interface NightlyPositionDetail {
  ticker: string;
  sleeve: string;
  shares: number;
  entryPrice: number;
  currentPrice: number;
  currentStop: number;
  protectionLevel: string;
  rMultiple: number;
  pnl: number;
  pnlPercent: number;
  currency: string;
}

/**
 * Stop change detail for the nightly Telegram message
 */
export interface NightlyStopChange {
  ticker: string;
  oldStop: number;
  newStop: number;
  level: string;
  reason: string;
  currency: string;
}

/**
 * Laggard / dead-money alert for the nightly Telegram message
 */
export interface NightlyLaggardAlert {
  ticker: string;
  daysHeld: number;
  rMultiple: number;
  lossPct: number;
  flag: 'TRIM_LAGGARD' | 'DEAD_MONEY';
  reason: string;
  currency: string;
}

/**
 * Climax top signal for the nightly Telegram message
 */
export interface NightlyClimaxAlert {
  ticker: string;
  priceAboveMa20Pct: number;
  volumeRatio: number;
  action: 'TRIM' | 'TIGHTEN' | 'NONE';
  reason: string;
}

/**
 * Swap suggestion for the nightly Telegram message
 */
export interface NightlySwapAlert {
  cluster: string;
  weakTicker: string;
  weakRMultiple: number;
  strongTicker: string;
  reason: string;
}

/**
 * Whipsaw block for the nightly Telegram message
 */
export interface NightlyWhipsawAlert {
  ticker: string;
  stopsInLast30Days: number;
  reason: string;
}

/**
 * Breadth safety for the nightly Telegram message
 */
export interface NightlyBreadthAlert {
  breadthPct: number;
  isRestricted: boolean;
  maxPositionsOverride: number | null;
  reason: string;
}

/**
 * Momentum expansion for the nightly Telegram message
 */
export interface NightlyMomentumAlert {
  adx: number;
  isExpanded: boolean;
  expandedMaxRisk: number | null;
  reason: string;
}

/**
 * Ready-to-buy candidate for the nightly Telegram message
 */
export interface NightlyReadyCandidate {
  ticker: string;
  name: string;
  sleeve: string;
  close: number;
  entryTrigger: number;
  stopLevel: number;
  distancePct: number;
  atr14: number;
  adx14: number;
  currency: string;
}

/**
 * Trigger-met candidate — price has crossed above entry trigger
 */
export interface NightlyTriggerMetCandidate {
  ticker: string;
  name: string;
  sleeve: string;
  close: number;
  entryTrigger: number;
  stopLevel: number;
  distancePct: number;
  atr14: number;
  adx14: number;
  currency: string;
}

/**
 * Pyramid add alert for the nightly Telegram message
 */
export interface NightlyPyramidAlert {
  ticker: string;
  entryPrice: number;
  currentPrice: number;
  rMultiple: number;
  addNumber: number;
  triggerPrice: number | null;
  message: string;
  currency: string;
}

/**
 * Send nightly summary via Telegram
 */
export async function sendNightlySummary(summary: {
  date: string;
  healthStatus: string;
  regime: string;
  openPositions: number;
  stopsUpdated: number;
  readyCandidates: number;
  alerts: string[];
  portfolioValue: number;
  dailyChange: number;
  dailyChangePercent: number;
  equity: number;
  openRiskPercent: number;
  positions: NightlyPositionDetail[];
  stopChanges: NightlyStopChange[];
  trailingStopChanges: NightlyStopChange[];
  snapshotSynced: number;
  snapshotFailed: number;
  readyToBuy: NightlyReadyCandidate[];
  triggerMet?: NightlyTriggerMetCandidate[];
  pyramidAlerts?: NightlyPyramidAlert[];
  laggards?: NightlyLaggardAlert[];
  climaxAlerts?: NightlyClimaxAlert[];
  swapAlerts?: NightlySwapAlert[];
  whipsawAlerts?: NightlyWhipsawAlert[];
  breadthAlert?: NightlyBreadthAlert;
  momentumAlert?: NightlyMomentumAlert;
}): Promise<boolean> {
  const healthEmoji = summary.healthStatus === 'GREEN' ? '🟢'
    : summary.healthStatus === 'YELLOW' ? '🟡' : '🔴';

  // ── Position lines ──
  const positionLines = summary.positions.length > 0
    ? summary.positions.map((p) => {
        const pnlEmoji = p.pnl >= 0 ? '🟩' : '🟥';
        const sym = currencySymbol(p.currency);
        const rLabel = p.rMultiple >= 0 ? `+${p.rMultiple.toFixed(1)}R` : `${p.rMultiple.toFixed(1)}R`;
        return `  ${pnlEmoji} <b>${p.ticker}</b>  ${sym}${p.currentPrice.toFixed(2)}  ${rLabel}  ${p.pnl >= 0 ? '+' : ''}${p.pnlPercent.toFixed(1)}%  Stop: ${sym}${p.currentStop.toFixed(2)} [${p.protectionLevel}]`;
      }).join('\n')
    : '  No open positions';

  // ── Stop change lines ──
  const allStopChanges = [...summary.stopChanges, ...summary.trailingStopChanges];
  const stopLines = allStopChanges.length > 0
    ? allStopChanges.map((s) => {
        const sym = currencySymbol(s.currency);
        return `  🔄 <b>${escapeHtml(s.ticker)}</b>  ${sym}${s.oldStop.toFixed(2)} → ${sym}${s.newStop.toFixed(2)}  [${escapeHtml(s.level)}]\n       <i>${escapeHtml(s.reason)}</i>`;
      }).join('\n')
    : '  ✅ No stop changes';

  // ── Alerts ──
  const alertsText = summary.alerts.length > 0
    ? summary.alerts.map((a) => `  ⚠️ ${a}`).join('\n')
    : '  ✅ No alerts';

  // ── Ready to buy lines (only trigger-met candidates) ──
  const readyToBuyAtEntry = summary.readyToBuy
    .filter((r) => r.entryTrigger > 0 && r.close >= r.entryTrigger);
  const readyLines = readyToBuyAtEntry.length > 0
    ? readyToBuyAtEntry.map((r) => {
        const sym = currencySymbol(r.currency);
        return `  🎯 <b>${r.ticker}</b> (${r.sleeve})  ${sym}${r.close.toFixed(2)}
       Entry: ${sym}${r.entryTrigger.toFixed(2)}  Stop: ${sym}${r.stopLevel.toFixed(2)}  Dist: ${r.distancePct.toFixed(1)}%  ADX: ${r.adx14.toFixed(0)}`;
      }).join('\n')
    : '  No candidates at entry';

  // ══ TRIGGER MET lines (price crossed above entry trigger) ══
  const triggerMetList = summary.triggerMet || [];
  const triggerMetLines = triggerMetList.length > 0
    ? triggerMetList.map((t) => {
        const sym = currencySymbol(t.currency);
        return `  🚨 <b>${t.ticker}</b> (${t.sleeve})  ${sym}${t.close.toFixed(2)} ≥ trigger ${sym}${t.entryTrigger.toFixed(2)}
       Stop: ${sym}${t.stopLevel.toFixed(2)}  ADX: ${t.adx14.toFixed(0)}  → CONFIRM VOLUME & BUY`;
      }).join('\n')
    : '';

  // ── Pyramid add lines ──
  const pyramidList = summary.pyramidAlerts || [];
  const pyramidLines = pyramidList.length > 0
    ? pyramidList.map((p) => {
        const sym = currencySymbol(p.currency);
        return `  📐 <b>${p.ticker}</b>  Add #${p.addNumber}  ${sym}${p.currentPrice.toFixed(2)} ≥ trigger ${p.triggerPrice ? sym + p.triggerPrice.toFixed(2) : 'R-based'}  (${p.rMultiple >= 0 ? '+' : ''}${p.rMultiple.toFixed(1)}R)`;
      }).join('\n')
    : '';

  // ── Climax / Whipsaw / Swap / Breadth / Momentum lines ──
  const climaxList = summary.climaxAlerts || [];
  const climaxLines = climaxList.length > 0
    ? climaxList.map((c) => {
        return `  🔥 <b>${c.ticker}</b>  +${c.priceAboveMa20Pct.toFixed(1)}% above MA20  Vol ${c.volumeRatio.toFixed(1)}×  → ${c.action}`;
      }).join('\n')
    : '';

  const swapList = summary.swapAlerts || [];
  const swapLines = swapList.length > 0
    ? swapList.map((s) => {
        return `  🔄 <b>${escapeHtml(s.weakTicker)}</b> (${s.weakRMultiple.toFixed(1)}R) → <b>${escapeHtml(s.strongTicker)}</b> in ${escapeHtml(s.cluster)}`;
      }).join('\n')
    : '';

  const whipsawList = summary.whipsawAlerts || [];
  const whipsawLines = whipsawList.length > 0
    ? whipsawList.map((w) => {
        return `  🚫 <b>${w.ticker}</b>  ${w.stopsInLast30Days}× stopped out — re-entry blocked`;
      }).join('\n')
    : '';

  const breadth = summary.breadthAlert;
  const breadthLine = breadth
    ? breadth.isRestricted
      ? `  🔻 Breadth: ${breadth.breadthPct.toFixed(0)}% (< 40%) — max positions reduced to ${breadth.maxPositionsOverride}`
      : `  ✅ Breadth: ${breadth.breadthPct.toFixed(0)}% — normal limits`
    : '';

  const momentum = summary.momentumAlert;
  const momentumLine = momentum
    ? momentum.isExpanded
      ? `  🚀 Momentum: ADX ${momentum.adx.toFixed(1)} > 25 — risk cap expanded to ${momentum.expandedMaxRisk?.toFixed(1)}%`
      : `  📊 Momentum: ADX ${momentum.adx.toFixed(1)} — standard risk limits`
    : '';

  // ── Laggard / Dead Money lines ──
  const laggardList = summary.laggards || [];
  const laggardLines = laggardList.length > 0
    ? laggardList.map((l) => {
        const emoji = l.flag === 'DEAD_MONEY' ? '💤' : '🐌';
        const rLabel = l.rMultiple >= 0 ? `+${l.rMultiple.toFixed(1)}R` : `${l.rMultiple.toFixed(1)}R`;
        return `  ${emoji} <b>${escapeHtml(l.ticker)}</b>  ${l.daysHeld}d held  ${rLabel}  ${l.lossPct > 0 ? `-${l.lossPct.toFixed(1)}%` : 'flat'}
       <i>${escapeHtml(l.reason)}</i>`;
      }).join('\n')
    : '';

  // ── Total unrealised P&L ──
  const totalPnl = summary.positions.reduce((sum, p) => sum + p.pnl, 0);
  const totalPnlPercent = summary.equity > 0 ? (totalPnl / summary.equity) * 100 : 0;
  const totalPnlEmoji = totalPnl >= 0 ? '📗' : '📕';

  const text = `
<b>🐢 HybridTurtle Nightly Report</b>
<b>Date:</b> ${summary.date}

${healthEmoji} <b>Health:</b> ${summary.healthStatus}

<b>━━━ Portfolio ━━━</b>
  💰 Equity: £${summary.equity.toFixed(2)}
  ${totalPnlEmoji} Unrealised P&L: ${totalPnl >= 0 ? '+' : ''}£${totalPnl.toFixed(2)} (${totalPnlPercent >= 0 ? '+' : ''}${totalPnlPercent.toFixed(1)}%)
  ⚡ Open Risk: ${summary.openRiskPercent.toFixed(1)}% of equity

<b>━━━ Positions (${summary.openPositions}) ━━━</b>
${positionLines}

<b>━━━ Stop Changes (${allStopChanges.length}) ━━━</b>
${stopLines}

<b>━━━ At Entry (${readyToBuyAtEntry.length}) ━━━</b>
${readyLines}

${triggerMetList.length > 0 ? `<b>━━━ 🚨 TRIGGER MET (${triggerMetList.length}) ━━━</b>
${triggerMetLines}

` : ''}${pyramidList.length > 0 ? `<b>━━━ Pyramid Adds (${pyramidList.length}) ━━━</b>
${pyramidLines}

` : ''}${climaxList.length > 0 ? `<b>━━━ Climax Signals (${climaxList.length}) ━━━</b>
${climaxLines}

` : ''}${swapList.length > 0 ? `<b>━━━ Swap Suggestions (${swapList.length}) ━━━</b>
${swapLines}

` : ''}${whipsawList.length > 0 ? `<b>━━━ Whipsaw Blocks (${whipsawList.length}) ━━━</b>
${whipsawLines}

` : ''}${laggardList.length > 0 ? `<b>━━━ Laggards / Dead Money (${laggardList.length}) ━━━</b>
${laggardLines}

` : ''}<b>━━━ Market Conditions ━━━</b>
${breadthLine ? breadthLine + '\n' : ''}${momentumLine ? momentumLine + '\n' : ''}
<b>━━━ Sync ━━━</b>
  📊 Snapshot: ${summary.snapshotSynced} synced${summary.snapshotFailed > 0 ? `, ${summary.snapshotFailed} failed` : ''}

<b>━━━ Alerts ━━━</b>
${alertsText}
`.trim();

  return sendTelegramMessage({ text });
}

function currencySymbol(currency: string): string {
  switch (currency.toUpperCase()) {
    case 'GBP': case 'GBX': return '£';
    case 'EUR': return '€';
    default: return '$';
  }
}

/**
 * Test Telegram connection
 */
export async function testTelegramConnection(): Promise<{
  success: boolean;
  botName?: string;
  error?: string;
}> {
  if (!BOT_TOKEN) {
    return { success: false, error: 'Bot token not configured' };
  }

  try {
    const response = await fetch(
      `https://api.telegram.org/bot${BOT_TOKEN}/getMe`
    );

    if (!response.ok) {
      return { success: false, error: 'Invalid bot token' };
    }

    const data = await response.json();
    return {
      success: true,
      botName: data.result?.first_name || 'Unknown',
    };
  } catch (error) {
    return { success: false, error: 'Network error' };
  }
}
