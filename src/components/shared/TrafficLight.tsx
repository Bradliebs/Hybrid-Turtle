import { memo } from 'react';
import { cn } from '@/lib/utils';
import type { HealthStatus } from '@/types';

interface TrafficLightProps {
  status: HealthStatus;
  size?: 'sm' | 'md' | 'lg';
  label?: string;
  pulse?: boolean;
  className?: string;
}

const sizeMap = {
  sm: 'w-3 h-3',
  md: 'w-4 h-4',
  lg: 'w-6 h-6',
};

const colorMap: Record<HealthStatus, string> = {
  GREEN: 'bg-profit',
  YELLOW: 'bg-warning',
  RED: 'bg-loss',
};

const glowMap: Record<HealthStatus, string> = {
  GREEN: 'shadow-glow-success',
  YELLOW: 'shadow-[0_0_10px_rgba(245,158,11,0.3)]',
  RED: 'shadow-glow-danger',
};

const pulseMap: Record<HealthStatus, string> = {
  GREEN: 'animate-pulse-green',
  YELLOW: '',
  RED: 'animate-pulse-red',
};

function TrafficLight({ status, size = 'md', label, pulse = false, className }: TrafficLightProps) {
  return (
    <div className={cn('flex items-center gap-2', className)}>
      <div
        className={cn(
          'rounded-full',
          sizeMap[size],
          colorMap[status],
          glowMap[status],
          pulse && pulseMap[status]
        )}
      />
      {label && (
        <span className={cn(
          'text-sm font-medium',
          status === 'GREEN' && 'text-profit',
          status === 'YELLOW' && 'text-warning',
          status === 'RED' && 'text-loss',
        )}>
          {label}
        </span>
      )}
    </div>
  );
}

export default memo(TrafficLight);
interface TrafficLightFullProps {
  status: HealthStatus;
  className?: string;
}

export function TrafficLightFull({ status, className }: TrafficLightFullProps) {
  return (
    <div className={cn('flex flex-col items-center gap-1.5 p-3 rounded-xl bg-navy-800 border border-border', className)}>
      <div className={cn(
        'w-5 h-5 rounded-full border-2',
        status === 'RED' ? 'bg-loss border-loss shadow-glow-danger' : 'bg-navy-700 border-navy-600'
      )} />
      <div className={cn(
        'w-5 h-5 rounded-full border-2',
        status === 'YELLOW' ? 'bg-warning border-warning shadow-[0_0_10px_rgba(245,158,11,0.3)]' : 'bg-navy-700 border-navy-600'
      )} />
      <div className={cn(
        'w-5 h-5 rounded-full border-2',
        status === 'GREEN' ? 'bg-profit border-profit shadow-glow-success' : 'bg-navy-700 border-navy-600'
      )} />
    </div>
  );
}
