'use client';

import { useMemo } from 'react';
import { useStore } from '@/store/useStore';
import { RISK_PROFILES } from '@/types';
import { calculatePositionSize } from '@/lib/position-sizer';

export function useRiskProfile() {
  const { riskProfile, equity, setRiskProfile, setEquity } = useStore();

  const profile = useMemo(() => {
    return RISK_PROFILES[riskProfile as keyof typeof RISK_PROFILES] || RISK_PROFILES.BALANCED;
  }, [riskProfile]);

  const riskPerTrade = useMemo(() => {
    return equity * (profile.riskPerTrade / 100);
  }, [equity, profile.riskPerTrade]);

  const maxTotalRiskDollars = useMemo(() => {
    return equity * (profile.maxOpenRisk / 100);
  }, [equity, profile.maxOpenRisk]);

  const sizePosition = useMemo(() => {
    return (entryPrice: number, stopPrice: number) => {
      return calculatePositionSize({
        equity,
        riskProfile: riskProfile as any,
        entryPrice,
        stopPrice,
      });
    };
  }, [equity, profile.riskPerTrade]);

  return {
    riskProfile,
    profile,
    equity,
    riskPerTrade,
    maxTotalRiskDollars,
    maxPositions: profile.maxPositions,
    riskPercent: profile.riskPerTrade,
    maxTotalRisk: profile.maxOpenRisk,
    setRiskProfile,
    setEquity,
    sizePosition,
  };
}
