'use client';

/**
 * DEPENDENCIES
 * Consumed by: Next.js app router (/trade-pulse)
 * Consumes: /api/scan/cross-ref (GET — for candidates with dual scores)
 * Risk-sensitive: NO — read-only index page
 * Last modified: 2026-03-08
 * Notes: Landing page for /trade-pulse. Shows recent candidates with links
 *        to their individual TradePulse analysis pages.
 */

import { useEffect, useState } from 'react';
import Navbar from '@/components/shared/Navbar';
import { cn } from '@/lib/utils';
import { apiRequest } from '@/lib/api-client';
import { Loader2, BarChart3, ArrowRight } from 'lucide-react';
import Link from 'next/link';

interface Candidate {
  ticker: string;
  name: string;
  dualNCS: number | null;
  dualAction: string | null;
  scanStatus: string | null;
  matchType: string;
}

export default function TradePulseIndexPage() {
  const [candidates, setCandidates] = useState<Candidate[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    const fetchCandidates = async () => {
      try {
        const data = await apiRequest<{ tickers?: Candidate[] }>('/api/scan/cross-ref');
        if (data.tickers) {
          // Show candidates with NCS scores, ranked by NCS
          setCandidates(
            data.tickers
              .filter((c: Candidate) => c.dualNCS != null)
              .sort((a: Candidate, b: Candidate) => (b.dualNCS ?? 0) - (a.dualNCS ?? 0))
              .slice(0, 20)
          );
        }
      } catch {
        // Silent
      } finally {
        setLoading(false);
      }
    };
    fetchCandidates();
  }, []);

  return (
    <div className="min-h-screen bg-background">
      <Navbar />
      <main className="max-w-4xl mx-auto p-4 space-y-6">
        <div>
          <h1 className="text-xl font-bold text-foreground flex items-center gap-2">
            <BarChart3 className="w-5 h-5" />
            TradePulse
          </h1>
          <p className="text-sm text-muted-foreground mt-1">
            Select a ticker to view its full unified confidence dashboard
          </p>
        </div>

        {loading ? (
          <div className="card-surface p-8 flex items-center justify-center gap-3 text-muted-foreground">
            <Loader2 className="w-5 h-5 animate-spin" /> Loading candidates...
          </div>
        ) : candidates.length === 0 ? (
          <div className="card-surface p-8 text-center text-muted-foreground">
            <BarChart3 className="w-8 h-8 mx-auto mb-3 opacity-40" />
            <p>No active candidates found. Run a scan first.</p>
          </div>
        ) : (
          <div className="space-y-2">
            {candidates.map(c => (
              <Link
                key={c.ticker}
                href={`/trade-pulse/${encodeURIComponent(c.ticker)}`}
                className="card-surface p-4 flex items-center justify-between hover:bg-navy-800/60 transition-colors block"
              >
                <div className="flex items-center gap-3">
                  <span className={cn(
                    'inline-flex items-center justify-center min-w-[40px] px-2 py-0.5 rounded-md text-xs font-bold border font-mono',
                    (c.dualNCS ?? 0) >= 70 ? 'bg-emerald-500/10 border-emerald-500/30 text-emerald-400' :
                    (c.dualNCS ?? 0) >= 50 ? 'bg-amber-500/10 border-amber-500/30 text-amber-400' :
                    'bg-red-500/10 border-red-500/30 text-red-400'
                  )}>
                    NCS {Math.round(c.dualNCS ?? 0)}
                  </span>
                  <div>
                    <span className="text-sm font-semibold text-foreground">{c.ticker}</span>
                    <span className="text-xs text-muted-foreground ml-2">{c.name}</span>
                  </div>
                </div>
                <div className="flex items-center gap-2">
                  <span className={cn(
                    'text-xs px-1.5 py-0.5 rounded border',
                    c.dualAction === 'AUTO_YES' ? 'bg-emerald-500/10 border-emerald-500/30 text-emerald-400' :
                    c.dualAction === 'CONDITIONAL' ? 'bg-amber-500/10 border-amber-500/30 text-amber-400' :
                    'bg-red-500/10 border-red-500/30 text-red-400'
                  )}>
                    {c.dualAction?.replace('_', '-') ?? c.scanStatus ?? c.matchType}
                  </span>
                  <ArrowRight className="w-4 h-4 text-muted-foreground" />
                </div>
              </Link>
            ))}
          </div>
        )}
      </main>
    </div>
  );
}
