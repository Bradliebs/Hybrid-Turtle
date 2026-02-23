'use client';

import { PieChart, Pie, Cell, ResponsiveContainer, Tooltip, Legend } from 'recharts';

interface DistributionItem {
  name: string;
  value: number;
  color: string;
}

interface DistributionDonutProps {
  data: DistributionItem[];
  title: string;
  centerLabel?: string;
  centerValue?: string;
  tickers?: { ticker: string; label: string }[];
}

export default function DistributionDonut({
  data,
  title,
  centerLabel,
  centerValue,
  tickers,
}: DistributionDonutProps) {
  const total = data.reduce((sum, d) => sum + d.value, 0);

  return (
    <div className="card-surface p-4">
      <h3 className="text-sm font-semibold text-foreground mb-4">{title}</h3>
      <div className="relative">
        <ResponsiveContainer width="100%" height={250}>
          <PieChart>
            <Pie
              data={data}
              cx="50%"
              cy="50%"
              innerRadius={60}
              outerRadius={90}
              paddingAngle={3}
              dataKey="value"
              stroke="none"
            >
              {data.map((entry) => (
                <Cell key={`cell-${entry.name}`} fill={entry.color} />
              ))}
            </Pie>
            <Tooltip
              contentStyle={{
                backgroundColor: '#1e2347',
                border: '1px solid rgba(139, 92, 246, 0.2)',
                borderRadius: '8px',
                color: '#ffffff',
              }}
              formatter={(value: number) => [
                `${((value / total) * 100).toFixed(1)}%`,
                '',
              ]}
            />
          </PieChart>
        </ResponsiveContainer>
        {/* Center label */}
        {centerLabel && (
          <div className="absolute inset-0 flex items-center justify-center pointer-events-none">
            <div className="text-center">
              <div className="text-2xl font-bold text-foreground">{centerValue}</div>
              <div className="text-xs text-muted-foreground">{centerLabel}</div>
            </div>
          </div>
        )}
      </div>
      {/* Legend */}
      <div className="grid grid-cols-2 gap-2 mt-2">
        {data.map((item) => (
          <div key={item.name} className="flex items-center gap-2 text-xs">
            <div
              className="w-3 h-3 rounded-full flex-shrink-0"
              style={{ backgroundColor: item.color }}
            />
            <span className="text-muted-foreground truncate">{item.name}</span>
            <span className="text-foreground font-mono ml-auto">
              {((item.value / total) * 100).toFixed(1)}%
            </span>
          </div>
        ))}
      </div>
      {/* Position tickers */}
      {tickers && tickers.length > 0 && (
        <div className="mt-3 pt-3 border-t border-border">
          <div className="flex flex-wrap gap-1.5">
            {tickers.map((t) => (
              <span
                key={t.ticker}
                className="inline-flex items-center gap-1 px-2 py-0.5 rounded bg-navy-800 text-xs"
              >
                <span className="text-primary-400 font-semibold">{t.ticker}</span>
                <span className="text-muted-foreground">{t.label}</span>
              </span>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}
