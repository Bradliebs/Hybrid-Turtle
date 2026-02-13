'use client';

import { useEffect } from 'react';
import { useStore } from '@/store/useStore';
import { apiRequest } from '@/lib/api-client';
import type { HealthStatus, MarketRegime, RiskProfileType } from '@/types';

const DEFAULT_USER_ID = 'default-user';

export default function LiveDataBootstrap() {
  const { setHealthStatus, setHeartbeat, setMarketRegime, setRiskProfile, setEquity } = useStore();

  useEffect(() => {
    const fetchSettings = async () => {
      try {
        const data = await apiRequest<{ riskProfile?: RiskProfileType; equity?: number }>(`/api/settings?userId=${DEFAULT_USER_ID}`);
        if (data?.riskProfile) setRiskProfile(data.riskProfile);
        if (data?.equity) setEquity(data.equity);
      } catch {
        // Silent fail on bootstrap
      }
    };

    const fetchHealth = async () => {
      try {
        const data = await apiRequest<{ overall?: HealthStatus }>(`/api/health-check?userId=${DEFAULT_USER_ID}`);
        if (data?.overall) {
          setHealthStatus(data.overall);
        }
      } catch {
        // Silent fail on bootstrap
      }
    };

    const recordHeartbeat = async () => {
      try {
        const data = await apiRequest<{ lastHeartbeat?: string }>('/api/heartbeat', { method: 'POST' });
        if (data?.lastHeartbeat) {
          setHeartbeat(new Date(data.lastHeartbeat));
        }
      } catch {
        // Silent fail
      }
    };

    const fetchHeartbeat = async () => {
      try {
        const data = await apiRequest<{ lastHeartbeat?: string }>('/api/heartbeat');
        if (data?.lastHeartbeat) {
          setHeartbeat(new Date(data.lastHeartbeat));
        }
      } catch {
        // Silent fail on bootstrap
      }
    };

    const fetchRegime = async () => {
      try {
        const data = await apiRequest<{ regime?: MarketRegime }>('/api/market-data?action=regime');
        if (data?.regime) {
          setMarketRegime(data.regime);
        }
      } catch {
        // Silent fail on bootstrap
      }
    };

    fetchSettings();
    recordHeartbeat();
    fetchHealth();
    fetchRegime();

    // Re-record heartbeat every 30 minutes to keep it fresh
    const heartbeatInterval = setInterval(recordHeartbeat, 30 * 60_000);
    const healthInterval = setInterval(fetchHealth, 300_000);
    const regimeInterval = setInterval(fetchRegime, 300_000);

    return () => {
      clearInterval(heartbeatInterval);
      clearInterval(healthInterval);
      clearInterval(regimeInterval);
    };
  }, [setHealthStatus, setHeartbeat, setMarketRegime, setRiskProfile, setEquity]);

  return null;
}
