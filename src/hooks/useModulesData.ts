'use client';

import { useEffect } from 'react';
import { useStore } from '@/store/useStore';
import type { AllModulesResult } from '@/types';

const DEFAULT_USER_ID = 'default-user';

/**
 * Shared hook for /api/modules data.
 * All dashboard widgets call this instead of fetching independently.
 * Data is cached in the Zustand store with a 2-minute TTL.
 * Returns { data, loading } — widgets render from `data`.
 */
export function useModulesData(): {
  data: AllModulesResult | null;
  loading: boolean;
} {
  const modulesData = useStore((s) => s.modulesData);
  const modulesFetching = useStore((s) => s.modulesFetching);
  const setModulesData = useStore((s) => s.setModulesData);
  const setModulesFetching = useStore((s) => s.setModulesFetching);
  const isStale = useStore((s) => s.isModulesStale);

  useEffect(() => {
    // Skip if data is fresh or another caller is already fetching
    if (!isStale() || modulesFetching) return;

    let cancelled = false;
    setModulesFetching(true);

    (async () => {
      try {
        const res = await fetch(`/api/modules?userId=${DEFAULT_USER_ID}`);
        if (!res.ok) throw new Error(`Modules API ${res.status}`);
        const data: AllModulesResult = await res.json();
        if (!cancelled) {
          setModulesData(data);
        }
      } catch (err) {
        console.error('[useModulesData] fetch failed:', err);
        if (!cancelled) setModulesFetching(false);
      }
    })();

    return () => {
      cancelled = true;
    };
  }, []); // eslint-disable-line react-hooks/exhaustive-deps
  // Intentionally empty deps — staleness check handles re-fetch logic

  return {
    data: modulesData,
    loading: !modulesData && modulesFetching,
  };
}
