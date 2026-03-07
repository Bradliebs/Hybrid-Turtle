/**
 * DEPENDENCIES
 * Consumed by: TodayPanel.tsx
 * Consumes: /api/prediction/failure-modes (GET for cached scores)
 * Risk-sensitive: NO — read-only display
 * Last modified: 2026-03-07
 * Notes: Fetches latest failure mode scores for a candidate ticker.
 *        Falls back to null if no scores exist (not yet computed).
 */

'use client';

import { useState, useEffect } from 'react';
import type { FMResult } from '@/lib/prediction/failure-mode-thresholds';
import { classifyFMStatus, type FailureModeId } from '@/lib/prediction/failure-mode-thresholds';

export interface FMData {
  results: FMResult[];
  hasBlock: boolean;
  loading: boolean;
}

/**
 * Fetch the latest failure mode scores for a ticker.
 * Returns null results if no scores are stored yet.
 */
export function useFailureModes(ticker: string | null | undefined): FMData {
  const [data, setData] = useState<FMData>({
    results: [],
    hasBlock: false,
    loading: !!ticker,
  });

  useEffect(() => {
    if (!ticker) {
      setData({ results: [], hasBlock: false, loading: false });
      return;
    }

    let cancelled = false;

    const fetchFM = async () => {
      try {
        const res = await fetch(`/api/prediction/failure-modes?ticker=${encodeURIComponent(ticker)}`);
        if (!res.ok) {
          if (!cancelled) setData({ results: [], hasBlock: false, loading: false });
          return;
        }
        const json = await res.json();
        if (cancelled) return;

        if (!json.ok || !json.data?.hasScore) {
          setData({ results: [], hasBlock: false, loading: false });
          return;
        }

        const score = json.data.score;
        const fmIds: FailureModeId[] = ['fm1', 'fm2', 'fm3', 'fm4', 'fm5'];
        const results: FMResult[] = fmIds.map(id => ({
          id,
          score: score[id] as number,
          status: classifyFMStatus(id, score[id] as number),
          reason: score.reasons?.[id],
        }));

        const hasBlock = results.some(r => r.status === 'BLOCK');
        setData({ results, hasBlock, loading: false });
      } catch {
        if (!cancelled) setData({ results: [], hasBlock: false, loading: false });
      }
    };

    fetchFM();
    return () => { cancelled = true; };
  }, [ticker]);

  return data;
}
