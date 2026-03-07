/**
 * DEPENDENCIES
 * Consumed by: TodayPanel.tsx
 * Consumes: /api/prediction/signal-weights (GET)
 * Risk-sensitive: NO — read-only display
 * Last modified: 2026-03-07
 * Notes: Fetches signal weight vector from the meta-model API.
 */

'use client';

import { useState, useEffect } from 'react';

// SignalWeights type inlined to avoid importing from server-only module chain
interface SignalWeights {
  adx: number;
  di: number;
  hurst: number;
  bis: number;
  drs: number;
  weeklyAdx: number;
  bps: number;
}

// Matches DEFAULT_WEIGHTS in signal-weight-meta-model.ts — keep in sync
const DEFAULT_WEIGHTS: SignalWeights = {
  adx: 0.16,
  di: 0.13,
  hurst: 0.14,
  bis: 0.16,
  drs: 0.17,
  weeklyAdx: 0.12,
  bps: 0.12,
};

export interface SignalWeightData {
  weights: SignalWeights;
  defaultWeights: SignalWeights;
  regime: string;
  source: string;
  loading: boolean;
  hasData: boolean;
}

export function useSignalWeights(): SignalWeightData {
  const [data, setData] = useState<SignalWeightData>({
    weights: DEFAULT_WEIGHTS,
    defaultWeights: DEFAULT_WEIGHTS,
    regime: 'TRENDING',
    source: 'rule_based',
    loading: true,
    hasData: false,
  });

  useEffect(() => {
    let cancelled = false;

    const fetchWeights = async () => {
      try {
        const res = await fetch('/api/prediction/signal-weights');
        if (!res.ok) {
          if (!cancelled) setData(prev => ({ ...prev, loading: false }));
          return;
        }
        const json = await res.json();
        if (cancelled) return;

        if (json.ok && json.data?.weights) {
          setData({
            weights: json.data.weights,
            defaultWeights: json.data.defaultWeights ?? DEFAULT_WEIGHTS,
            regime: json.data.regime ?? json.data.context?.regime ?? 'TRENDING',
            source: json.data.source ?? 'rule_based',
            loading: false,
            hasData: true,
          });
        } else {
          setData(prev => ({ ...prev, loading: false }));
        }
      } catch {
        if (!cancelled) setData(prev => ({ ...prev, loading: false }));
      }
    };

    fetchWeights();
    return () => { cancelled = true; };
  }, []);

  return data;
}
