'use client';

import { useEffect } from 'react';
import { useStore } from '@/store/useStore';

const DEFAULT_USER_ID = 'default-user';

export default function LiveDataBootstrap() {
  const { setHealthStatus, setHeartbeat, setMarketRegime, setRiskProfile, setEquity } = useStore();

  useEffect(() => {
    const fetchSettings = async () => {
      try {
        const res = await fetch(`/api/settings?userId=${DEFAULT_USER_ID}`);
        if (!res.ok) return;
        const data = await res.json();
        if (data?.riskProfile) setRiskProfile(data.riskProfile);
        if (data?.equity) setEquity(data.equity);
      } catch {
        // Silent fail on bootstrap
      }
    };

    const fetchHealth = async () => {
      try {
        const res = await fetch(`/api/health-check?userId=${DEFAULT_USER_ID}`);
        if (!res.ok) return;
        const data = await res.json();
        if (data?.overall) {
          setHealthStatus(data.overall);
        }
      } catch {
        // Silent fail on bootstrap
      }
    };

    const recordHeartbeat = async () => {
      try {
        const res = await fetch('/api/heartbeat', { method: 'POST' });
        if (!res.ok) return;
        const data = await res.json();
        if (data?.lastHeartbeat) {
          setHeartbeat(new Date(data.lastHeartbeat));
        }
      } catch {
        // Silent fail
      }
    };

    const fetchHeartbeat = async () => {
      try {
        const res = await fetch('/api/heartbeat');
        if (!res.ok) return;
        const data = await res.json();
        if (data?.lastHeartbeat) {
          setHeartbeat(new Date(data.lastHeartbeat));
        }
      } catch {
        // Silent fail on bootstrap
      }
    };

    const fetchRegime = async () => {
      try {
        const res = await fetch('/api/market-data?action=regime');
        if (!res.ok) return;
        const data = await res.json();
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
