/**
 * DEPENDENCIES
 * Consumed by: TodayPanel.tsx (per-ticker card, trading hours only)
 * Consumes: (standalone — displays pre-computed data passed via props)
 * Risk-sensitive: NO — display only
 * Last modified: 2026-03-07
 * Notes: Shows prior NCS → posterior NCS with directional arrow and update count.
 *        Visible during UK trading hours (08:00–16:30) only.
 *        If NCS degrades > 8 points, shows amber warning with reclassification label.
 */

'use client';

import { useState, useEffect } from 'react';
import { cn } from '@/lib/utils';
import { TrendingDown, TrendingUp, Minus } from 'lucide-react';

// ── Types ────────────────────────────────────────────────────

interface LiveNCSTrackerProps {
  /** NCS score from the morning scan */
  priorNCS: number;
  /** Current (posterior) NCS — updated via any refresh */
  posteriorNCS: number | null;
  /** Number of intraday observations incorporated */
  updateCount: number;
  /** Whether the user has enabled this feature in settings */
  enabled?: boolean;
}

// ── Trading Hours Check ──────────────────────────────────────

function isUKTradingHours(): boolean {
  const now = new Date();
  const ukTime = new Date(now.toLocaleString('en-GB', { timeZone: 'Europe/London' }));
  const hours = ukTime.getHours();
  const mins = ukTime.getMinutes();
  const totalMinutes = hours * 60 + mins;
  // 08:00 to 16:30 UK time
  return totalMinutes >= 480 && totalMinutes <= 990;
}

// ── Component ────────────────────────────────────────────────

export default function LiveNCSTracker({
  priorNCS,
  posteriorNCS,
  updateCount,
  enabled = true,
}: LiveNCSTrackerProps) {
  const [isTradingHours, setIsTradingHours] = useState(false);

  useEffect(() => {
    setIsTradingHours(isUKTradingHours());
    const interval = setInterval(() => setIsTradingHours(isUKTradingHours()), 60000);
    return () => clearInterval(interval);
  }, []);

  // Only show during trading hours and when enabled
  if (!enabled || !isTradingHours || posteriorNCS === null) return null;

  const delta = posteriorNCS - priorNCS;
  const isDegrading = delta < -8;
  const isImproving = delta > 5;
  const isStable = Math.abs(delta) <= 2;

  return (
    <div className={cn(
      'flex items-center gap-2 text-[11px]',
      isDegrading ? 'text-amber-400' : isImproving ? 'text-emerald-400' : 'text-muted-foreground'
    )}>
      {/* Prior → Posterior */}
      <span className="font-mono">
        NCS: {Math.round(priorNCS)} → {Math.round(posteriorNCS)}
      </span>

      {/* Direction indicator */}
      {isStable ? (
        <Minus className="w-3 h-3" />
      ) : delta > 0 ? (
        <TrendingUp className="w-3 h-3" />
      ) : (
        <TrendingDown className="w-3 h-3" />
      )}

      {/* Update count */}
      <span className="text-muted-foreground">({updateCount} updates)</span>

      {/* Degradation warning */}
      {isDegrading && (
        <span className="text-amber-400 font-medium">
          ⚠ Degrading intraday
        </span>
      )}
    </div>
  );
}
