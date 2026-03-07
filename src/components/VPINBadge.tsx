/**
 * DEPENDENCIES
 * Consumed by: TodayPanel.tsx (advanced view)
 * Consumes: /api/signals/vpin (GET)
 * Risk-sensitive: NO — display only
 * Last modified: 2026-03-07
 * Notes: Shows order flow imbalance as a directional indicator.
 *        Green = buying pressure, Red = selling pressure.
 */

'use client';

import { useState, useEffect } from 'react';
import { cn } from '@/lib/utils';
import { ArrowUpRight, ArrowDownRight, Minus } from 'lucide-react';

// ── Types ────────────────────────────────────────────────────

interface VPINData {
  vpin: number;
  dofi: number;
  signal: string;
  ncsAdjustment: number;
  loading: boolean;
  hasResult: boolean;
}

// ── Hook ─────────────────────────────────────────────────────

export function useVPIN(ticker: string | null | undefined): VPINData {
  const [data, setData] = useState<VPINData>({
    vpin: 0, dofi: 0, signal: 'NEUTRAL', ncsAdjustment: 0,
    loading: !!ticker, hasResult: false,
  });

  useEffect(() => {
    if (!ticker) { setData(prev => ({ ...prev, loading: false })); return; }
    let cancelled = false;

    const fetchVPIN = async () => {
      try {
        const res = await fetch(`/api/signals/vpin?ticker=${encodeURIComponent(ticker)}`);
        if (!res.ok) { if (!cancelled) setData(prev => ({ ...prev, loading: false })); return; }
        const json = await res.json();
        if (cancelled) return;
        if (json.ok && json.data) {
          setData({
            vpin: json.data.vpin,
            dofi: json.data.dofi,
            signal: json.data.signal,
            ncsAdjustment: json.data.ncsAdjustment,
            loading: false,
            hasResult: json.data.hasResult !== false,
          });
        } else {
          setData(prev => ({ ...prev, loading: false }));
        }
      } catch {
        if (!cancelled) setData(prev => ({ ...prev, loading: false }));
      }
    };

    fetchVPIN();
    return () => { cancelled = true; };
  }, [ticker]);

  return data;
}

// ── Signal Styles ────────────────────────────────────────────

const signalStyles: Record<string, { text: string; bg: string; border: string; icon: typeof ArrowUpRight; label: string }> = {
  STRONG_BUY: { text: 'text-emerald-400', bg: 'bg-emerald-500/10', border: 'border-emerald-500/30', icon: ArrowUpRight, label: 'Informed Buying' },
  BUY: { text: 'text-emerald-400', bg: 'bg-emerald-500/10', border: 'border-emerald-500/20', icon: ArrowUpRight, label: 'Informed Buying' },
  NEUTRAL: { text: 'text-muted-foreground', bg: 'bg-navy-800/40', border: 'border-border/30', icon: Minus, label: '' },
  SELL: { text: 'text-red-400', bg: 'bg-red-500/10', border: 'border-red-500/20', icon: ArrowDownRight, label: 'Informed Selling' },
  STRONG_SELL: { text: 'text-red-400', bg: 'bg-red-500/10', border: 'border-red-500/30', icon: ArrowDownRight, label: 'Informed Selling' },
  UNINFORMED: { text: 'text-muted-foreground', bg: 'bg-navy-800/30', border: 'border-border/20', icon: Minus, label: 'Low VPIN' },
};

// ── Component ────────────────────────────────────────────────

interface VPINBadgeProps {
  data: VPINData;
  compact?: boolean;
}

export default function VPINBadge({ data, compact = false }: VPINBadgeProps) {
  if (!data.hasResult) return null;

  // NEUTRAL: no badge shown (intentional — keep card clean)
  if (data.signal === 'NEUTRAL') return null;

  const style = signalStyles[data.signal] ?? signalStyles.NEUTRAL;
  const Icon = style.icon;
  const vpinPct = Math.round(data.vpin * 100);

  // UNINFORMED: grey "Low VPIN"
  if (data.signal === 'UNINFORMED') {
    return (
      <span className={cn('inline-flex items-center gap-1 px-1.5 py-0.5 rounded text-[10px] font-mono border', style.bg, style.border, style.text)}>
        Low VPIN
      </span>
    );
  }

  if (compact) {
    return (
      <span className={cn('inline-flex items-center gap-0.5 px-1.5 py-0.5 rounded text-[10px] font-mono border', style.bg, style.border, style.text)}>
        <Icon className="w-3 h-3" />
        VPIN: {vpinPct}% {style.label}
      </span>
    );
  }

  return (
    <div className={cn('inline-flex items-center gap-1.5 px-2 py-1 rounded-lg border', style.bg, style.border)}>
      <Icon className={cn('w-3.5 h-3.5', style.text)} />
      <div className="text-[10px]">
        <span className={cn('font-medium', style.text)}>
          VPIN: {vpinPct}% {data.signal === 'SELL' || data.signal === 'STRONG_SELL' ? '↓' : '↑'} {style.label}
        </span>
      </div>
      {data.ncsAdjustment !== 0 && (
        <span className={cn('text-[9px] font-mono', data.ncsAdjustment > 0 ? 'text-emerald-400' : 'text-red-400')}>
          NCS{data.ncsAdjustment > 0 ? '+' : ''}{data.ncsAdjustment}
        </span>
      )}
    </div>
  );
}
