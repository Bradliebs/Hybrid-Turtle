/**
 * DEPENDENCIES
 * Consumed by: /api/telegram/webhook/route.ts, /api/telegram/test-command/route.ts
 * Consumes: prisma.ts, market-data.ts, position-sizer.ts, risk-gates.ts, stop-manager.ts
 * Risk-sensitive: NO (read-only queries — never writes to DB or places orders)
 * Last modified: 2026-03-03
 * Notes: Inbound Telegram command handler. Completely separate from telegram.ts
 *        which handles outbound messages only. All responses use HTML parse mode.
 */

import prisma from '@/lib/prisma';
import { getBatchPrices, normalizeBatchPricesToGBP, getMarketRegime } from '@/lib/market-data';
import { calculateRMultiple } from '@/lib/position-sizer';
import { getRiskBudget } from '@/lib/risk-gates';
import { generateStopRecommendations, generateTrailingStopRecommendations } from '@/lib/stop-manager';
import type { RiskProfileType, Sleeve } from '@/types';

// ── Types ──

export type TelegramCommand =
  | '/status'
  | '/positions'
  | '/stopsdue'
  | '/regime'
  | '/risk'
  | '/candidates'
  | '/help'
  | 'unknown';

export interface TelegramUpdate {
  update_id: number;
  message?: {
    message_id: number;
    from: { id: number };
    chat: { id: number };
    text?: string;
    date: number;
  };
}

export interface CommandResponse {
  text: string;
  parseMode: 'HTML';
}

// ── Helpers ──

const DEFAULT_USER_ID = 'default-user';

function escapeHtml(text: string): string {
  return text
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;');
}

function currencySymbol(currency: string | null): string {
  const c = (currency ?? 'USD').toUpperCase();
  if (c === 'GBP' || c === 'GBX') return '£';
  if (c === 'EUR') return '€';
  return '$';
}

function getPhaseForDay(day: number): string {
  switch (day) {
    case 0: return 'PLANNING';
    case 1: return 'OBSERVATION';
    case 2: return 'EXECUTION';
    default: return 'MAINTENANCE';
  }
}

// ── Command parsing ──

export function parseCommand(text: string): TelegramCommand {
  const cmd = text.trim().toLowerCase().split(/\s+/)[0];
  switch (cmd) {
    case '/status': return '/status';
    case '/positions': return '/positions';
    case '/stopsdue': return '/stopsdue';
    case '/regime': return '/regime';
    case '/risk': return '/risk';
    case '/candidates': return '/candidates';
    case '/help': case '/start': return '/help';
    default: return 'unknown';
  }
}

// ── Main handler ──

export async function handleCommand(command: TelegramCommand): Promise<CommandResponse> {
  try {
    switch (command) {
      case '/status': return await cmdStatus();
      case '/positions': return await cmdPositions();
      case '/stopsdue': return await cmdStopsDue();
      case '/regime': return await cmdRegime();
      case '/risk': return await cmdRisk();
      case '/candidates': return await cmdCandidates();
      case '/help': return cmdHelp();
      case 'unknown':
      default:
        return { text: '❓ Unknown command. Send /help for available commands.', parseMode: 'HTML' };
    }
  } catch (err) {
    console.error(`[telegram-commands] Error handling ${command}:`, err);
    return {
      text: '⚠️ Internal error processing command. Check the dashboard logs.',
      parseMode: 'HTML',
    };
  }
}

// ── /status ──

async function cmdStatus(): Promise<CommandResponse> {
  const now = new Date();
  const phase = getPhaseForDay(now.getDay());

  const [heartbeat, healthCheck, regime, posCount, scanResult] = await Promise.all([
    prisma.heartbeat.findFirst({ orderBy: { timestamp: 'desc' } }),
    prisma.healthCheck.findFirst({
      where: { userId: DEFAULT_USER_ID },
      orderBy: { runDate: 'desc' },
      select: { overall: true },
    }),
    getMarketRegime().catch(() => 'SIDEWAYS' as const),
    prisma.position.count({ where: { userId: DEFAULT_USER_ID, status: 'OPEN' } }),
    prisma.scan.findFirst({
      where: { userId: DEFAULT_USER_ID },
      orderBy: { runDate: 'desc' },
      include: { results: { where: { status: 'READY' }, select: { id: true } } },
    }),
  ]);

  const healthEmoji = healthCheck?.overall === 'GREEN' ? '🟢'
    : healthCheck?.overall === 'YELLOW' ? '🟡' : '🔴';
  const heartbeatAge = heartbeat
    ? Math.round((now.getTime() - heartbeat.timestamp.getTime()) / (1000 * 60 * 60))
    : null;
  const heartbeatStr = heartbeatAge !== null
    ? `${heartbeatAge}h ago ${heartbeat?.status === 'OK' ? '✓' : '⚠️'}`
    : 'Never';

  // Quick stop count
  let stopsCount = 0;
  try {
    const positions = await prisma.position.findMany({
      where: { userId: DEFAULT_USER_ID, status: 'OPEN' },
      include: { stock: { select: { ticker: true } } },
    });
    const tickers = positions.map((p) => p.stock.ticker);
    if (tickers.length > 0) {
      const livePrices = await getBatchPrices(tickers);
      const priceMap = new Map(Object.entries(livePrices));
      const recs = await generateStopRecommendations(DEFAULT_USER_ID, priceMap).catch(() => []);
      const trailing = await generateTrailingStopRecommendations(DEFAULT_USER_ID).catch(() => []);
      // Merge — same logic as /api/stops
      const merged = new Map<string, number>();
      for (const r of recs) merged.set(r.positionId, r.newStop);
      for (const r of trailing) {
        const existing = merged.get(r.positionId);
        if (!existing || r.trailingStop > existing) merged.set(r.positionId, r.trailingStop);
      }
      stopsCount = merged.size;
    }
  } catch { /* best-effort */ }

  const readyCount = scanResult?.results.length ?? 0;

  const text = `${healthEmoji} <b>HybridTurtle Status</b>
Phase: ${phase}
Regime: <b>${regime}</b>
Last nightly: ${heartbeatStr}
Health: ${healthCheck?.overall ?? 'UNKNOWN'}
Open positions: ${posCount}
Stops pending: ${stopsCount}
Ready candidates: ${readyCount}`;

  return { text, parseMode: 'HTML' };
}

// ── /positions ──

async function cmdPositions(): Promise<CommandResponse> {
  const positions = await prisma.position.findMany({
    where: { userId: DEFAULT_USER_ID, status: 'OPEN' },
    include: { stock: { select: { ticker: true, currency: true, sleeve: true } } },
  });

  if (positions.length === 0) {
    return { text: '📊 <b>Open Positions</b>\nNo open positions.', parseMode: 'HTML' };
  }

  const tickers = positions.map((p) => p.stock.ticker);
  const livePrices = await getBatchPrices(tickers);

  const lines = positions.map((p) => {
    const price = livePrices[p.stock.ticker] ?? p.entryPrice;
    const rMul = calculateRMultiple(price, p.entryPrice, p.initialRisk);
    const rLabel = rMul >= 0 ? `+${rMul.toFixed(1)}R` : `${rMul.toFixed(1)}R`;
    const levelEmoji = p.protectionLevel === 'LOCK_1R_TRAIL' ? '🟢'
      : p.protectionLevel === 'LOCK_08R' ? '🔵'
      : p.protectionLevel === 'BREAKEVEN' ? '🟡' : '⚪';
    const sym = currencySymbol(p.stock.currency);
    return `${levelEmoji} <b>${escapeHtml(p.stock.ticker)}</b>  ${rLabel}  ${p.protectionLevel ?? 'INITIAL'}  Stop: ${sym}${p.currentStop.toFixed(2)}`;
  });

  // Total open risk
  const user = await prisma.user.findUnique({
    where: { id: DEFAULT_USER_ID },
    select: { equity: true, riskProfile: true },
  });
  let riskLine = '';
  if (user) {
    const stockCurrencies: Record<string, string | null> = {};
    for (const p of positions) { stockCurrencies[p.stock.ticker] = p.stock.currency; }
    const gbpPrices = await normalizeBatchPricesToGBP(livePrices, stockCurrencies);
    const enriched = positions.map((p) => {
      const rawPrice = livePrices[p.stock.ticker] ?? p.entryPrice;
      const gbpPrice = gbpPrices[p.stock.ticker] ?? rawPrice;
      const fxRatio = rawPrice > 0 ? gbpPrice / rawPrice : 1;
      return {
        id: p.id, ticker: p.stock.ticker, sleeve: p.stock.sleeve as Sleeve,
        sector: 'X', cluster: 'X', value: gbpPrice * p.shares,
        riskDollars: Math.max(0, (gbpPrice - p.currentStop * fxRatio) * p.shares),
        shares: p.shares, entryPrice: p.entryPrice, currentStop: p.currentStop, currentPrice: rawPrice,
      };
    });
    const budget = getRiskBudget(enriched, user.equity, user.riskProfile as RiskProfileType);
    riskLine = `\nTotal open risk: ${budget.usedRiskPercent.toFixed(1)}%`;
  }

  return {
    text: `📊 <b>Open Positions (${positions.length})</b>\n${lines.join('\n')}${riskLine}`,
    parseMode: 'HTML',
  };
}

// ── /stopsdue ──

async function cmdStopsDue(): Promise<CommandResponse> {
  const positions = await prisma.position.findMany({
    where: { userId: DEFAULT_USER_ID, status: 'OPEN' },
    include: { stock: { select: { ticker: true, currency: true } } },
  });

  if (positions.length === 0) {
    return { text: '🔔 <b>Stops Due</b>\nNo open positions.', parseMode: 'HTML' };
  }

  const tickers = positions.map((p) => p.stock.ticker);
  const livePrices = await getBatchPrices(tickers);
  const priceMap = new Map(Object.entries(livePrices));

  const rBasedRecs = await generateStopRecommendations(DEFAULT_USER_ID, priceMap).catch(() => []);
  const trailingRecs = await generateTrailingStopRecommendations(DEFAULT_USER_ID).catch(() => []);

  // Merge — keep highest per position
  const merged = new Map<string, { ticker: string; currentStop: number; newStop: number; level: string; currency: string }>();
  for (const r of rBasedRecs) {
    const pos = positions.find((p) => p.id === r.positionId);
    merged.set(r.positionId, {
      ticker: r.ticker, currentStop: r.currentStop, newStop: r.newStop,
      level: r.newLevel, currency: pos?.stock.currency ?? 'USD',
    });
  }
  for (const r of trailingRecs) {
    const existing = merged.get(r.positionId);
    if (!existing || r.trailingStop > existing.newStop) {
      merged.set(r.positionId, {
        ticker: r.ticker, currentStop: r.currentStop, newStop: r.trailingStop,
        level: 'TRAILING_ATR', currency: r.priceCurrency,
      });
    }
  }

  if (merged.size === 0) {
    return { text: '🔔 <b>Stops Due</b>\n✅ All stops up to date.', parseMode: 'HTML' };
  }

  const lines = Array.from(merged.values()).map((r) => {
    const sym = currencySymbol(r.currency);
    return `${escapeHtml(r.ticker)}: Move stop ${sym}${r.currentStop.toFixed(2)} → ${sym}${r.newStop.toFixed(2)} (${r.level})`;
  });

  return {
    text: `🔔 <b>Stops Due (${merged.size})</b>\n${lines.join('\n')}\n\n<i>Apply stops in the dashboard → /portfolio/positions</i>`,
    parseMode: 'HTML',
  };
}

// ── /regime ──

async function cmdRegime(): Promise<CommandResponse> {
  const regime = await getMarketRegime().catch(() => 'SIDEWAYS' as const);

  // Fear & Greed — best-effort from last known store value
  // (Not easily available server-side without an extra fetch, so omit if not cached)

  const text = `📈 <b>Market Regime</b>
Overall: <b>${regime}</b>

<i>Dual benchmark: SPY + VWRL must both be bullish for BULLISH confirmation. 3-day stability required.</i>`;

  return { text, parseMode: 'HTML' };
}

// ── /risk ──

async function cmdRisk(): Promise<CommandResponse> {
  const user = await prisma.user.findUnique({
    where: { id: DEFAULT_USER_ID },
    select: { equity: true, riskProfile: true },
  });

  if (!user) {
    return { text: '💰 <b>Risk Budget</b>\nUser not found.', parseMode: 'HTML' };
  }

  const positions = await prisma.position.findMany({
    where: { userId: DEFAULT_USER_ID, status: 'OPEN' },
    include: { stock: true },
  });

  const tickers = positions.map((p) => p.stock.ticker);
  const livePrices = tickers.length > 0 ? await getBatchPrices(tickers) : {};
  const stockCurrencies: Record<string, string | null> = {};
  for (const p of positions) { stockCurrencies[p.stock.ticker] = p.stock.currency; }
  const gbpPrices = tickers.length > 0
    ? await normalizeBatchPricesToGBP(livePrices, stockCurrencies)
    : {};

  const enriched = positions.map((p) => {
    const rawPrice = livePrices[p.stock.ticker] ?? p.entryPrice;
    const gbpPrice = gbpPrices[p.stock.ticker] ?? rawPrice;
    const fxRatio = rawPrice > 0 ? gbpPrice / rawPrice : 1;
    return {
      id: p.id, ticker: p.stock.ticker, sleeve: p.stock.sleeve as Sleeve,
      sector: p.stock.sector ?? 'X', cluster: p.stock.cluster ?? 'X',
      value: gbpPrice * p.shares,
      riskDollars: Math.max(0, (gbpPrice - p.currentStop * fxRatio) * p.shares),
      shares: p.shares, entryPrice: p.entryPrice, currentStop: p.currentStop, currentPrice: rawPrice,
    };
  });

  const budget = getRiskBudget(enriched, user.equity, user.riskProfile as RiskProfileType);

  const sleeveLines = Object.entries(budget.sleeveUtilization)
    .filter(([sleeve]) => sleeve !== 'HEDGE')
    .map(([sleeve, { used, max }]) => `  ${sleeve}: ${used.toFixed(0)}% / ${max.toFixed(0)}%`)
    .join('\n');

  const text = `💰 <b>Risk Budget</b>
Profile: ${user.riskProfile}
Open risk: ${budget.usedRiskPercent.toFixed(1)}% / ${budget.maxRiskPercent.toFixed(1)}%
Positions: ${budget.usedPositions} / ${budget.maxPositions} max
Sleeve usage:
${sleeveLines}`;

  return { text, parseMode: 'HTML' };
}

// ── /candidates ──

async function cmdCandidates(): Promise<CommandResponse> {
  // Use snapshot data for candidates (same source as cross-ref)
  const latestSnapshot = await prisma.snapshot.findFirst({
    orderBy: { createdAt: 'desc' },
    select: { id: true, createdAt: true },
  });

  if (!latestSnapshot) {
    return { text: '🎯 <b>Ready Candidates</b>\nNo snapshot data. Run the nightly pipeline first.', parseMode: 'HTML' };
  }

  const heldTickers = new Set(
    (await prisma.position.findMany({
      where: { userId: DEFAULT_USER_ID, status: 'OPEN' },
      select: { stock: { select: { ticker: true } } },
    })).map((p) => p.stock.ticker)
  );

  const candidates = await prisma.snapshotTicker.findMany({
    where: {
      snapshotId: latestSnapshot.id,
      status: { in: ['READY', 'WATCH'] },
    },
    orderBy: { distanceTo20dHighPct: 'asc' },
    take: 20,
  });

  // Filter: not held, trigger met, ADX ok
  const ready = candidates
    .filter((r) => !heldTickers.has(r.ticker) && r.close >= r.entryTrigger && r.entryTrigger > 0 && r.adx14 >= 20)
    .slice(0, 5);

  if (ready.length === 0) {
    const ageHours = Math.round((Date.now() - latestSnapshot.createdAt.getTime()) / (1000 * 60 * 60));
    return {
      text: `🎯 <b>Ready Candidates</b>\nNo trigger-met candidates.\nLast snapshot: ${ageHours}h ago`,
      parseMode: 'HTML',
    };
  }

  const lines = ready.map((r) => {
    const sym = currencySymbol(r.currency);
    return `<b>${escapeHtml(r.ticker)}</b>  ${sym}${r.close.toFixed(2)}  ADX: ${r.adx14.toFixed(0)}  Stop: ${sym}${r.stopLevel.toFixed(2)}`;
  });

  const ageHours = Math.round((Date.now() - latestSnapshot.createdAt.getTime()) / (1000 * 60 * 60));

  return {
    text: `🎯 <b>Ready Candidates (${ready.length})</b>\n${lines.join('\n')}\nLast snapshot: ${ageHours}h ago`,
    parseMode: 'HTML',
  };
}

// ── /help ──

function cmdHelp(): CommandResponse {
  return {
    text: `🐢 <b>HybridTurtle Commands</b>
/status — system overview
/positions — open positions
/stopsdue — pending stop updates
/regime — market regime detail
/risk — risk budget
/candidates — ready candidates
/help — this message`,
    parseMode: 'HTML',
  };
}
