'use client';

import { useState } from 'react';
import { apiRequest } from '@/lib/api-client';
import { cn } from '@/lib/utils';
import {
  Download,
  Loader2,
  CheckCircle2,
  AlertTriangle,
  FileText,
  ArrowRight,
} from 'lucide-react';

// ── Types matching the API response ──────────────────────────────────

interface TradePair {
  ticker: string;
  t212Ticker: string;
  htTicker: string | null;
  buyFillPrice: number;
  sellFillPrice: number;
  buyFillDate: string;
  sellFillDate: string;
  quantity: number;
  holdingDays: number;
  realisedPnl: number | null;
  exitReason: string;
  accountType: 'invest' | 'isa';
}

interface OpenBuy {
  ticker: string;
  t212Ticker: string;
  htTicker: string | null;
  buyFillPrice: number;
  buyFillDate: string;
  quantity: number;
  accountType: 'invest' | 'isa';
  existsInDb: boolean;
}

interface ImportReport {
  accountsScanned: string[];
  totalOrdersFetched: number;
  filledOrders: number;
  tradePairs: TradePair[];
  openBuys: OpenBuy[];
  unmatchedSells: unknown[];
  tickersNotInStockTable: string[];
  tradeLogsWritten: number;
  positionsConfirmed: number;
  skippedDuplicates: number;
  errors: string[];
}

type AccountFilter = 'both' | 'invest' | 'isa';

// ── Component ────────────────────────────────────────────────────────

export default function T212ImportPanel() {
  const [accountFilter, setAccountFilter] = useState<AccountFilter>('both');
  const [phase, setPhase] = useState<'idle' | 'previewing' | 'previewed' | 'importing' | 'done' | 'error'>('idle');
  const [report, setReport] = useState<ImportReport | null>(null);
  const [error, setError] = useState<string | null>(null);

  const runImport = async (dryRun: boolean) => {
    setError(null);
    setPhase(dryRun ? 'previewing' : 'importing');

    try {
      const resp = await apiRequest<{ ok: boolean; report: ImportReport }>('/api/t212-import', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ accountType: accountFilter, dryRun }),
      });

      setReport(resp.report);

      if (resp.report.errors.length > 0 && resp.report.filledOrders === 0) {
        setError(resp.report.errors.join('\n'));
        setPhase('error');
        return;
      }

      setPhase(dryRun ? 'previewed' : 'done');
    } catch (err) {
      setError((err as Error).message);
      setPhase('error');
    }
  };

  const handlePreview = () => runImport(true);
  const handleConfirm = () => runImport(false);

  const handleReset = () => {
    setPhase('idle');
    setReport(null);
    setError(null);
  };

  return (
    <div className="card-surface p-6">
      <h2 className="text-lg font-semibold text-foreground flex items-center gap-2 mb-1">
        <Download className="w-5 h-5 text-primary-400" />
        Import Trading History from T212
      </h2>
      <p className="text-sm text-muted-foreground mb-4">
        Pull your complete trading history directly from Trading 212 and populate your trade log.
        Safe to run again — existing trades will not be duplicated.
      </p>

      {/* Account selector */}
      {(phase === 'idle' || phase === 'error') && (
        <div className="mb-4">
          <label className="text-sm font-medium text-foreground mb-2 block">Account</label>
          <div className="flex gap-3">
            {(['both', 'invest', 'isa'] as const).map((opt) => (
              <button
                key={opt}
                onClick={() => setAccountFilter(opt)}
                className={cn(
                  'px-3 py-1.5 rounded text-sm border transition-colors',
                  accountFilter === opt
                    ? 'border-primary-500 bg-primary-500/10 text-primary-400'
                    : 'border-border bg-transparent text-muted-foreground hover:border-primary-500/50'
                )}
              >
                {opt === 'both' ? 'Both' : opt === 'invest' ? 'Invest only' : 'ISA only'}
              </button>
            ))}
          </div>
        </div>
      )}

      {/* Action buttons */}
      {phase === 'idle' && (
        <button
          onClick={handlePreview}
          className="btn-primary flex items-center gap-2 px-4 py-2 rounded text-sm"
        >
          <FileText className="w-4 h-4" />
          Preview Import
        </button>
      )}

      {/* Loading state */}
      {(phase === 'previewing' || phase === 'importing') && (
        <div className="flex items-center gap-3 py-4">
          <Loader2 className="w-5 h-5 text-primary-400 animate-spin" />
          <span className="text-sm text-muted-foreground">
            {phase === 'previewing'
              ? 'Fetching orders from Trading 212...'
              : 'Writing trades to database...'}
          </span>
        </div>
      )}

      {/* Error state */}
      {phase === 'error' && error && (
        <div className="mt-3 p-3 bg-loss/10 border border-loss/30 rounded">
          <div className="flex items-start gap-2">
            <AlertTriangle className="w-4 h-4 text-loss mt-0.5 flex-shrink-0" />
            <div>
              <p className="text-sm font-medium text-loss">Import failed</p>
              <p className="text-xs text-loss/80 mt-1 whitespace-pre-wrap">{error}</p>
            </div>
          </div>
          <button
            onClick={handleReset}
            className="mt-3 px-3 py-1 rounded text-xs border border-border hover:bg-card-hover transition-colors"
          >
            Try again
          </button>
        </div>
      )}

      {/* Preview report */}
      {phase === 'previewed' && report && (
        <div className="mt-2 space-y-4">
          <PreviewReport report={report} />

          <div className="flex gap-3">
            <button
              onClick={handleConfirm}
              className="btn-primary flex items-center gap-2 px-4 py-2 rounded text-sm"
            >
              <CheckCircle2 className="w-4 h-4" />
              Confirm Import
            </button>
            <button
              onClick={handleReset}
              className="px-4 py-2 rounded text-sm border border-border hover:bg-card-hover transition-colors"
            >
              Cancel
            </button>
          </div>
        </div>
      )}

      {/* Done state */}
      {phase === 'done' && report && (
        <div className="mt-2 space-y-4">
          <div className="p-3 bg-gain/10 border border-gain/30 rounded">
            <div className="flex items-start gap-2">
              <CheckCircle2 className="w-4 h-4 text-gain mt-0.5" />
              <div>
                <p className="text-sm font-medium text-gain">Import complete</p>
                <p className="text-xs text-muted-foreground mt-1">
                  {report.tradeLogsWritten} trade{report.tradeLogsWritten !== 1 ? 's' : ''} imported
                  {report.positionsConfirmed > 0 && ` · ${report.positionsConfirmed} open position${report.positionsConfirmed !== 1 ? 's' : ''} confirmed`}
                  {report.skippedDuplicates > 0 && ` · ${report.skippedDuplicates} duplicate${report.skippedDuplicates !== 1 ? 's' : ''} skipped`}
                </p>
              </div>
            </div>
          </div>

          {report.errors.length > 0 && (
            <div className="p-3 bg-caution/10 border border-caution/30 rounded">
              <p className="text-xs font-medium text-caution mb-1">Warnings</p>
              {report.errors.map((e, i) => (
                <p key={i} className="text-xs text-caution/80">{e}</p>
              ))}
            </div>
          )}

          <div className="flex gap-3">
            <a
              href="/trade-log"
              className="btn-primary flex items-center gap-2 px-4 py-2 rounded text-sm"
            >
              View Trade Log
              <ArrowRight className="w-4 h-4" />
            </a>
            <button
              onClick={handleReset}
              className="px-4 py-2 rounded text-sm border border-border hover:bg-card-hover transition-colors"
            >
              Run Again
            </button>
          </div>
        </div>
      )}
    </div>
  );
}

// ── Preview Report Sub-component ─────────────────────────────────────

function PreviewReport({ report }: { report: ImportReport }) {
  const [showAllTrades, setShowAllTrades] = useState(false);

  const displayLimit = 20;
  const tradesToShow = showAllTrades
    ? report.tradePairs
    : report.tradePairs.slice(0, displayLimit);

  return (
    <div className="space-y-3">
      {/* Summary */}
      <div className="p-3 bg-primary-500/5 border border-primary-500/20 rounded">
        <p className="text-sm font-medium text-foreground mb-2">Dry Run Report — T212 History Import</p>
        <div className="grid grid-cols-2 sm:grid-cols-4 gap-2 text-xs">
          <Stat label="Accounts" value={report.accountsScanned.join(' + ') || 'none'} />
          <Stat label="Orders fetched" value={report.totalOrdersFetched} />
          <Stat label="Filled orders" value={report.filledOrders} />
          <Stat label="Trade pairs" value={report.tradePairs.length} />
        </div>
      </div>

      {/* Closed trades table */}
      {report.tradePairs.length > 0 && (
        <div>
          <p className="text-xs font-medium text-muted-foreground mb-1 uppercase tracking-wider">
            Closed Trades ({report.tradePairs.length})
          </p>
          <div className="overflow-x-auto">
            <table className="w-full text-xs">
              <thead>
                <tr className="text-left text-muted-foreground border-b border-border">
                  <th className="pb-1 pr-3">Ticker</th>
                  <th className="pb-1 pr-3">Buy</th>
                  <th className="pb-1 pr-3">Sell</th>
                  <th className="pb-1 pr-3 text-right">P&L</th>
                  <th className="pb-1 pr-3 text-right">Days</th>
                  <th className="pb-1">Exit</th>
                </tr>
              </thead>
              <tbody>
                {tradesToShow.map((t, i) => {
                  const pnl = t.realisedPnl;
                  const isWin = pnl != null && pnl > 0;
                  return (
                    <tr key={i} className="border-b border-border/30">
                      <td className="py-1 pr-3 font-medium">{t.htTicker || t.ticker}</td>
                      <td className="py-1 pr-3">{formatPrice(t.buyFillPrice)}</td>
                      <td className="py-1 pr-3">{formatPrice(t.sellFillPrice)}</td>
                      <td className={cn('py-1 pr-3 text-right', isWin ? 'text-gain' : 'text-loss')}>
                        {pnl != null ? `£${pnl.toFixed(2)}` : '—'}
                      </td>
                      <td className="py-1 pr-3 text-right">{t.holdingDays}</td>
                      <td className={cn('py-1', t.exitReason === 'STOP_HIT' ? 'text-loss' : 'text-muted-foreground')}>
                        {t.exitReason === 'STOP_HIT' ? 'Stop' : 'Manual'}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
          {report.tradePairs.length > displayLimit && !showAllTrades && (
            <button
              onClick={() => setShowAllTrades(true)}
              className="text-xs text-primary-400 hover:text-primary-300 mt-1"
            >
              Show all {report.tradePairs.length} trades
            </button>
          )}
        </div>
      )}

      {/* Open positions */}
      {report.openBuys.length > 0 && (
        <div>
          <p className="text-xs font-medium text-muted-foreground mb-1 uppercase tracking-wider">
            Open Positions ({report.openBuys.length})
          </p>
          <div className="space-y-1">
            {report.openBuys.map((ob, i) => (
              <div key={i} className="flex items-center gap-3 text-xs">
                <span className="font-medium w-16">{ob.htTicker || ob.ticker}</span>
                <span className="text-muted-foreground">Bought {formatPrice(ob.buyFillPrice)}</span>
                <span className={cn('text-xs', ob.existsInDb ? 'text-gain' : 'text-caution')}>
                  {ob.existsInDb ? '✓ Tracked' : '⚠ Not in portfolio'}
                </span>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* Unmatched */}
      {report.unmatchedSells.length > 0 && (
        <div className="p-2 bg-caution/10 border border-caution/30 rounded">
          <p className="text-xs font-medium text-caution">
            {report.unmatchedSells.length} unmatched sell{report.unmatchedSells.length !== 1 ? 's' : ''} (sells with no matching buy)
          </p>
        </div>
      )}

      {/* Tickers not in Stock table */}
      {report.tickersNotInStockTable.length > 0 && (
        <div className="p-2 bg-caution/10 border border-caution/30 rounded">
          <p className="text-xs font-medium text-caution mb-1">
            Tickers not in HybridTurtle universe ({report.tickersNotInStockTable.length})
          </p>
          <p className="text-xs text-caution/80">
            {report.tickersNotInStockTable.join(', ')}
          </p>
        </div>
      )}

      {/* Errors/warnings */}
      {report.errors.length > 0 && (
        <div className="p-2 bg-loss/10 border border-loss/30 rounded">
          {report.errors.map((e, i) => (
            <p key={i} className="text-xs text-loss/80">{e}</p>
          ))}
        </div>
      )}

      {/* Summary line */}
      <div className="text-xs text-muted-foreground">
        Would write {report.tradePairs.length} TradeLog {report.tradePairs.length === 1 ? 'entry' : 'entries'}
        {report.openBuys.filter(ob => ob.existsInDb).length > 0 &&
          ` · Confirm ${report.openBuys.filter(ob => ob.existsInDb).length} open position${report.openBuys.filter(ob => ob.existsInDb).length !== 1 ? 's' : ''}`}
      </div>
    </div>
  );
}

// ── Helpers ──────────────────────────────────────────────────────────

function Stat({ label, value }: { label: string; value: string | number }) {
  return (
    <div>
      <p className="text-muted-foreground">{label}</p>
      <p className="font-medium text-foreground">{value}</p>
    </div>
  );
}

function formatPrice(price: number): string {
  if (price >= 100) return price.toFixed(0);
  if (price >= 1) return price.toFixed(2);
  return price.toFixed(4);
}
