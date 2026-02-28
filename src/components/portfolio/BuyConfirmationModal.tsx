/**
 * DEPENDENCIES
 * Consumed by: src/components/portfolio/ReadyToBuyPanel.tsx
 * Consumes: src/lib/ready-to-buy.ts, src/lib/api-client.ts, src/lib/utils.ts,
 *           src/hooks/useWeeklyPhase.ts
 * Risk-sensitive: NO (calls POST /api/positions which enforces all server-side gates)
 * Last modified: 2026-02-28
 * Notes: Account selection + sizing preview. Position creation goes through existing
 *        /api/positions endpoint which validates risk gates, phase, regime, health.
 */

'use client';

import { useState, useMemo } from 'react';
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

  if (!isOpen) return null;

  const handleConfirm = async () => {
    if (!sizing || !candidate.scanPrice || !candidate.scanStopPrice) return;
    setSubmitting(true);
    setError(null);

    try {
      await apiRequest('/api/positions', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          userId: DEFAULT_USER_ID,
          ticker: candidate.ticker,
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
      // Brief success state before closing
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

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center">
      {/* Backdrop */}
      <div className="absolute inset-0 bg-black/60 backdrop-blur-sm" onClick={onCancel} />

      {/* Modal */}
      <div className="relative bg-navy-900 border border-border rounded-xl shadow-2xl w-full max-w-lg mx-4 animate-fade-in">
        {/* Header */}
        <div className="flex items-center justify-between p-5 border-b border-border">
          <h2 className="text-lg font-semibold text-foreground flex items-center gap-2">
            <ShoppingCart className="w-5 h-5 text-primary-400" />
            Confirm Buy — {candidate.ticker}
          </h2>
          <button
            onClick={onCancel}
            className="text-muted-foreground hover:text-foreground transition-colors"
            disabled={submitting}
            aria-label="Close"
          >
            <X className="w-5 h-5" />
          </button>
        </div>

        <div className="p-5 space-y-4">
          {/* Error display */}
          {error && (
            <div className="p-3 bg-loss/10 border border-loss/30 rounded-lg text-sm text-loss flex items-start gap-2">
              <AlertTriangle className="w-4 h-4 flex-shrink-0 mt-0.5" />
              <div>{error}</div>
            </div>
          )}

          {/* Success display */}
          {success && (
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

          {/* Actions */}
          <div className="flex justify-end gap-3 pt-2 border-t border-border">
            <button
              type="button"
              onClick={onCancel}
              disabled={submitting}
              className="px-4 py-2 text-sm text-muted-foreground hover:text-foreground transition-colors"
            >
              Cancel
            </button>
            <button
              onClick={handleConfirm}
              disabled={submitting || success || !sizing || neitherConnected}
              className={cn(
                'px-4 py-2 text-sm font-medium rounded-lg transition-all flex items-center gap-2',
                success
                  ? 'bg-profit/15 text-profit border border-profit/30'
                  : 'btn-primary'
              )}
            >
              {submitting ? (
                <>
                  <Loader2 className="w-4 h-4 animate-spin" />
                  Creating...
                </>
              ) : success ? (
                <>
                  <CheckCircle2 className="w-4 h-4" />
                  Created
                </>
              ) : (
                <>
                  <ShoppingCart className="w-4 h-4" />
                  Confirm Buy — {sizing?.shares ?? '?'} shares in {accountType.toUpperCase()}
                </>
              )}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
