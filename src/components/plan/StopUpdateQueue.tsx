'use client';

/**
 * DEPENDENCIES
 * Consumed by: /plan/page.tsx, /portfolio/positions/page.tsx
 * Consumes: /api/stops (GET, PUT), /api/stops/t212 (POST)
 * Risk-sensitive: YES — fetches and applies stop updates
 * Last modified: 2026-02-20
 * Notes: Self-fetching from GET /api/stops which uses live prices + ATR.
 *        Stops are never computed client-side here — always from the authoritative server engine.
 */

import { useState, useEffect, useCallback } from 'react';
import { formatPrice, formatR } from '@/lib/utils';
import { cn } from '@/lib/utils';
import {
  ArrowUp,
  Lock,
  Shield,
  TrendingUp,
  AlertTriangle,
  Send,
  Loader2,
  CheckCircle,
  XCircle,
  RefreshCw,
} from 'lucide-react';
import { apiRequest } from '@/lib/api-client';

// Shape returned by GET /api/stops
interface ApiRecommendation {
  positionId: string;
  ticker: string;
  currentStop: number;
  newStop: number;
  newLevel: string;
  reason: string;
}

// Re-exported so plan/page.tsx can still reference the type if needed
export interface StopUpdate {
  positionId: string;
  ticker: string;
  currentStop: number;
  recommendedStop: number;
  protectionLevel: string;
  rMultiple: number;
  currentPrice: number;
  direction: 'up' | 'hold';
  reason: string;
  priceCurrency?: string;
}

const protectionColors: Record<string, string> = {
  INITIAL: 'text-muted-foreground',
  BREAKEVEN: 'text-warning',
  LOCK_08R: 'text-blue-400',
  LOCK_1R_TRAIL: 'text-profit',
  TRAILING_ATR: 'text-primary-400',
};

interface StopUpdateQueueProps {
  userId: string;
  /** Called after any stop is successfully written so the parent can re-fetch positions */
  onApplied?: () => void;
  /** Increment to force re-fetch (e.g. after T212 sync bumps a DB stop) */
  refreshTrigger?: number;
}

interface RowState {
  status: 'idle' | 'applying' | 'success' | 'error';
  message: string | null;
  t212Status: 'idle' | 'pushing' | 'success' | 'error';
  t212Message: string | null;
}

const IDLE_ROW: RowState = { status: 'idle', message: null, t212Status: 'idle', t212Message: null };

export default function StopUpdateQueue({ userId, onApplied, refreshTrigger = 0 }: StopUpdateQueueProps) {
  const [recs, setRecs] = useState<ApiRecommendation[]>([]);
  const [loading, setLoading] = useState(true);
  const [fetchError, setFetchError] = useState<string | null>(null);

  // Per-ticker apply state and T212 preference
  const [rowStates, setRowStates] = useState<Record<string, RowState>>({});
  const [pushToT212, setPushToT212] = useState<Record<string, boolean>>({});

  const fetchRecs = useCallback(async () => {
    setLoading(true);
    setFetchError(null);
    try {
      const data = await apiRequest<ApiRecommendation[]>(`/api/stops?userId=${userId}`);
      setRecs(data);
      // Reset apply states on refresh so re-applied rows become actionable again
      setRowStates({});
    } catch (err) {
      setFetchError(err instanceof Error ? err.message : 'Failed to load stop recommendations');
    } finally {
      setLoading(false);
    }
  }, [userId]);

  useEffect(() => { fetchRecs(); }, [fetchRecs, refreshTrigger]);

  function getRow(ticker: string): RowState {
    return rowStates[ticker] ?? IDLE_ROW;
  }

  function patchRow(ticker: string, patch: Partial<RowState>) {
    setRowStates((prev) => ({ ...prev, [ticker]: { ...(prev[ticker] ?? IDLE_ROW), ...patch } }));
  }

  function wantsT212(ticker: string): boolean {
    return pushToT212[ticker] !== false; // default true
  }

  async function apply(rec: ApiRecommendation) {
    patchRow(rec.ticker, { status: 'applying', message: null, t212Status: 'idle', t212Message: null });

    try {
      // 1. Write to DB — server enforces monotonic rule
      await apiRequest('/api/stops', {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          positionId: rec.positionId,
          newStop: rec.newStop,
          reason: rec.reason,
        }),
      });

      patchRow(rec.ticker, {
        status: 'success',
        message: `Stop updated to ${formatPrice(rec.newStop)}`,
      });

      // 2. Optionally push to T212
      if (wantsT212(rec.ticker)) {
        patchRow(rec.ticker, { t212Status: 'pushing' });
        try {
          const t212Data = await apiRequest<{ message?: string }>('/api/stops/t212', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ positionId: rec.positionId, stopPrice: rec.newStop }),
          });
          patchRow(rec.ticker, {
            t212Status: 'success',
            t212Message: t212Data.message || 'Stop placed on Trading 212',
          });
        } catch {
          patchRow(rec.ticker, {
            t212Status: 'error',
            t212Message: 'T212 push failed — update your T212 app manually',
          });
        }
      }

      onApplied?.();
    } catch (err) {
      patchRow(rec.ticker, {
        status: 'error',
        message: err instanceof Error ? err.message : 'Failed to apply stop',
      });
    }
  }

  async function applyAll() {
    const pending = recs.filter((r) => getRow(r.ticker).status === 'idle');

    // Phase 1: Apply all DB stops (fast, no external rate limits)
    const t212Candidates: ApiRecommendation[] = [];
    for (const rec of pending) {
      patchRow(rec.ticker, { status: 'applying', message: null, t212Status: 'idle', t212Message: null });
      try {
        await apiRequest('/api/stops', {
          method: 'PUT',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            positionId: rec.positionId,
            newStop: rec.newStop,
            reason: rec.reason,
          }),
        });
        patchRow(rec.ticker, {
          status: 'success',
          message: `Stop updated to ${formatPrice(rec.newStop)}`,
        });
        if (wantsT212(rec.ticker)) {
          t212Candidates.push(rec);
        }
      } catch (err) {
        patchRow(rec.ticker, {
          status: 'error',
          message: err instanceof Error ? err.message : 'Failed to apply stop',
        });
      }
    }

    onApplied?.();

    // Phase 2: Bulk push to T212 via single batch call (avoids per-ticker getPendingOrders rate limit)
    if (t212Candidates.length > 0) {
      for (const rec of t212Candidates) {
        patchRow(rec.ticker, { t212Status: 'pushing' });
      }
      try {
        const data = await apiRequest<{
          results?: Array<{ ticker: string; action: string; t212Ticker: string }>;
        }>('/api/stops/t212', {
          method: 'PUT',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({}),
        });
        // Match results back to each candidate for per-row feedback
        for (const rec of t212Candidates) {
          const result = data.results?.find((r) => r.ticker === rec.ticker);
          if (result) {
            const ok = result.action === 'PLACED' || result.action.startsWith('SKIPPED');
            patchRow(rec.ticker, {
              t212Status: ok ? 'success' : 'error',
              t212Message: ok ? 'Stop placed on Trading 212' : result.action.replace('FAILED: ', ''),
            });
          } else {
            // Position not in results = already in sync or skipped
            patchRow(rec.ticker, {
              t212Status: 'success',
              t212Message: 'T212 bulk sync completed',
            });
          }
        }
      } catch {
        for (const rec of t212Candidates) {
          patchRow(rec.ticker, {
            t212Status: 'error',
            t212Message: 'T212 bulk push failed — update your T212 app manually',
          });
        }
      }
    }
  }

  const pendingCount = recs.filter((r) => getRow(r.ticker).status === 'idle').length;

  return (
    <div className="card-surface p-4">
      <div className="flex items-center justify-between mb-4">
        <h3 className="text-sm font-semibold text-foreground flex items-center gap-2">
          <Shield className="w-4 h-4 text-primary-400" />
          Stop-Loss Recommendations
        </h3>
        <div className="flex items-center gap-2">
          {!loading && (
            <button
              onClick={fetchRecs}
              className="flex items-center gap-1 text-xs text-muted-foreground hover:text-foreground transition-colors"
              title="Refresh recommendations"
            >
              <RefreshCw className="w-3 h-3" />
            </button>
          )}
          <span className="text-xs text-muted-foreground">
            {loading ? 'Loading…' : `${pendingCount} pending`}
          </span>
        </div>
      </div>

      <div className="bg-primary/10 border border-primary/30 rounded-lg p-3 mb-4 text-xs text-primary-400 font-semibold">
        Stops can only move UP — recommendations from R-based levels + trailing ATR
      </div>

      {/* Loading state */}
      {loading && (
        <div className="flex items-center justify-center gap-2 py-6 text-muted-foreground">
          <Loader2 className="w-4 h-4 animate-spin" />
          <span className="text-xs">Fetching live recommendations…</span>
        </div>
      )}

      {/* Fetch error */}
      {!loading && fetchError && (
        <div className="text-xs text-loss flex items-center gap-1 py-2">
          <AlertTriangle className="w-3 h-3" /> {fetchError}
        </div>
      )}

      {/* No upgrades needed */}
      {!loading && !fetchError && recs.length === 0 && (
        <p className="text-xs text-muted-foreground text-center py-4">
          All stops are up to date — no upgrades needed.
        </p>
      )}

      {/* Recommendations list */}
      {!loading && recs.length > 0 && (
        <>
          {/* Apply All button when multiple pending */}
          {pendingCount > 1 && (
            <button
              onClick={applyAll}
              className="w-full mb-3 text-xs py-1.5 rounded bg-profit/20 text-profit font-medium hover:bg-profit/30 transition-colors flex items-center justify-center gap-1.5"
            >
              <TrendingUp className="w-3 h-3" />
              Apply All {pendingCount} Recommendations
            </button>
          )}

          <div className="space-y-3">
            {recs.map((rec) => {
              const row = getRow(rec.ticker);
              const applied = row.status === 'success';
              const applying = row.status === 'applying';

              return (
                <div
                  key={rec.ticker}
                  className={cn(
                    'bg-navy-800 rounded-lg p-3 border',
                    !applied ? 'border-profit/30' : 'border-profit/50 opacity-75'
                  )}
                >
                  {/* Ticker + level */}
                  <div className="flex items-center justify-between mb-2">
                    <div className="flex items-center gap-2">
                      <span className="text-sm font-bold text-foreground">{rec.ticker}</span>
                      <span className={cn(
                        'text-[10px] px-1.5 py-0.5 rounded font-mono',
                        protectionColors[rec.newLevel] || 'text-muted-foreground'
                      )}>
                        {rec.newLevel.replace(/_/g, ' ')}
                      </span>
                    </div>
                  </div>

                  {/* Current → Recommended */}
                  <div className="grid grid-cols-3 gap-2 text-xs mb-2">
                    <div>
                      <span className="text-muted-foreground">Current Stop</span>
                      <div className="font-mono text-foreground">{formatPrice(rec.currentStop)}</div>
                    </div>
                    <div className="text-center">
                      <ArrowUp className="w-5 h-5 text-profit mx-auto mt-2" />
                    </div>
                    <div className="text-right">
                      <span className="text-muted-foreground">Move To</span>
                      <div className="font-mono text-profit font-semibold">{formatPrice(rec.newStop)}</div>
                    </div>
                  </div>

                  {/* Reason from stop-manager */}
                  <div className="text-[11px] text-muted-foreground mb-3">{rec.reason}</div>

                  {!applied && (
                    <div className="space-y-2">
                      {/* T212 toggle */}
                      <div className="flex items-center gap-2 text-xs">
                        <input
                          type="checkbox"
                          id={`t212-${rec.ticker}`}
                          checked={wantsT212(rec.ticker)}
                          onChange={(e) =>
                            setPushToT212((prev) => ({ ...prev, [rec.ticker]: e.target.checked }))
                          }
                          className="rounded border-border bg-navy-700"
                        />
                        <label
                          htmlFor={`t212-${rec.ticker}`}
                          className="cursor-pointer flex items-center gap-1 text-muted-foreground hover:text-foreground transition-colors"
                        >
                          <Send className="w-3 h-3 text-primary-400" />
                          Also push to Trading 212
                        </label>
                      </div>

                      {/* Single apply button — stop is pre-determined, no input needed */}
                      <button
                        disabled={applying}
                        onClick={() => apply(rec)}
                        className="w-full text-xs py-1.5 rounded bg-profit/20 text-profit font-medium hover:bg-profit/30 transition-colors disabled:opacity-50 flex items-center justify-center gap-1.5"
                      >
                        {applying ? (
                          <><Loader2 className="w-3 h-3 animate-spin" /> Applying…</>
                        ) : (
                          <><TrendingUp className="w-3 h-3" /> Apply {rec.ticker} → {formatPrice(rec.newStop)}</>
                        )}
                      </button>

                      {row.status === 'error' && row.message && (
                        <p className="text-xs text-loss flex items-center gap-1">
                          <AlertTriangle className="w-3 h-3" /> {row.message}
                        </p>
                      )}
                    </div>
                  )}

                  {/* Post-apply feedback */}
                  {applied && (
                    <div className="space-y-1">
                      <p className="text-xs text-profit flex items-center gap-1">
                        <CheckCircle className="w-3 h-3" /> {row.message}
                      </p>
                      {wantsT212(rec.ticker) && row.t212Status === 'pushing' && (
                        <p className="text-xs text-primary-400 flex items-center gap-1">
                          <Loader2 className="w-3 h-3 animate-spin" /> Pushing to Trading 212…
                        </p>
                      )}
                      {row.t212Status === 'success' && row.t212Message && (
                        <p className="text-xs text-profit flex items-center gap-1">
                          <Send className="w-3 h-3" /> {row.t212Message}
                        </p>
                      )}
                      {row.t212Status === 'error' && row.t212Message && (
                        <p className="text-xs text-warning flex items-center gap-1">
                          <XCircle className="w-3 h-3" /> {row.t212Message}
                        </p>
                      )}
                    </div>
                  )}
                </div>
              );
            })}
          </div>
        </>
      )}
    </div>
  );
}
