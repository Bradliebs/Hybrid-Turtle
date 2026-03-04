'use client';

import { useState, useEffect } from 'react';
import { cn } from '@/lib/utils';
import { apiRequest } from '@/lib/api-client';
import { AlertTriangle, Eye, Crosshair, Wrench, ArrowRight } from 'lucide-react';

// ── Types (mirrors the API response) ──
type Phase = 'PLANNING' | 'OBSERVATION' | 'EXECUTION' | 'MAINTENANCE';

type DirectiveState =
  | 'SYSTEM_ALERT'
  | 'DATA_WARNING'
  | 'PLANNING'
  | 'OBSERVATION'
  | 'EXECUTION_BLOCKED'
  | 'EXECUTION_READY'
  | 'EXECUTION_NO_CANDIDATES'
  | 'MAINTENANCE_STOPS'
  | 'MAINTENANCE_LAGGARD'
  | 'MAINTENANCE_PYRAMID'
  | 'MAINTENANCE_CLEAR';

interface DirectiveData {
  phase: Phase;
  regime: 'BULLISH' | 'SIDEWAYS' | 'BEARISH';
  heartbeatStatus: 'SUCCESS' | 'FAILED' | 'RUNNING' | 'NONE';
  heartbeatAgeHours: number;
  healthOverall: 'GREEN' | 'YELLOW' | 'RED';
  scanAgeHours: number;
  readyCandidateCount: number;
  stopsPending: number;
  laggardCount: number;
  pyramidCount: number;
  state: DirectiveState;
  headline: string;
  subtext: string | null;
  action: { label: string; href: string } | null;
}

// ── Border colour by state ──
function getBorderColor(state: DirectiveState): string {
  switch (state) {
    case 'SYSTEM_ALERT':
    case 'EXECUTION_BLOCKED':
      return 'border-l-red-500';
    case 'DATA_WARNING':
    case 'OBSERVATION':
    case 'EXECUTION_NO_CANDIDATES':
      return 'border-l-amber-500';
    case 'PLANNING':
    case 'EXECUTION_READY':
      return 'border-l-emerald-500';
    case 'MAINTENANCE_STOPS':
    case 'MAINTENANCE_LAGGARD':
    case 'MAINTENANCE_PYRAMID':
      return 'border-l-blue-500';
    case 'MAINTENANCE_CLEAR':
      return 'border-l-gray-500';
  }
}

// ── Phase icon ──
function PhaseIcon({ state }: { state: DirectiveState }) {
  const iconClass = 'w-5 h-5';
  switch (state) {
    case 'SYSTEM_ALERT':
    case 'DATA_WARNING':
      return <AlertTriangle className={cn(iconClass, 'text-red-400')} />;
    case 'PLANNING':
      return <Eye className={cn(iconClass, 'text-emerald-400')} />;
    case 'OBSERVATION':
      return <Eye className={cn(iconClass, 'text-amber-400')} />;
    case 'EXECUTION_BLOCKED':
      return <Crosshair className={cn(iconClass, 'text-red-400')} />;
    case 'EXECUTION_READY':
      return <Crosshair className={cn(iconClass, 'text-emerald-400')} />;
    case 'EXECUTION_NO_CANDIDATES':
      return <Crosshair className={cn(iconClass, 'text-amber-400')} />;
    default:
      return <Wrench className={cn(iconClass, 'text-blue-400')} />;
  }
}

export default function TodayDirectiveCard() {
  const [data, setData] = useState<DirectiveData | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    apiRequest<DirectiveData>('/api/dashboard/today-directive')
      .then(setData)
      .catch((err) => console.error('[TodayDirective] Fetch error:', err))
      .finally(() => setLoading(false));
  }, []);

  // ── Skeleton loading state ──
  if (loading) {
    return (
      <div className="w-full rounded-lg border-l-4 border-l-gray-600 bg-navy-800/60 border border-border/40 p-4 animate-pulse">
        <div className="flex items-center justify-between">
          <div className="space-y-2 flex-1">
            <div className="h-5 w-3/5 bg-navy-600 rounded" />
            <div className="h-3 w-2/5 bg-navy-700 rounded" />
          </div>
          <div className="h-8 w-28 bg-navy-600 rounded-lg" />
        </div>
      </div>
    );
  }

  if (!data) return null;

  const borderColor = getBorderColor(data.state);

  return (
    <div
      className={cn(
        'w-full rounded-lg border-l-4 bg-navy-800/60 border border-border/40 p-4',
        borderColor
      )}
    >
      <div className="flex items-center justify-between gap-4">
        {/* Left: icon + text */}
        <div className="flex items-start gap-3 flex-1 min-w-0">
          <div className="mt-0.5 flex-shrink-0">
            <PhaseIcon state={data.state} />
          </div>
          <div className="min-w-0">
            <div className="flex items-center gap-2 flex-wrap">
              <span className="text-[10px] font-bold uppercase tracking-wider text-muted-foreground">
                {data.phase}
              </span>
              <span className="text-[10px] px-1.5 py-0.5 rounded bg-navy-700 text-muted-foreground border border-border/50">
                {data.regime}
              </span>
            </div>
            <h2 className="text-lg font-semibold text-foreground mt-1 leading-snug">
              {data.headline}
            </h2>
            {data.subtext && (
              <p className="text-sm text-muted-foreground mt-0.5">
                {data.subtext}
              </p>
            )}
          </div>
        </div>

        {/* Right: action button */}
        {data.action && (
          <a
            href={data.action.href}
            className={cn(
              'flex-shrink-0 inline-flex items-center gap-1.5 px-4 py-2 rounded-lg text-xs font-semibold transition-all',
              'bg-primary/15 text-primary-400 border border-primary/30',
              'hover:bg-primary/25 hover:border-primary/50'
            )}
          >
            {data.action.label}
            <ArrowRight className="w-3.5 h-3.5" />
          </a>
        )}
      </div>
    </div>
  );
}
