/**
 * DEPENDENCIES
 * Consumed by: src/app/portfolio/positions/page.tsx
 * Consumes: /api/notifications (GET)
 * Risk-sensitive: NO — display only, recommendation panel
 * Last modified: 2026-03-01
 * Notes: Shows amber warning cards for unread BREAKOUT_FAILURE notifications.
 *        Self-fetching — queries notifications API on mount.
 *        Collapses to a compact header when no failures are active.
 */

'use client';

import { useState, useEffect, useCallback } from 'react';
import { cn } from '@/lib/utils';
import { AlertTriangle, ChevronDown, ChevronRight, X } from 'lucide-react';
import { apiRequest } from '@/lib/api-client';

// ── Types ────────────────────────────────────────────────────────

interface BreakoutFailureNotification {
  id: number;
  createdAt: string;
  readAt: string | null;
  title: string;
  message: string;
  priority: string;
  data: string | null;
}

interface BreakoutFailureData {
  ticker: string;
  daysHeld: number;
  rMultiple: number;
  entryTrigger: number;
  currentPrice: number;
  estimatedLoss: number;
}

// ── Helpers ──────────────────────────────────────────────────────

function parseBfData(raw: string | null): BreakoutFailureData | null {
  if (!raw) return null;
  try {
    const parsed = JSON.parse(raw);
    if (parsed.ticker && typeof parsed.entryTrigger === 'number') {
      return parsed as BreakoutFailureData;
    }
  } catch {
    // Malformed JSON — ignore
  }
  return null;
}

function currencySymbol(ticker: string): string {
  if (ticker.endsWith('.L') || /^[A-Z]{2,5}l$/.test(ticker)) return '£';
  if (ticker.endsWith('.AS') || ticker.endsWith('.PA') || ticker.endsWith('.DE')) return '€';
  return '$';
}

// ── Component ────────────────────────────────────────────────────

export default function BreakoutFailurePanel() {
  const [failures, setFailures] = useState<BreakoutFailureNotification[]>([]);
  const [loading, setLoading] = useState(true);
  const [expanded, setExpanded] = useState(false);
  const [dismissed, setDismissed] = useState<Set<number>>(new Set());

  const fetchFailures = useCallback(async () => {
    try {
      const res = await apiRequest<{
        notifications: BreakoutFailureNotification[];
        unreadCount: number;
      }>('/api/notifications?limit=20');

      // Filter to unread BREAKOUT_FAILURE notifications only
      // API doesn't support type filter, so filter client-side
      const bfNotifications = (res.notifications ?? []).filter(
        (n) => n.readAt === null && n.data != null
      ).filter((n) => {
        const parsed = parseBfData(n.data);
        return parsed !== null;
      }).filter((n) => {
        // Double-check by title pattern since type isn't in the response
        return n.title.toLowerCase().includes('breakout failure');
      });

      setFailures(bfNotifications);
      // Auto-expand if there are active failures
      if (bfNotifications.length > 0) {
        setExpanded(true);
      }
    } catch {
      // Non-critical — panel simply won't show
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { fetchFailures(); }, [fetchFailures]);

  // Mark a notification as read (dismiss from panel)
  const handleDismiss = async (notificationId: number) => {
    setDismissed((prev) => new Set(prev).add(notificationId));
    try {
      await apiRequest(`/api/notifications/${notificationId}/read`, { method: 'PATCH' });
    } catch {
      // Best-effort
    }
  };

  const visibleFailures = failures.filter((f) => !dismissed.has(f.id));

  // Don't render if loading or no failures
  if (loading || visibleFailures.length === 0) return null;

  return (
    <div className="card-surface overflow-hidden border-l-4 border-l-amber-500">
      {/* Header */}
      <button
        onClick={() => setExpanded(!expanded)}
        className="w-full flex items-center justify-between px-5 py-4 hover:bg-white/5 transition-colors"
      >
        <div className="flex items-center gap-3">
          <AlertTriangle className="w-5 h-5 text-amber-400" />
          <h2 className="text-sm font-semibold text-foreground">Breakout Failures</h2>
          <span className="text-xs px-2 py-0.5 rounded-full font-medium bg-amber-500/15 text-amber-400">
            {visibleFailures.length}
          </span>
        </div>
        {expanded ? (
          <ChevronDown className="w-4 h-4 text-muted-foreground" />
        ) : (
          <ChevronRight className="w-4 h-4 text-muted-foreground" />
        )}
      </button>

      {/* Cards */}
      {expanded && (
        <div className="px-5 pb-5 space-y-3">
          {visibleFailures.map((notification) => {
            const data = parseBfData(notification.data);
            if (!data) return null;
            const sym = currencySymbol(data.ticker);

            return (
              <div
                key={notification.id}
                className="rounded-lg border border-amber-500/30 bg-amber-500/5 p-4 relative"
              >
                {/* Dismiss button */}
                <button
                  onClick={(e) => {
                    e.stopPropagation();
                    handleDismiss(notification.id);
                  }}
                  className="absolute top-3 right-3 text-muted-foreground hover:text-foreground transition-colors"
                  title="Dismiss (mark as read)"
                >
                  <X className="w-4 h-4" />
                </button>

                {/* Title */}
                <div className="flex items-center gap-2 mb-2">
                  <AlertTriangle className="w-4 h-4 text-amber-400 flex-shrink-0" />
                  <span className="text-sm font-semibold text-amber-400">
                    BREAKOUT FAILURE — {data.ticker}
                  </span>
                </div>

                {/* Description */}
                <p className="text-xs text-muted-foreground mb-3">
                  Price has closed back below the entry trigger within {data.daysHeld} day{data.daysHeld !== 1 ? 's' : ''} of entry.
                </p>

                {/* Data grid */}
                <div className="grid grid-cols-2 gap-x-4 gap-y-1.5 text-xs mb-3">
                  <div>
                    <span className="text-muted-foreground">Entry trigger:</span>{' '}
                    <span className="text-foreground font-medium">{sym}{data.entryTrigger.toFixed(2)}</span>
                  </div>
                  <div>
                    <span className="text-muted-foreground">Current price:</span>{' '}
                    <span className="text-foreground font-medium">{sym}{data.currentPrice.toFixed(2)}</span>
                  </div>
                  <div>
                    <span className="text-muted-foreground">Days held:</span>{' '}
                    <span className="text-foreground font-medium">{data.daysHeld}</span>
                  </div>
                  <div>
                    <span className="text-muted-foreground">Expected loss:</span>{' '}
                    <span className={cn('font-medium', data.estimatedLoss < 0 ? 'text-loss' : 'text-foreground')}>
                      {data.estimatedLoss < 0 ? '-' : ''}{sym}{Math.abs(data.estimatedLoss).toFixed(2)}
                    </span>
                  </div>
                </div>

                {/* Recommendation */}
                <div className="text-xs text-amber-400 font-medium">
                  Recommendation: Exit this position in Trading 212. This breakout has failed.
                </div>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}
