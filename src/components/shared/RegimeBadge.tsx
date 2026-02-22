import { memo } from 'react';
import { cn } from '@/lib/utils';
import type { MarketRegime } from '@/types';
import { TrendingUp, TrendingDown, Minus } from 'lucide-react';

interface RegimeBadgeProps {
  regime: MarketRegime;
  size?: 'sm' | 'md' | 'lg';
  className?: string;
}

const regimeConfig: Record<MarketRegime, {
  label: string;
  color: string;
  bgColor: string;
  borderColor: string;
  icon: typeof TrendingUp;
}> = {
  BULLISH: {
    label: 'BULLISH',
    color: 'text-profit',
    bgColor: 'bg-profit/15',
    borderColor: 'border-profit/30',
    icon: TrendingUp,
  },
  SIDEWAYS: {
    label: 'SIDEWAYS',
    color: 'text-warning',
    bgColor: 'bg-warning/15',
    borderColor: 'border-warning/30',
    icon: Minus,
  },
  BEARISH: {
    label: 'BEARISH',
    color: 'text-loss',
    bgColor: 'bg-loss/15',
    borderColor: 'border-loss/30',
    icon: TrendingDown,
  },
};

const sizeStyles = {
  sm: 'px-2 py-0.5 text-xs gap-1',
  md: 'px-3 py-1 text-sm gap-1.5',
  lg: 'px-4 py-2 text-base gap-2',
};

const iconSizes = {
  sm: 'w-3 h-3',
  md: 'w-4 h-4',
  lg: 'w-5 h-5',
};

function RegimeBadge({ regime, size = 'md', className }: RegimeBadgeProps) {
  const config = regimeConfig[regime];
  const Icon = config.icon;

  return (
    <div
      className={cn(
        'inline-flex items-center rounded-lg font-bold border',
        config.bgColor,
        config.borderColor,
        config.color,
        sizeStyles[size],
        className
      )}
    >
      <Icon className={iconSizes[size]} />
      {config.label}
    </div>
  );
}

export default memo(RegimeBadge);
