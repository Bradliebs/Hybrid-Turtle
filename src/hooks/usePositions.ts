'use client';

import { useState, useEffect, useCallback } from 'react';
import { useStore } from '@/store/useStore';

interface Position {
  id: string;
  ticker: string;
  sleeve: string;
  entryPrice: number;
  currentPrice: number;
  shares: number;
  stopLoss: number;
  initialStop: number;
  status: string;
  rMultiple: number;
  protectionLevel: string;
  gainPercent: number;
  gainDollars: number;
  riskDollars: number;
  entryDate: string;
}

export function usePositions(statusFilter?: string) {
  const [positions, setPositions] = useState<Position[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const { setPositions: setStorePositions } = useStore();

  const fetchPositions = useCallback(async () => {
    setLoading(true);
    setError(null);

    try {
      const url = statusFilter
        ? `/api/positions?status=${statusFilter}`
        : '/api/positions';

      const res = await fetch(url);
      if (!res.ok) throw new Error('Failed to fetch positions');

      const data = await res.json();
      setPositions(data.positions || []);

      // Update store with open positions
      const openPositions = (data.positions || []).filter(
        (p: Position) => p.status === 'OPEN'
      );
      setStorePositions(openPositions);

      return data.positions;
    } catch (err) {
      const msg = err instanceof Error ? err.message : 'Unknown error';
      setError(msg);
      return [];
    } finally {
      setLoading(false);
    }
  }, [statusFilter, setStorePositions]);

  const updateStop = useCallback(async (positionId: string, newStop: number, reason: string = 'Manual stop update') => {
    try {
      const res = await fetch('/api/stops', {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ positionId, newStop, reason }),
      });

      if (!res.ok) {
        const data = await res.json();
        throw new Error(data.error || 'Failed to update stop');
      }

      // Refresh positions
      await fetchPositions();
      return true;
    } catch (err) {
      const msg = err instanceof Error ? err.message : 'Unknown error';
      setError(msg);
      return false;
    }
  }, [fetchPositions]);

  const closePosition = useCallback(async (positionId: string, exitPrice: number) => {
    try {
      const res = await fetch('/api/positions', {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          positionId,
          exitPrice,
        }),
      });

      if (!res.ok) {
        const data = await res.json();
        throw new Error(data.error || 'Failed to close position');
      }

      await fetchPositions();
      return true;
    } catch (err) {
      const msg = err instanceof Error ? err.message : 'Unknown error';
      setError(msg);
      return false;
    }
  }, [fetchPositions]);

  useEffect(() => {
    fetchPositions();
  }, [fetchPositions]);

  return {
    positions,
    loading,
    error,
    fetchPositions,
    updateStop,
    closePosition,
  };
}
