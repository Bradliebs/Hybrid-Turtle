'use client';

import { cn } from '@/lib/utils';
import { formatCurrency, formatPercent } from '@/lib/utils';

interface KPIBannerProps {
  items: {
    label: string;
    value: string;
    change?: number;
    changeLabel?: string;
    prefix?: string;
  }[];
}

export default function KPIBanner({ items }: KPIBannerProps) {
  return (
    <div className="grid grid-cols-2 md:grid-cols-5 gap-3">
      {items.map((item, i) => (
        <div key={i} className="kpi-card">
          <span className="metric-label">{item.label}</span>
          <span className="metric-value text-foreground">
            {item.prefix && <span className="text-muted-foreground text-lg">{item.prefix}</span>}
            {item.value}
          </span>
          {item.change !== undefined && (
            <span
              className={cn(
                'text-sm font-mono',
                item.change >= 0 ? 'text-profit' : 'text-loss'
              )}
            >
              {item.change >= 0 ? '+' : ''}
              {item.changeLabel || item.change.toFixed(2)}
            </span>
          )}
        </div>
      ))}
    </div>
  );
}
