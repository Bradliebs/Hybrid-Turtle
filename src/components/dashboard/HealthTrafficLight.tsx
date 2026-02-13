'use client';

import { useStore } from '@/store/useStore';
import TrafficLight, { TrafficLightFull } from '@/components/shared/TrafficLight';
import { cn } from '@/lib/utils';
import type { HealthStatus } from '@/types';

export default function HealthTrafficLight() {
  const { healthStatus } = useStore();

  const statusMessages: Record<HealthStatus, string> = {
    GREEN: 'All systems operational — Trading allowed',
    YELLOW: 'Warnings detected — Trade with caution',
    RED: 'Issues detected — Review before trading',
  };

  return (
    <div className="card-surface p-4">
      <h3 className="text-sm font-semibold text-foreground mb-3">System Health</h3>
      <div className="flex items-center gap-4">
        <TrafficLightFull status={healthStatus} />
        <div className="flex-1">
          <div className="flex items-center gap-2 mb-1">
            <TrafficLight status={healthStatus} size="md" pulse />
            <span
              className={cn(
                'text-lg font-bold',
                healthStatus === 'GREEN' && 'text-profit',
                healthStatus === 'YELLOW' && 'text-warning',
                healthStatus === 'RED' && 'text-loss'
              )}
            >
              {healthStatus}
            </span>
          </div>
          <p className="text-sm text-muted-foreground">
            {statusMessages[healthStatus]}
          </p>
        </div>
      </div>
    </div>
  );
}
