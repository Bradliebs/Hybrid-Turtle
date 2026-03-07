/**
 * DEPENDENCIES
 * Consumed by: /api/analytics/execution-audit/route.ts, /execution-audit page
 * Consumes: prisma.ts
 * Risk-sensitive: NO — read-only analytics
 * Last modified: 2026-03-06
 *
 * Notes: Execution Audit — measures the gap between model assumptions
 *        and actual fill. Uses TradeLog + Position + CandidateOutcome
 *        data already captured during the execution flow.
 *
 *        "Materially differed" thresholds are defined in MATERIAL_THRESHOLDS.
 *        All calculations are deterministic: diffs, percentages, rates.
 */
import prisma from './prisma';

// ── Thresholds: what counts as "materially different" ───────

export const MATERIAL_THRESHOLDS = {
  /** Fill slippage > this % means "materially worse fill" */
  slippagePct: 0.5,
  /** Stop placement error > this % of entry means "stop differed" */
  stopDiffPct: 0.3,
  /** Position size diff > this % means "size materially differed" */
  sizeDiffPct: 10,
  /** Slippage > this in R means "significant in risk terms" */
  slippageR: 0.1,
} as const;

// ── Types ───────────────────────────────────────────────────────────

/** Per-trade execution audit row */
export interface ExecutionAuditRow {
  tradeLogId: string;
  ticker: string;
  sleeve: string | null;
  tradeDate: string;           // ISO
  regime: string | null;

  // Plan vs actual: entry
  plannedEntry: number | null;
  scanRefPrice: number | null;  // price at scan time (CandidateOutcome.price)
  actualFill: number | null;
  fillTimestamp: string | null;
  fillDelayMinutes: number | null;

  // Plan vs actual: stop
  expectedStop: number | null;
  actualInitialStop: number | null;
  stopDiffPct: number | null;

  // Plan vs actual: sizing
  expectedShares: number | null;
  actualShares: number | null;
  sizeDiffPct: number | null;
  expectedRiskGbp: number | null;
  actualRiskGbp: number | null;
  riskDiffPct: number | null;

  // Slippage metrics
  slippagePct: number | null;
  slippageR: number | null;

  // Rule compliance post-fill
  antiChaseTriggered: boolean;
  wouldViolateAntiChase: boolean;
  riskRulesMetPostFill: boolean;

  // Data quality
  dataFreshness: string | null;

  // Flags
  materialSlippage: boolean;
  materialStopDiff: boolean;
  materialSizeDiff: boolean;
}

/** Aggregated execution audit summary */
export interface ExecutionAuditSummary {
  // Counts
  totalTrades: number;
  tradesWithFills: number;

  // Slippage
  avgSlippagePct: number | null;
  medianSlippagePct: number | null;
  avgSlippageR: number | null;
  medianSlippageR: number | null;

  // Material flags
  materialSlippagePct: number | null;   // % of trades with material slippage
  stopDifferedPct: number | null;       // % where stop placement differed
  sizeDifferedPct: number | null;       // % where size materially differed

  // Worst trades
  worstSlippageTrades: { ticker: string; tradeDate: string; slippagePct: number }[];

  // Breakdowns
  bySleeve: Record<string, SleeveBreakdown>;
}

export interface SleeveBreakdown {
  count: number;
  avgSlippagePct: number | null;
  avgSlippageR: number | null;
  materialSlippagePct: number | null;
}

export interface ExecutionAuditResponse {
  ok: boolean;
  generatedAt: string;
  thresholds: typeof MATERIAL_THRESHOLDS;
  summary: ExecutionAuditSummary;
  rows: ExecutionAuditRow[];
}

// ── Pure calculation helpers (exported for testing) ─────────────────

export function calcSlippagePct(planned: number, actual: number): number {
  if (planned <= 0) return 0;
  return ((actual - planned) / planned) * 100;
}

export function calcSlippageR(planned: number, actual: number, initialR: number): number {
  if (initialR <= 0) return 0;
  return (actual - planned) / initialR;
}

export function calcDiffPct(expected: number, actual: number): number {
  if (expected <= 0) return 0;
  return ((actual - expected) / expected) * 100;
}

export function calcFillDelay(decisionTime: Date, fillTime: Date): number {
  return Math.max(0, (fillTime.getTime() - decisionTime.getTime()) / 60_000);
}

/**
 * Check if an actual fill would violate anti-chase rules.
 * Anti-chase blocks when price extends > 0.8 ATR above trigger.
 */
export function wouldViolateAntiChase(
  actualFill: number,
  entryTrigger: number,
  atr: number
): boolean {
  if (atr <= 0 || entryTrigger <= 0) return false;
  const extATR = (actualFill - entryTrigger) / atr;
  return extATR > 0.8;
}

/**
 * Check if actual risk would still pass the profile's max risk per trade.
 * SMALL_ACCOUNT allows 2%, so anything > 2.5% (with 25% buffer) fails.
 */
export function riskRulesMetPostFill(
  actualRiskGbp: number,
  equity: number,
  maxRiskPct: number
): boolean {
  if (equity <= 0 || maxRiskPct <= 0) return true;
  const actualRiskPct = (actualRiskGbp / equity) * 100;
  // Allow 25% tolerance above the profile limit (rounding, fractional shares)
  return actualRiskPct <= maxRiskPct * 1.25;
}

export function median(arr: number[]): number {
  if (arr.length === 0) return 0;
  const sorted = [...arr].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  return sorted.length % 2 !== 0 ? sorted[mid] : (sorted[mid - 1] + sorted[mid]) / 2;
}

export function mean(arr: number[]): number | null {
  if (arr.length === 0) return null;
  return Math.round((arr.reduce((a, b) => a + b, 0) / arr.length) * 1000) / 1000;
}

function pctRate(count: number, total: number): number | null {
  if (total === 0) return null;
  return Math.round((count / total) * 1000) / 10;
}

// ── Core query + assembly ───────────────────────────────────────────

export async function generateExecutionAudit(opts?: {
  from?: Date;
  to?: Date;
  sleeve?: string;
}): Promise<ExecutionAuditResponse> {
  const where: Record<string, unknown> = {
    decision: { in: ['TAKEN', 'EXECUTED', 'BUY'] },
    tradeType: 'ENTRY',
  };
  if (opts?.from || opts?.to) {
    where.tradeDate = {
      ...(opts?.from ? { gte: opts.from } : {}),
      ...(opts?.to ? { lte: opts.to } : {}),
    };
  }

  // Fetch trade logs with linked position
  const tradeLogs = await prisma.tradeLog.findMany({
    where,
    include: {
      position: {
        include: { stock: { select: { sleeve: true, ticker: true } } },
      },
    },
    orderBy: { tradeDate: 'desc' },
  });

  // Filter by sleeve after join (Prisma doesn't support filtering on nested relation easily)
  const filtered = opts?.sleeve
    ? tradeLogs.filter((t) => t.position?.stock?.sleeve === opts.sleeve)
    : tradeLogs;

  // Look up CandidateOutcome for each trade (for scanRefPrice + dataFreshness)
  const tickers = Array.from(new Set(filtered.map((t) => t.ticker)));
  const outcomes = tickers.length > 0
    ? await prisma.candidateOutcome.findMany({
        where: { ticker: { in: tickers }, tradePlaced: true },
        select: {
          ticker: true,
          scanDate: true,
          price: true,
          dataFreshness: true,
          tradeLogId: true,
          entryTrigger: true,
          suggestedShares: true,
          suggestedRiskGbp: true,
          stopPrice: true,
        },
      })
    : [];

  // Index outcomes by tradeLogId for O(1) lookup
  const outcomeByTradeLogId = new Map<string, (typeof outcomes)[0]>();
  const outcomeByTicker = new Map<string, (typeof outcomes)[0][]>();
  for (const o of outcomes) {
    if (o.tradeLogId) outcomeByTradeLogId.set(o.tradeLogId, o);
    const arr = outcomeByTicker.get(o.ticker) || [];
    arr.push(o);
    outcomeByTicker.set(o.ticker, arr);
  }

  // Fetch user equity for risk rule check
  const user = await prisma.user.findFirst({ select: { equity: true, riskProfile: true } });
  const equity = user?.equity ?? 10000;
  const maxRiskPct = {
    CONSERVATIVE: 0.75, BALANCED: 0.95, SMALL_ACCOUNT: 2.0, AGGRESSIVE: 3.0,
  }[user?.riskProfile ?? 'SMALL_ACCOUNT'] ?? 2.0;

  // ── Build audit rows ───────────────────────────────────────────

  const rows: ExecutionAuditRow[] = [];

  for (const trade of filtered) {
    const pos = trade.position;
    const sleeve = pos?.stock?.sleeve ?? null;
    const outcome = outcomeByTradeLogId.get(trade.id)
      ?? outcomeByTicker.get(trade.ticker)?.find((o) => {
        // Match by date proximity (±3 days)
        const diff = Math.abs(o.scanDate.getTime() - trade.tradeDate.getTime());
        return diff < 3 * 24 * 60 * 60 * 1000;
      });

    const plannedEntry = trade.plannedEntry ?? trade.entryPrice;
    const actualFill = trade.actualFill ?? trade.fillPrice ?? trade.entryPrice;
    const expectedStop = trade.initialStop ?? outcome?.stopPrice ?? null;
    const actualInitialStop = pos?.stopLoss ?? pos?.currentStop ?? null;
    const expectedShares = outcome?.suggestedShares ?? trade.shares;
    const actualShares = pos?.shares ?? trade.fillQuantity ?? trade.shares;
    const atr = trade.atrAtEntry ?? 0;
    const initialR = trade.initialR ?? (plannedEntry && expectedStop ? Math.abs(plannedEntry - expectedStop) : null);

    // Slippage
    const slipPct = plannedEntry && actualFill
      ? Math.round(calcSlippagePct(plannedEntry, actualFill) * 1000) / 1000
      : trade.slippagePct ?? null;
    const slipR = plannedEntry && actualFill && initialR && initialR > 0
      ? Math.round(calcSlippageR(plannedEntry, actualFill, initialR) * 1000) / 1000
      : null;

    // Stop diff
    const stopDiff = expectedStop && actualInitialStop
      ? Math.round(calcDiffPct(expectedStop, actualInitialStop) * 1000) / 1000
      : null;

    // Size diff
    const sizeDiff = expectedShares && actualShares
      ? Math.round(calcDiffPct(expectedShares, actualShares) * 1000) / 1000
      : null;

    // Risk diff
    const expectedRiskGbp = outcome?.suggestedRiskGbp ?? trade.positionSizeGbp ?? null;
    const actualRiskGbp = actualFill && actualInitialStop && actualShares
      ? Math.abs(actualFill - actualInitialStop) * (actualShares ?? 0)
      : pos?.initialRisk ? pos.initialRisk * (actualShares ?? 0) : null;
    const riskDiff = expectedRiskGbp && actualRiskGbp
      ? Math.round(calcDiffPct(expectedRiskGbp, actualRiskGbp) * 1000) / 1000
      : null;

    // Fill delay
    const fillTs = trade.fillTime ?? trade.fillTimestamp;
    const delayMin = fillTs
      ? Math.round(calcFillDelay(trade.tradeDate, fillTs) * 10) / 10
      : null;

    // Rule checks
    const antiChase = trade.antiChaseTriggered;
    const wouldViolate = actualFill && outcome?.entryTrigger && atr > 0
      ? wouldViolateAntiChase(actualFill, outcome.entryTrigger, atr)
      : false;
    const riskMet = actualRiskGbp != null
      ? riskRulesMetPostFill(actualRiskGbp, equity, maxRiskPct)
      : true;

    rows.push({
      tradeLogId: trade.id,
      ticker: trade.ticker,
      sleeve,
      tradeDate: trade.tradeDate.toISOString(),
      regime: trade.regime,
      plannedEntry: plannedEntry ?? null,
      scanRefPrice: outcome?.price ?? null,
      actualFill: actualFill ?? null,
      fillTimestamp: fillTs?.toISOString() ?? null,
      fillDelayMinutes: delayMin,
      expectedStop: expectedStop ?? null,
      actualInitialStop: actualInitialStop ?? null,
      stopDiffPct: stopDiff,
      expectedShares: expectedShares ?? null,
      actualShares: actualShares ?? null,
      sizeDiffPct: sizeDiff,
      expectedRiskGbp: expectedRiskGbp ?? null,
      actualRiskGbp: actualRiskGbp != null ? Math.round(actualRiskGbp * 100) / 100 : null,
      riskDiffPct: riskDiff,
      slippagePct: slipPct,
      slippageR: slipR,
      antiChaseTriggered: antiChase,
      wouldViolateAntiChase: wouldViolate,
      riskRulesMetPostFill: riskMet,
      dataFreshness: outcome?.dataFreshness ?? null,
      materialSlippage: slipPct != null && Math.abs(slipPct) > MATERIAL_THRESHOLDS.slippagePct,
      materialStopDiff: stopDiff != null && Math.abs(stopDiff) > MATERIAL_THRESHOLDS.stopDiffPct,
      materialSizeDiff: sizeDiff != null && Math.abs(sizeDiff) > MATERIAL_THRESHOLDS.sizeDiffPct,
    });
  }

  // ── Aggregate summary ─────────────────────────────────────────

  const slippages = rows.map((r) => r.slippagePct).filter((v): v is number => v != null);
  const slippagesR = rows.map((r) => r.slippageR).filter((v): v is number => v != null);
  const tradesWithFills = rows.filter((r) => r.actualFill != null).length;

  // Worst slippage (top 5 by absolute value)
  const worstSlippage = [...rows]
    .filter((r) => r.slippagePct != null)
    .sort((a, b) => Math.abs(b.slippagePct!) - Math.abs(a.slippagePct!))
    .slice(0, 5)
    .map((r) => ({ ticker: r.ticker, tradeDate: r.tradeDate, slippagePct: r.slippagePct! }));

  // Sleeve breakdown
  const sleeves = new Map<string, ExecutionAuditRow[]>();
  for (const r of rows) {
    const s = r.sleeve ?? 'UNKNOWN';
    const arr = sleeves.get(s) || [];
    arr.push(r);
    sleeves.set(s, arr);
  }
  const bySleeve: Record<string, SleeveBreakdown> = {};
  for (const s of Array.from(sleeves.keys())) {
    const sRows = sleeves.get(s)!;
    const sSlip = sRows.map((r) => r.slippagePct).filter((v): v is number => v != null);
    const sSlipR = sRows.map((r) => r.slippageR).filter((v): v is number => v != null);
    const sMat = sRows.filter((r) => r.materialSlippage).length;
    bySleeve[s] = {
      count: sRows.length,
      avgSlippagePct: mean(sSlip),
      avgSlippageR: mean(sSlipR),
      materialSlippagePct: pctRate(sMat, sRows.length),
    };
  }

  const summary: ExecutionAuditSummary = {
    totalTrades: rows.length,
    tradesWithFills,
    avgSlippagePct: mean(slippages),
    medianSlippagePct: slippages.length > 0 ? Math.round(median(slippages) * 1000) / 1000 : null,
    avgSlippageR: mean(slippagesR),
    medianSlippageR: slippagesR.length > 0 ? Math.round(median(slippagesR) * 1000) / 1000 : null,
    materialSlippagePct: pctRate(rows.filter((r) => r.materialSlippage).length, rows.length),
    stopDifferedPct: pctRate(rows.filter((r) => r.materialStopDiff).length, rows.length),
    sizeDifferedPct: pctRate(rows.filter((r) => r.materialSizeDiff).length, rows.length),
    worstSlippageTrades: worstSlippage,
    bySleeve,
  };

  return {
    ok: true,
    generatedAt: new Date().toISOString(),
    thresholds: MATERIAL_THRESHOLDS,
    summary,
    rows,
  };
}
