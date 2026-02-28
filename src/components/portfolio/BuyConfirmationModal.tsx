/**
 * DEPENDENCIES
 * Consumed by: src/components/portfolio/ReadyToBuyPanel.tsx
 * Consumes: src/lib/ready-to-buy.ts, src/lib/api-client.ts, src/lib/utils.ts,
 *           src/hooks/useWeeklyPhase.ts
 * Risk-sensitive: YES (calls POST /api/positions/execute which places live T212 orders)
 * Last modified: 2026-02-28
 * Notes: Two modes:
 *        1. T212 Execute: SSE-streamed 3-phase (buy → fill → stop) with full audit logging
 *        2. Manual fallback: Creates DB position only (no broker order)
 *        Modal is NOT dismissable during execution. Stop failures show a red alert
 *        that requires explicit acknowledgement.
 */

'use client';

import { useState, useMemo, useRef, useCallback, useEffect } from 'react';
import { apiRequest } from '@/lib/api-client';
import { formatPrice, formatCurrency, cn } from '@/lib/utils';
import { getBuyButtonState } from '@/lib/ready-to-buy';
import { getDayOfWeek } from '@/lib/utils';
import type { TriggerMetCandidate } from '@/lib/ready-to-buy';
import type { PositionSizingResult } from '@/types';
import {
  X,
  ShoppingCart,
  AlertTriangle,
  Shield,
  Info,
  CheckCircle2,
  Loader2,
  Zap,
  AlertOctagon,
} from 'lucide-react';

const DEFAULT_USER_ID = 'default-user';

// ── Types ────────────────────────────────────────────────────

interface RiskBudgetData {
  usedRiskPercent: number;
  availableRiskPercent: number;
  maxRiskPercent: number;
  usedPositions: number;
  maxPositions: number;
}

/** SSE phase update from /api/positions/execute */
interface ExecutionPhase {
  phase: string;
  status: 'pending' | 'running' | 'success' | 'failed' | 'skipped';
  message?: string;
  orderId?: number;
  filledQuantity?: number;
  filledPrice?: number;
}

interface BuyConfirmationModalProps {
  candidate: TriggerMetCandidate;
  riskBudget: RiskBudgetData | null;
  equity: number;
  investConnected: boolean;
  isaConnected: boolean;
  /** Position sizer from useRiskProfile().sizePosition */
  sizePosition: (entryPrice: number, stopPrice: number) => PositionSizingResult;
  isOpen: boolean;
  onConfirm: () => Promise<void>;
  onCancel: () => void;
}

// ── Execution Phase Labels (novice-friendly) ─────────────────

const PHASE_LABELS: Record<string, string> = {
  BUY_PLACED: 'Placing buy order',
  BUY_POLLING: 'Waiting for fill',
  STOP_PLACED: 'Setting stop-loss',
  DB_POSITION: 'Saving position',
};

// ── Component ────────────────────────────────────────────────

export default function BuyConfirmationModal({
  candidate,
  riskBudget,
  equity,
  investConnected,
  isaConnected,
  sizePosition,
  isOpen,
  onConfirm,
  onCancel,
}: BuyConfirmationModalProps) {
  const [accountType, setAccountType] = useState<'invest' | 'isa'>(
    investConnected ? 'invest' : isaConnected ? 'isa' : 'invest'
  );
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState(false);

  // ── T212 Execution State ──
  const [executing, setExecuting] = useState(false);
  const [phases, setPhases] = useState<ExecutionPhase[]>([]);
  const [currentPhaseIdx, setCurrentPhaseIdx] = useState(-1);
  const [criticalWarning, setCriticalWarning] = useState<string | null>(null);
  const [criticalAcknowledged, setCriticalAcknowledged] = useState(false);
  const [executionResult, setExecutionResult] = useState<{
    orderId?: number;
    filledQuantity?: number;
    filledPrice?: number;
    stopFailed?: boolean;
  } | null>(null);

  const abortRef = useRef<AbortController | null>(null);

  const dayOfWeek = getDayOfWeek();
  const buttonState = getBuyButtonState(dayOfWeek);

  // Position sizing
  const sizing = useMemo<PositionSizingResult | null>(() => {
    try {
      if (!candidate.scanPrice || !candidate.scanStopPrice) return null;
      if (candidate.scanStopPrice >= candidate.scanPrice) return null;
      return sizePosition(candidate.scanPrice, candidate.scanStopPrice);
    } catch {
      return null;
    }
  }, [candidate.scanPrice, candidate.scanStopPrice, sizePosition]);

  // UK ticker detection for ISA hint
  const isUKTicker = candidate.ticker.endsWith('.L');
  const showISAHint = isUKTicker && accountType === 'invest' && isaConnected;
  // Neither account connected
  const neitherConnected = !investConnected && !isaConnected;

  // Can we do T212 auto-execute? Need connected account + t212 ticker data
  // For now we always have t212Ticker from the cross-ref data if T212 is connected
  const canAutoExecute = (accountType === 'invest' ? investConnected : isaConnected);

  // Modal is not dismissable during execution
  const canDismiss = !executing || (executing && success && !criticalWarning) || (criticalWarning && criticalAcknowledged);

  // Clean up SSE on unmount
  useEffect(() => {
    return () => {
      abortRef.current?.abort();
    };
  }, []);

  if (!isOpen) return null;

  // ── Manual Buy (existing legacy path — DB position only) ──

  const handleManualConfirm = async () => {
    if (!sizing || !candidate.scanPrice || !candidate.scanStopPrice) return;
    setSubmitting(true);
    setError(null);

    try {
      await apiRequest('/api/positions', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          userId: DEFAULT_USER_ID,
          stockId: candidate.ticker, // resolved server-side
          entryPrice: candidate.scanPrice,
          stopLoss: candidate.scanStopPrice,
          shares: sizing.shares,
          accountType,
          source: 'manual',
          sleeve: candidate.sleeve || 'CORE',
          bqsScore: candidate.dualBQS,
          fwsScore: candidate.dualFWS,
          ncsScore: candidate.dualNCS,
          dualScoreAction: candidate.dualAction,
          scanStatus: candidate.scanStatus,
          rankScore: candidate.scanRankScore,
        }),
      });

      setSuccess(true);
      setTimeout(async () => {
        await onConfirm();
      }, 800);
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Failed to create position';
      setError(message);
    } finally {
      setSubmitting(false);
    }
  };

  // ── T212 Auto-Execute (SSE 3-phase) ──

  const handleAutoExecute = useCallback(async () => {
    if (!sizing || !candidate.scanPrice || !candidate.scanStopPrice) return;
    setExecuting(true);
    setError(null);
    setCriticalWarning(null);
    setCriticalAcknowledged(false);
    setExecutionResult(null);

    const controller = new AbortController();
    abortRef.current = controller;

    try {
      const response = await fetch('/api/positions/execute', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          userId: DEFAULT_USER_ID,
          stockId: candidate.ticker,                              // Yahoo ticker — resolved to stockId in execute route
          ticker: candidate.yahooTicker || candidate.ticker,      // Yahoo format for logging
          t212Ticker: candidate.ticker,                            // Will be resolved from DB by t212Ticker field
          quantity: sizing.shares,
          stopPrice: candidate.scanStopPrice,
          entryPrice: candidate.scanPrice,
          accountType,
          bqsScore: candidate.dualBQS,
          fwsScore: candidate.dualFWS,
          ncsScore: candidate.dualNCS,
          dualScoreAction: candidate.dualAction,
          scanStatus: candidate.scanStatus,
          rankScore: candidate.scanRankScore,
        }),
        signal: controller.signal,
      });

      if (!response.ok) {
        const errData = await response.json();
        setError(errData.error || `Server error ${response.status}`);
        setExecuting(false);
        return;
      }

      // Read SSE stream
      const reader = response.body?.getReader();
      if (!reader) {
        setError('No response stream');
        setExecuting(false);
        return;
      }

      const decoder = new TextDecoder();
      let buffer = '';

      while (true) {
        const { done, value } = await reader.read();
        if (done) break;

        buffer += decoder.decode(value, { stream: true });
        const lines = buffer.split('\n');
        buffer = lines.pop() || ''; // keep incomplete line

        let eventType = '';
        for (const line of lines) {
          if (line.startsWith('event: ')) {
            eventType = line.slice(7).trim();
          } else if (line.startsWith('data: ') && eventType) {
            try {
              const data = JSON.parse(line.slice(6));

              if (eventType === 'phase') {
                setPhases(data.phases || []);
                setCurrentPhaseIdx(data.currentPhase ?? -1);
                if (data.critical && data.warning) {
                  setCriticalWarning(data.warning);
                }
              } else if (eventType === 'complete') {
                setPhases(data.phases || []);
                setExecutionResult({
                  orderId: data.position?.orderId,
                  filledQuantity: data.position?.filledQuantity,
                  filledPrice: data.position?.filledPrice,
                  stopFailed: data.stopFailed,
                });
                if (data.stopFailed) {
                  setCriticalWarning(
                    `CRITICAL: Stop-loss was NOT placed on T212. You must set a stop at ${candidate.scanStopPrice?.toFixed(4)} IMMEDIATELY in the T212 app.`
                  );
                }
                setSuccess(true);
              } else if (eventType === 'error') {
                if (data.critical) {
                  setCriticalWarning(data.error);
                } else {
                  setError(data.error);
                }
                // Update phases if available
                if (data.phases) setPhases(data.phases);
              }
            } catch {
              // Ignore JSON parse errors in stream
            }
            eventType = '';
          }
        }
      }
    } catch (err) {
      if ((err as Error).name !== 'AbortError') {
        setError((err as Error).message || 'Execution failed');
      }
    } finally {
      setExecuting(false);
      abortRef.current = null;
    }
  }, [sizing, candidate, accountType]);

  // ── Close handler (respects dismissal rules) ──

  const handleClose = () => {
    if (!canDismiss) return;
    if (success) {
      onConfirm();
    } else {
      onCancel();
    }
  };

  // ── Phase Step UI ──

  const PhaseStep = ({ phase, index }: { phase: ExecutionPhase; index: number }) => {
    const label = PHASE_LABELS[phase.phase] || phase.phase;
    const stepNum = index + 1;

    return (
      <div className={cn(
        'flex items-center gap-3 p-3 rounded-lg transition-all',
        phase.status === 'running' && 'bg-primary-400/10 border border-primary-400/30',
        phase.status === 'success' && 'bg-profit/10 border border-profit/30',
        phase.status === 'failed' && 'bg-loss/10 border border-loss/30',
        phase.status === 'skipped' && 'bg-navy-800/30 border border-border/20 opacity-60',
        phase.status === 'pending' && 'bg-navy-800/30 border border-border/20',
      )}>
        {/* Step indicator */}
        <div className={cn(
          'w-8 h-8 rounded-full flex items-center justify-center text-sm font-bold flex-shrink-0',
          phase.status === 'running' && 'bg-primary-400/20 text-primary-400',
          phase.status === 'success' && 'bg-profit/20 text-profit',
          phase.status === 'failed' && 'bg-loss/20 text-loss',
          phase.status === 'skipped' && 'bg-navy-700/50 text-muted-foreground',
          phase.status === 'pending' && 'bg-navy-700/50 text-muted-foreground',
        )}>
          {phase.status === 'running' ? (
            <Loader2 className="w-4 h-4 animate-spin" />
          ) : phase.status === 'success' ? (
            <CheckCircle2 className="w-4 h-4" />
          ) : phase.status === 'failed' ? (
            <AlertTriangle className="w-4 h-4" />
          ) : (
            stepNum
          )}
        </div>

        {/* Label and message */}
        <div className="min-w-0 flex-1">
          <div className={cn(
            'text-sm font-medium',
            phase.status === 'running' && 'text-primary-400',
            phase.status === 'success' && 'text-profit',
            phase.status === 'failed' && 'text-loss',
            (phase.status === 'pending' || phase.status === 'skipped') && 'text-muted-foreground',
          )}>
            Step {stepNum} of {phases.length}: {label}
            {phase.status === 'running' && '...'}
          </div>
          {phase.message && phase.status !== 'pending' && (
            <div className="text-xs text-muted-foreground mt-0.5 truncate">
              {phase.message}
            </div>
          )}
        </div>

        {/* Status icon */}
        <div className="flex-shrink-0">
          {phase.status === 'running' && <span className="text-xs text-primary-400">⏳</span>}
          {phase.status === 'success' && <span className="text-xs text-profit">✓</span>}
          {phase.status === 'failed' && <span className="text-xs text-loss">✗</span>}
          {phase.status === 'skipped' && <span className="text-xs text-muted-foreground">—</span>}
        </div>
      </div>
    );
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center">
      {/* Backdrop — not clickable during execution */}
      <div
        className="absolute inset-0 bg-black/60 backdrop-blur-sm"
        onClick={canDismiss ? handleClose : undefined}
      />

      {/* Modal */}
      <div className="relative bg-navy-900 border border-border rounded-xl shadow-2xl w-full max-w-lg mx-4 animate-fade-in max-h-[90vh] overflow-y-auto">
        {/* Header */}
        <div className="flex items-center justify-between p-5 border-b border-border sticky top-0 bg-navy-900 z-10">
          <h2 className="text-lg font-semibold text-foreground flex items-center gap-2">
            {executing ? (
              <Zap className="w-5 h-5 text-primary-400" />
            ) : (
              <ShoppingCart className="w-5 h-5 text-primary-400" />
            )}
            {executing ? 'Executing Trade' : 'Confirm Buy'} — {candidate.ticker}
          </h2>
          {canDismiss && (
            <button
              onClick={handleClose}
              className="text-muted-foreground hover:text-foreground transition-colors"
              aria-label="Close"
            >
              <X className="w-5 h-5" />
            </button>
          )}
        </div>

        <div className="p-5 space-y-4">
          {/* ══════════════════════════════════════════════════
              EXECUTION VIEW — 3-step progress
             ══════════════════════════════════════════════════ */}
          {(executing || executionResult) && phases.length > 0 ? (
            <div className="space-y-3">
              {phases.map((phase, i) => (
                <PhaseStep key={phase.phase} phase={phase} index={i} />
              ))}

              {/* Critical warning — cannot be dismissed without acknowledgement */}
              {criticalWarning && (
                <div className="p-4 bg-loss/15 border-2 border-loss rounded-lg space-y-3">
                  <div className="flex items-start gap-2 text-loss">
                    <AlertOctagon className="w-5 h-5 flex-shrink-0 mt-0.5" />
                    <div>
                      <div className="font-bold text-sm">CRITICAL — Manual Action Required</div>
                      <p className="text-xs mt-1">{criticalWarning}</p>
                    </div>
                  </div>
                  {!criticalAcknowledged && (
                    <button
                      onClick={() => setCriticalAcknowledged(true)}
                      className="w-full py-2 bg-loss/20 hover:bg-loss/30 text-loss text-sm font-semibold rounded-lg border border-loss/40 transition-colors"
                    >
                      I understand — I will set the stop manually
                    </button>
                  )}
                </div>
              )}

              {/* Success summary */}
              {success && executionResult && !criticalWarning && (
                <div className="p-4 bg-profit/10 border border-profit/30 rounded-lg">
                  <div className="flex items-center gap-2 text-profit text-sm font-semibold">
                    <CheckCircle2 className="w-4 h-4" />
                    Trade Executed Successfully
                  </div>
                  <div className="grid grid-cols-2 gap-2 mt-2 text-xs">
                    <div>
                      <span className="text-muted-foreground">Filled:</span>{' '}
                      <span className="text-foreground font-mono">
                        {executionResult.filledQuantity} shares
                      </span>
                    </div>
                    <div>
                      <span className="text-muted-foreground">Price:</span>{' '}
                      <span className="text-foreground font-mono">
                        {executionResult.filledPrice?.toFixed(4)}
                      </span>
                    </div>
                    <div>
                      <span className="text-muted-foreground">Order ID:</span>{' '}
                      <span className="text-foreground font-mono">{executionResult.orderId}</span>
                    </div>
                  </div>
                </div>
              )}

              {/* Error during execution */}
              {error && !criticalWarning && (
                <div className="p-3 bg-loss/10 border border-loss/30 rounded-lg text-sm text-loss flex items-start gap-2">
                  <AlertTriangle className="w-4 h-4 flex-shrink-0 mt-0.5" />
                  <div>{error}</div>
                </div>
              )}

              {/* Close button after execution completes */}
              {!executing && canDismiss && (
                <div className="pt-2 border-t border-border">
                  <button
                    onClick={handleClose}
                    className={cn(
                      'w-full py-2.5 text-sm font-medium rounded-lg transition-colors',
                      success && !criticalWarning
                        ? 'bg-profit/15 text-profit hover:bg-profit/20'
                        : 'bg-navy-800 text-foreground hover:bg-navy-700'
                    )}
                  >
                    {success ? 'Done — Close' : 'Close'}
                  </button>
                </div>
              )}
            </div>
          ) : (
            /* ══════════════════════════════════════════════════
               CONFIRMATION VIEW — Pre-trade details
              ══════════════════════════════════════════════════ */
            <>
              {/* Error display */}
              {error && (
                <div className="p-3 bg-loss/10 border border-loss/30 rounded-lg text-sm text-loss flex items-start gap-2">
                  <AlertTriangle className="w-4 h-4 flex-shrink-0 mt-0.5" />
                  <div>{error}</div>
                </div>
              )}

              {/* Success display (manual mode) */}
              {success && !executionResult && (
                <div className="p-3 bg-profit/10 border border-profit/30 rounded-lg text-sm text-profit flex items-center gap-2">
                  <CheckCircle2 className="w-4 h-4" />
                  Position created successfully
                </div>
              )}

              {/* Candidate details */}
              <div className="grid grid-cols-2 gap-x-6 gap-y-2 text-sm">
                <div>
                  <span className="text-muted-foreground text-xs">Ticker</span>
                  <div className="font-mono font-semibold text-foreground">{candidate.ticker}</div>
                </div>
                <div>
                  <span className="text-muted-foreground text-xs">Name</span>
                  <div className="text-foreground truncate">{candidate.name}</div>
                </div>
                <div>
                  <span className="text-muted-foreground text-xs">Entry Price</span>
                  <div className="font-mono text-foreground">
                    {formatPrice(candidate.scanPrice ?? 0, candidate.priceCurrency)}
                  </div>
                </div>
                <div>
                  <span className="text-muted-foreground text-xs">Stop Level</span>
                  <div className="font-mono text-loss">
                    {formatPrice(candidate.scanStopPrice ?? 0, candidate.priceCurrency)}
                  </div>
                </div>
                <div>
                  <span className="text-muted-foreground text-xs">Risk/Share</span>
                  <div className="font-mono text-foreground">
                    {candidate.scanPrice && candidate.scanStopPrice
                      ? formatPrice(candidate.scanPrice - candidate.scanStopPrice, candidate.priceCurrency)
                      : '—'}
                  </div>
                </div>
                <div>
                  <span className="text-muted-foreground text-xs">Sleeve</span>
                  <div className="text-foreground">{candidate.sleeve || 'CORE'}</div>
                </div>
              </div>

              {/* Scores */}
              <div className="flex gap-4 text-xs font-mono py-2 px-3 bg-navy-800/50 rounded-lg">
                <span>
                  BQS <span className="text-foreground">{candidate.dualBQS?.toFixed(0) ?? '—'}</span>
                </span>
                <span>
                  FWS{' '}
                  <span className={cn(
                    candidate.dualFWS != null && candidate.dualFWS <= 30 ? 'text-profit' :
                    candidate.dualFWS != null && candidate.dualFWS <= 50 ? 'text-amber-400' :
                    candidate.dualFWS != null ? 'text-loss' : 'text-muted-foreground'
                  )}>
                    {candidate.dualFWS?.toFixed(0) ?? '—'}
                  </span>
                </span>
                <span>
                  NCS{' '}
                  <span className={cn(
                    candidate.dualNCS != null && candidate.dualNCS >= 70 ? 'text-profit' :
                    candidate.dualNCS != null && candidate.dualNCS >= 50 ? 'text-amber-400' :
                    candidate.dualNCS != null ? 'text-loss' : 'text-muted-foreground'
                  )}>
                    {candidate.dualNCS?.toFixed(0) ?? '—'}
                  </span>
                </span>
              </div>

              {/* Position sizing summary */}
              {sizing ? (
                <div className="bg-navy-800/70 border border-border rounded-lg p-4 space-y-2">
                  <h3 className="text-xs font-semibold text-muted-foreground uppercase tracking-wider flex items-center gap-1.5">
                    <Shield className="w-3 h-3" />
                    Position Sizing
                  </h3>
                  <div className="grid grid-cols-2 gap-x-6 gap-y-1.5 text-sm">
                    <div className="flex justify-between">
                      <span className="text-muted-foreground text-xs">Shares</span>
                      <span className="font-mono text-foreground">{sizing.shares}</span>
                    </div>
                    <div className="flex justify-between">
                      <span className="text-muted-foreground text-xs">Total cost</span>
                      <span className="font-mono text-foreground">{formatCurrency(sizing.totalCost)}</span>
                    </div>
                    <div className="flex justify-between">
                      <span className="text-muted-foreground text-xs">Risk (£)</span>
                      <span className="font-mono text-loss">{formatCurrency(sizing.riskDollars)}</span>
                    </div>
                    <div className="flex justify-between">
                      <span className="text-muted-foreground text-xs">Risk (%)</span>
                      <span className="font-mono text-foreground">{sizing.riskPercent.toFixed(2)}%</span>
                    </div>
                  </div>
                </div>
              ) : (
                <div className="text-sm text-amber-400 flex items-center gap-2">
                  <AlertTriangle className="w-4 h-4" />
                  Could not calculate position size — check entry/stop values
                </div>
              )}

              {/* Risk budget context */}
              {riskBudget && (
                <div className="text-xs text-muted-foreground flex flex-wrap gap-3">
                  <span>
                    Slots: {riskBudget.usedPositions}/{riskBudget.maxPositions}
                  </span>
                  <span>
                    Risk: {riskBudget.usedRiskPercent.toFixed(1)}% of {riskBudget.maxRiskPercent}% used
                  </span>
                  <span>
                    Equity: {formatCurrency(equity)}
                  </span>
                </div>
              )}

              {/* Account selection */}
              <div className="space-y-2">
                <h3 className="text-xs font-semibold text-muted-foreground uppercase tracking-wider">
                  T212 Account
                </h3>

                {neitherConnected ? (
                  <div className="p-3 bg-loss/10 border border-loss/30 rounded-lg text-sm text-loss flex items-center gap-2">
                    <AlertTriangle className="w-4 h-4" />
                    No Trading 212 account connected — go to Settings to connect.
                  </div>
                ) : (
                  <div className="flex gap-3">
                    {/* Invest radio */}
                    <label
                      className={cn(
                        'flex-1 flex items-center gap-3 p-3 rounded-lg border cursor-pointer transition-all',
                        accountType === 'invest'
                          ? 'border-primary-400 bg-primary-400/10'
                          : 'border-border bg-navy-800/30',
                        !investConnected && 'opacity-50 cursor-not-allowed'
                      )}
                    >
                      <input
                        type="radio"
                        name="accountType"
                        value="invest"
                        checked={accountType === 'invest'}
                        onChange={() => setAccountType('invest')}
                        disabled={!investConnected}
                        className="sr-only"
                      />
                      <div
                        className={cn(
                          'w-3 h-3 rounded-full border-2',
                          accountType === 'invest'
                            ? 'border-primary-400 bg-primary-400'
                            : 'border-muted-foreground'
                        )}
                      />
                      <div>
                        <div className="text-sm font-medium text-foreground flex items-center gap-2">
                          Invest
                          <span
                            className={cn(
                              'w-2 h-2 rounded-full',
                              investConnected ? 'bg-profit' : 'bg-loss'
                            )}
                          />
                        </div>
                        <div className="text-[10px] text-muted-foreground">
                          {investConnected ? 'Connected' : 'Not connected'}
                        </div>
                      </div>
                    </label>

                    {/* ISA radio */}
                    <label
                      className={cn(
                        'flex-1 flex items-center gap-3 p-3 rounded-lg border cursor-pointer transition-all',
                        accountType === 'isa'
                          ? 'border-primary-400 bg-primary-400/10'
                          : 'border-border bg-navy-800/30',
                        !isaConnected && 'opacity-50 cursor-not-allowed'
                      )}
                    >
                      <input
                        type="radio"
                        name="accountType"
                        value="isa"
                        checked={accountType === 'isa'}
                        onChange={() => setAccountType('isa')}
                        disabled={!isaConnected}
                        className="sr-only"
                      />
                      <div
                        className={cn(
                          'w-3 h-3 rounded-full border-2',
                          accountType === 'isa'
                            ? 'border-primary-400 bg-primary-400'
                            : 'border-muted-foreground'
                        )}
                      />
                      <div>
                        <div className="text-sm font-medium text-foreground flex items-center gap-2">
                          ISA
                          <span
                            className={cn(
                              'w-2 h-2 rounded-full',
                              isaConnected ? 'bg-profit' : 'bg-loss'
                            )}
                          />
                        </div>
                        <div className="text-[10px] text-muted-foreground">
                          {isaConnected ? 'Connected' : 'Not connected'}
                        </div>
                      </div>
                    </label>
                  </div>
                )}

                {/* ISA allowance note */}
                {accountType === 'isa' && isaConnected && (
                  <p className="text-[10px] text-muted-foreground flex items-center gap-1">
                    <Info className="w-3 h-3" />
                    Counts towards ISA allowance
                  </p>
                )}

                {/* UK ticker in Invest mismatch warning */}
                {showISAHint && (
                  <div className="p-2 bg-amber-500/10 border border-amber-500/30 rounded-lg text-xs text-amber-400 flex items-center gap-2">
                    <AlertTriangle className="w-3.5 h-3.5 flex-shrink-0" />
                    UK stocks are typically held in ISA for tax efficiency
                  </div>
                )}
              </div>

              {/* Mid-week advisory */}
              {buttonState.color === 'amber' && (
                <div className="p-2 bg-amber-500/10 border border-amber-500/30 rounded-lg text-xs text-amber-400 flex items-center gap-2">
                  <Info className="w-3.5 h-3.5 flex-shrink-0" />
                  {buttonState.tooltip}
                </div>
              )}

              {/* Actions — two buttons: Auto Execute + Manual Record */}
              <div className="flex flex-col gap-3 pt-2 border-t border-border">
                {/* Primary: Auto Execute on T212 */}
                {canAutoExecute && (
                  <button
                    onClick={handleAutoExecute}
                    disabled={submitting || success || !sizing || neitherConnected}
                    className="w-full px-4 py-3 text-sm font-medium rounded-lg transition-all flex items-center justify-center gap-2 bg-emerald-600 hover:bg-emerald-500 text-white"
                  >
                    <Zap className="w-4 h-4" />
                    Execute on T212 — {sizing?.shares ?? '?'} shares in {accountType.toUpperCase()}
                  </button>
                )}

                {/* Secondary: Manual record only */}
                <div className="flex justify-between gap-3">
                  <button
                    type="button"
                    onClick={onCancel}
                    disabled={submitting}
                    className="px-4 py-2 text-sm text-muted-foreground hover:text-foreground transition-colors"
                  >
                    Cancel
                  </button>
                  <button
                    onClick={handleManualConfirm}
                    disabled={submitting || success || !sizing || neitherConnected}
                    className={cn(
                      'px-4 py-2 text-sm font-medium rounded-lg transition-all flex items-center gap-2',
                      success
                        ? 'bg-profit/15 text-profit border border-profit/30'
                        : 'bg-navy-800 hover:bg-navy-700 text-foreground border border-border'
                    )}
                  >
                    {submitting ? (
                      <>
                        <Loader2 className="w-4 h-4 animate-spin" />
                        Saving...
                      </>
                    ) : success ? (
                      <>
                        <CheckCircle2 className="w-4 h-4" />
                        Created
                      </>
                    ) : (
                      <>
                        <ShoppingCart className="w-4 h-4" />
                        Record Only (manual buy)
                      </>
                    )}
                  </button>
                </div>
              </div>
            </>
          )}
        </div>
      </div>
    </div>
  );
}
