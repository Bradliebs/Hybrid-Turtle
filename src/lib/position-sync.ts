/**
 * DEPENDENCIES
 * Consumed by: nightly.ts
 * Consumes: trading212-dual.ts, trading212.ts, prisma.ts, market-data.ts, alert-service.ts, ev-tracker.ts
 * Risk-sensitive: YES — auto-closes positions based on T212 state
 * Last modified: 2026-03-02
 * Notes: NEVER closes positions if T212 API fails or returns zero positions.
 *        Uses Position.t212Ticker or Stock.t212Ticker for matching.
 *        Dual-account aware (ISA + INVEST).
 */

import prisma from '@/lib/prisma';
import {
  DualT212Client,
  getCredentialsForAccount,
  validateDualCredentials,
} from '@/lib/trading212-dual';
import {
  mapT212Position,
  type T212HistoricalOrder,
  Trading212Client,
  type Trading212Environment,
} from '@/lib/trading212';
import { getFXRate } from '@/lib/market-data';
import { sendAlert } from '@/lib/alert-service';
import { logEVRecord } from '@/lib/ev-tracker';

// ── Types ────────────────────────────────────────────────────────────

export interface PositionSyncResult {
  checked: number;
  closed: number;
  skipped: number;
  updated: number;
  errors: string[];
}

interface ClosureCandidate {
  positionId: string;
  ticker: string;
  stockName: string;
  t212Ticker: string;
  entryPrice: number;
  entryDate: Date;
  shares: number;
  currentStop: number;
  initialRisk: number;
  initial_R: number | null;
  atr_at_entry: number | null;
  stockId: string;
  stockCurrency: string | null;
  stockCluster: string | null;
  stockSleeve: string;
  userId: string;
  accountType: string | null;
}

// ── Main Entry Point ─────────────────────────────────────────────────

/**
 * Sync HybridTurtle open positions against Trading 212.
 * If T212 no longer holds a position, close it with actual exit data.
 *
 * SAFETY: Aborts entirely (no closures) if T212 API fails or returns 0 positions.
 */
export async function syncClosedPositions(userId: string = 'default-user'): Promise<PositionSyncResult> {
  const result: PositionSyncResult = { checked: 0, closed: 0, skipped: 0, updated: 0, errors: [] };

  // 1. Fetch all OPEN positions from DB
  const openPositions = await prisma.position.findMany({
    where: { userId, status: 'OPEN' },
    include: { stock: true },
  });

  if (openPositions.length === 0) {
    return result; // Nothing to sync
  }

  result.checked = openPositions.length;

  // 2. Load T212 credentials and fetch live positions
  const user = await prisma.user.findUnique({
    where: { id: userId },
    select: {
      t212ApiKey: true,
      t212ApiSecret: true,
      t212Environment: true,
      t212Connected: true,
      t212IsaApiKey: true,
      t212IsaApiSecret: true,
      t212IsaConnected: true,
    },
  });

  if (!user) {
    result.errors.push('User not found');
    return result;
  }

  const creds = validateDualCredentials(user);
  if (!creds.canFetch) {
    result.errors.push('No T212 credentials configured — position sync skipped');
    return result;
  }

  const investCreds = getCredentialsForAccount(user, 'invest');
  const isaCreds = getCredentialsForAccount(user, 'isa');
  const dualClient = new DualT212Client(investCreds, isaCreds);

  let dualResult;
  try {
    dualResult = await dualClient.fetchBothAccounts();
  } catch (err) {
    result.errors.push(`T212 API call failed: ${(err as Error).message}`);
    return result; // SAFETY: do not close anything
  }

  // SAFETY: If both accounts failed, abort entirely
  const investFailed = creds.hasInvest && (dualResult.errors.invest || !dualResult.invest?.positionsFetched);
  const isaFailed = creds.hasIsa && (dualResult.errors.isa || !dualResult.isa?.positionsFetched);

  if (investFailed && isaFailed) {
    result.errors.push('T212 position fetch failed for all accounts — no positions auto-closed');
    if (dualResult.errors.invest) result.errors.push(`Invest: ${dualResult.errors.invest}`);
    if (dualResult.errors.isa) result.errors.push(`ISA: ${dualResult.errors.isa}`);
    return result;
  }

  // Build set of T212 tickers currently held across both accounts
  const combinedPositions = dualClient.getCombinedPositions(dualResult);

  // SAFETY: If T212 returns 0 positions across all accounts, suspect API error
  if (combinedPositions.length === 0) {
    result.errors.push('T212 returned 0 positions — possible API error. No positions auto-closed.');
    return result;
  }

  // Map: t212Ticker → T212 position data (for price updates)
  const t212TickerMap = new Map<string, { currentPrice: number; fullTicker: string }>();
  for (const pos of combinedPositions) {
    // fullTicker is the raw T212 ticker (AME_US_EQ). Use it for matching.
    t212TickerMap.set(pos.fullTicker, {
      currentPrice: pos.currentPrice,
      fullTicker: pos.fullTicker,
    });
  }

  // Also build a set of just the T212 full tickers for quick lookups
  const t212OpenTickers = new Set(combinedPositions.map(p => p.fullTicker));

  // Fetch order history once — used for exit price determination
  // Use the invest client by default (most positions), with ISA fallback
  let orderHistory: T212HistoricalOrder[] = [];
  try {
    const primaryClient = investCreds
      ? new Trading212Client(investCreds.apiKey, investCreds.apiSecret, investCreds.environment)
      : isaCreds
        ? new Trading212Client(isaCreds.apiKey, isaCreds.apiSecret, isaCreds.environment)
        : null;

    if (primaryClient) {
      orderHistory = await primaryClient.getOrderHistory(50);
    }

    // If ISA also exists and is separate, fetch its history too
    if (investCreds && isaCreds) {
      try {
        const isaClient = new Trading212Client(isaCreds.apiKey, isaCreds.apiSecret, isaCreds.environment);
        const isaOrders = await isaClient.getOrderHistory(50);
        orderHistory = [...orderHistory, ...isaOrders];
      } catch {
        // ISA order history optional — invest orders are primary
      }
    }
  } catch (err) {
    // Order history unavailable — we'll fall back to estimated prices
    result.errors.push(`Order history fetch failed: ${(err as Error).message}`);
  }

  // 3. For each OPEN position in HybridTurtle, check T212 status
  for (const pos of openPositions) {
    // Resolve T212 ticker: Position.t212Ticker > Stock.t212Ticker
    const t212Ticker = pos.t212Ticker || pos.stock.t212Ticker;

    if (!t212Ticker) {
      // Cannot sync — no T212 ticker mapping
      result.skipped++;
      continue;
    }

    if (t212OpenTickers.has(t212Ticker)) {
      // Position still open in T212 — update currentPrice from live data
      const t212Data = t212TickerMap.get(t212Ticker);
      if (t212Data && t212Data.currentPrice > 0) {
        result.updated++;
      }
      continue;
    }

    // Position was closed in T212 — only close if the account we depend on
    // actually returned data. If the account that owns this position failed
    // to fetch, skip it rather than incorrectly closing.
    const posAcct = pos.accountType || 'invest';
    if (posAcct === 'invest' && investFailed) {
      result.skipped++;
      result.errors.push(`${pos.stock.ticker}: skipped — Invest account fetch failed`);
      continue;
    }
    if (posAcct === 'isa' && isaFailed) {
      result.skipped++;
      result.errors.push(`${pos.stock.ticker}: skipped — ISA account fetch failed`);
      continue;
    }

    // Confirmed closed — build closure candidate
    const candidate: ClosureCandidate = {
      positionId: pos.id,
      ticker: pos.stock.ticker,
      stockName: pos.stock.name || pos.stock.ticker,
      t212Ticker,
      entryPrice: pos.entryPrice,
      entryDate: pos.entryDate,
      shares: pos.shares,
      currentStop: pos.currentStop,
      initialRisk: pos.initialRisk,
      initial_R: pos.initial_R,
      atr_at_entry: pos.atr_at_entry,
      stockId: pos.stockId,
      stockCurrency: pos.stock.currency,
      stockCluster: pos.stock.cluster,
      stockSleeve: pos.stock.sleeve,
      userId: pos.userId,
      accountType: pos.accountType,
    };

    try {
      await closePosition(candidate, orderHistory);
      result.closed++;
    } catch (err) {
      result.errors.push(`${pos.stock.ticker}: close failed — ${(err as Error).message}`);
    }
  }

  return result;
}

// ── Closure Flow ─────────────────────────────────────────────────────

async function closePosition(
  candidate: ClosureCandidate,
  orderHistory: T212HistoricalOrder[]
): Promise<void> {
  const now = new Date();

  // 1. Determine exit price from order history
  const { exitPrice, confidence } = determineExitPrice(candidate, orderHistory);

  // 2. Determine exit reason
  const exitReason = determineExitReason(exitPrice, candidate.currentStop);

  // 3. Calculate P&L
  const fxRate = await getCloseFxRate(candidate.ticker, candidate.stockCurrency);
  const realisedPnlGbp = (exitPrice - candidate.entryPrice) * candidate.shares * fxRate;
  const initialR = candidate.initial_R ?? candidate.initialRisk;
  const realisedPnlR = initialR > 0
    ? (exitPrice - candidate.entryPrice) / initialR
    : null;

  // 4. Calculate holding days
  const daysHeld = Math.floor((now.getTime() - candidate.entryDate.getTime()) / 86400000);

  // 5. Atomic update: position + trade log in a single transaction
  await prisma.$transaction(async (tx) => {
    // Update position
    await tx.position.update({
      where: { id: candidate.positionId },
      data: {
        status: 'CLOSED',
        exitPrice,
        exitDate: now,
        exitReason,
        exitProfitR: realisedPnlR,
        realisedPnlGbp,
        realisedPnlR,
        closedBy: 'AUTO_SYNC',
      },
    });

    // Create trade log entry
    const tradeType = exitReason === 'STOP_HIT' ? 'STOP_HIT' : 'EXIT';
    try {
      await tx.tradeLog.create({
        data: {
          userId: candidate.userId,
          positionId: candidate.positionId,
          ticker: candidate.ticker,
          tradeDate: now,
          tradeType,
          decision: 'TAKEN',
          entryPrice: candidate.entryPrice,
          initialStop: candidate.currentStop,
          initialR,
          shares: candidate.shares,
          exitPrice,
          exitReason,
          finalRMultiple: realisedPnlR,
          gainLossGbp: realisedPnlGbp,
          daysHeld,
          atrAtEntry: candidate.atr_at_entry,
        },
      });
    } catch (logError) {
      const prismaCode = (logError as { code?: string })?.code;
      if (prismaCode === 'P2002') {
        // Duplicate trade log — skip silently
      } else {
        console.warn(`TradeLog create failed for auto-close of ${candidate.ticker}:`, logError);
      }
    }
  });

  // 6. Log EV record (non-blocking, outside transaction)
  const entryLog = await prisma.tradeLog.findFirst({
    where: { positionId: candidate.positionId, tradeType: { in: ['ENTRY', 'STOP_HIT', 'EXIT'] } },
    orderBy: { tradeDate: 'asc' },
    select: { id: true, regime: true, ncsScore: true },
  });

  logEVRecord({
    tradeId: entryLog?.id ?? candidate.positionId,
    regime: entryLog?.regime,
    atrAtEntry: candidate.atr_at_entry,
    cluster: candidate.stockCluster,
    sleeve: candidate.stockSleeve,
    entryNCS: entryLog?.ncsScore ?? null,
    rMultiple: realisedPnlR ?? 0,
    closedAt: now,
  }).catch(() => { /* already logged inside logEVRecord */ });

  // 7. Send notifications
  await sendClosureNotifications(candidate, exitPrice, exitReason, realisedPnlGbp, realisedPnlR, daysHeld, confidence);
}

// ── Exit Price Determination ─────────────────────────────────────────

function determineExitPrice(
  candidate: ClosureCandidate,
  orderHistory: T212HistoricalOrder[]
): { exitPrice: number; confidence: 'CONFIRMED' | 'ESTIMATED' | 'UNKNOWN' } {
  // Look for the most recent SELL order matching this T212 ticker
  const sellOrders = orderHistory
    .filter(o =>
      o.ticker === candidate.t212Ticker &&
      o.type === 'SELL' &&
      o.status === 'FILLED' &&
      o.filledQuantity > 0
    )
    .sort((a, b) => {
      // Most recent first
      const dateA = a.dateExecuted ? new Date(a.dateExecuted).getTime() : 0;
      const dateB = b.dateExecuted ? new Date(b.dateExecuted).getTime() : 0;
      return dateB - dateA;
    });

  if (sellOrders.length > 0) {
    const order = sellOrders[0];
    // filledValue / filledQuantity = average fill price
    const fillPrice = order.filledQuantity > 0
      ? order.filledValue / order.filledQuantity
      : 0;
    if (fillPrice > 0) {
      return { exitPrice: fillPrice, confidence: 'CONFIRMED' };
    }
  }

  // Fallback: use the last live price we have for this position
  // (not ideal but better than nothing)
  if (candidate.entryPrice > 0) {
    return { exitPrice: candidate.entryPrice, confidence: 'UNKNOWN' };
  }

  return { exitPrice: 0, confidence: 'UNKNOWN' };
}

// ── Exit Reason Determination ────────────────────────────────────────

function determineExitReason(exitPrice: number, currentStop: number): string {
  if (exitPrice <= currentStop) {
    return 'STOP_HIT';
  }
  if (exitPrice > currentStop) {
    return 'MANUAL_SALE';
  }
  return 'UNKNOWN';
}

// ── FX Rate Helper ───────────────────────────────────────────────────

async function getCloseFxRate(ticker: string, stockCurrency: string | null): Promise<number> {
  const isUK = ticker.endsWith('.L') || /^[A-Z]{2,5}l$/.test(ticker);
  const currency = (stockCurrency || 'USD').toUpperCase();

  if (isUK || currency === 'GBX' || currency === 'GBp') {
    return 0.01; // Pence to pounds
  }
  if (currency === 'GBP') {
    return 1;
  }
  return getFXRate(currency, 'GBP');
}

// ── Notifications ────────────────────────────────────────────────────

async function sendClosureNotifications(
  candidate: ClosureCandidate,
  exitPrice: number,
  exitReason: string,
  realisedPnlGbp: number,
  realisedPnlR: number | null,
  daysHeld: number,
  priceConfidence: 'CONFIRMED' | 'ESTIMATED' | 'UNKNOWN'
): Promise<void> {
  const currSymbol = getCurrencySymbol(candidate.ticker, candidate.stockCurrency);
  const pnlSign = realisedPnlGbp >= 0 ? '+' : '';
  const rStr = realisedPnlR != null ? `${pnlSign}${realisedPnlR.toFixed(1)}R` : 'N/A';
  const pnlStr = `${pnlSign}£${realisedPnlGbp.toFixed(2)}`;
  const priceNote = priceConfidence === 'UNKNOWN' ? ' (estimated)' : '';

  if (exitReason === 'STOP_HIT') {
    await sendAlert({
      type: 'POSITION_CLOSED',
      title: `Position closed — ${candidate.ticker} stop triggered`,
      message: `Your stop-loss on ${candidate.ticker} (${candidate.stockName}) was triggered.\n\nBought: ${currSymbol}${candidate.entryPrice.toFixed(2)} · Sold: ${currSymbol}${exitPrice.toFixed(2)}${priceNote}\nResult: ${pnlStr} (${rStr})\nHeld: ${daysHeld} days\n\nOpen your journal to record what happened.`,
      data: { ticker: candidate.ticker, exitPrice, exitReason, realisedPnlGbp, realisedPnlR, daysHeld, priceConfidence },
      priority: 'WARNING',
    });
  } else if (exitReason === 'MANUAL_SALE') {
    await sendAlert({
      type: 'POSITION_CLOSED',
      title: `Position closed — ${candidate.ticker} sold`,
      message: `Your position in ${candidate.ticker} (${candidate.stockName}) was closed in Trading 212.\n\nBought: ${currSymbol}${candidate.entryPrice.toFixed(2)} · Sold: ${currSymbol}${exitPrice.toFixed(2)}${priceNote}\nResult: ${pnlStr} (${rStr})\nHeld: ${daysHeld} days\n\nOpen your journal to record your thoughts.`,
      data: { ticker: candidate.ticker, exitPrice, exitReason, realisedPnlGbp, realisedPnlR, daysHeld, priceConfidence },
      priority: 'INFO',
    });
  } else {
    await sendAlert({
      type: 'POSITION_CLOSED',
      title: `Position closed — ${candidate.ticker}`,
      message: `Your position in ${candidate.ticker} was closed in Trading 212.\n\nExit price: ${currSymbol}${exitPrice.toFixed(2)}${priceNote}\nResult: ${pnlStr}\n\nPlease verify in Trading 212 and update your journal.`,
      data: { ticker: candidate.ticker, exitPrice, exitReason, realisedPnlGbp, realisedPnlR, daysHeld, priceConfidence },
      priority: 'WARNING',
    });
  }

  // Journal prompt notification
  await sendAlert({
    type: 'JOURNAL_PROMPT',
    title: `Add a close note — ${candidate.ticker}`,
    message: `You closed ${candidate.ticker} for ${pnlStr}. What happened? What did you learn?\nOpen your journal to record it.`,
    data: { ticker: candidate.ticker, positionId: candidate.positionId },
    priority: 'INFO',
  });
}

function getCurrencySymbol(ticker: string, stockCurrency: string | null): string {
  const isUK = ticker.endsWith('.L') || /^[A-Z]{2,5}l$/.test(ticker);
  const currency = (stockCurrency || 'USD').toUpperCase();
  if (isUK || currency === 'GBP' || currency === 'GBX') return '£';
  if (currency === 'EUR') return '€';
  return '$';
}
