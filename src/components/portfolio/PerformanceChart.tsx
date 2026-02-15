'use client';

import {
  LineChart,
  Line,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  ResponsiveContainer,
  Legend,
} from 'recharts';
import { useState } from 'react';

interface PerformanceChartProps {
  data?: Array<
    { date: string; portfolio: number; benchmark: number }
    | { date: string; value: number }
  >;
}
export default function PerformanceChart({ data = [] }: PerformanceChartProps) {
  const [timeRange, setTimeRange] = useState('1Y');

  const normalizedData = data.map((point) => {
    if ('portfolio' in point && 'benchmark' in point) {
      return point;
    }
    return {
      date: point.date,
      portfolio: point.value,
      benchmark: point.value,
    };
  });

  if (normalizedData.length === 0) {
    return (
      <div className="card-surface p-4">
        <div className="flex items-center justify-between mb-4">
          <h3 className="text-sm font-semibold text-foreground">Performance vs Benchmark</h3>
          <div className="flex items-center gap-1">
            {['1M', '3M', '6M', '1Y', 'ALL'].map((range) => (
              <button
                key={range}
                onClick={() => setTimeRange(range)}
                className={`px-2 py-1 text-xs rounded transition-colors ${
                  timeRange === range
                    ? 'bg-primary/20 text-primary-400'
                    : 'text-muted-foreground hover:text-foreground'
                }`}
              >
                {range}
              </button>
            ))}
          </div>
        </div>
        <div className="text-xs text-muted-foreground text-center py-8">
          No performance history yet. Run a scan and sync positions to build a track record.
        </div>
      </div>
    );
  }

  return (
    <div className="card-surface p-4">
      <div className="flex items-center justify-between mb-4">
        <h3 className="text-sm font-semibold text-foreground">Performance vs Benchmark</h3>
        <div className="flex items-center gap-1">
          {['1M', '3M', '6M', '1Y', 'ALL'].map((range) => (
            <button
              key={range}
              onClick={() => setTimeRange(range)}
              className={`px-2 py-1 text-xs rounded transition-colors ${
                timeRange === range
                  ? 'bg-primary/20 text-primary-400'
                  : 'text-muted-foreground hover:text-foreground'
              }`}
            >
              {range}
            </button>
          ))}
        </div>
      </div>

      <ResponsiveContainer width="100%" height={280}>
        <LineChart data={normalizedData}>
          <CartesianGrid strokeDasharray="3 3" stroke="rgba(139, 92, 246, 0.1)" />
          <XAxis
            dataKey="date"
            tick={{ fill: '#94a3b8', fontSize: 11 }}
            axisLine={{ stroke: 'rgba(139, 92, 246, 0.2)' }}
          />
          <YAxis
            tick={{ fill: '#94a3b8', fontSize: 11 }}
            axisLine={{ stroke: 'rgba(139, 92, 246, 0.2)' }}
            tickFormatter={(v) => `$${(v / 1000).toFixed(0)}k`}
          />
          <Tooltip
            contentStyle={{
              backgroundColor: '#1e2347',
              border: '1px solid rgba(139, 92, 246, 0.2)',
              borderRadius: '8px',
              color: '#ffffff',
            }}
            formatter={(value: number) => [`$${value.toLocaleString()}`, '']}
          />
          <Legend
            wrapperStyle={{ color: '#94a3b8', fontSize: '12px' }}
          />
          <Line
            type="monotone"
            dataKey="portfolio"
            stroke="#7c3aed"
            strokeWidth={2}
            dot={false}
            name="Portfolio"
          />
          <Line
            type="monotone"
            dataKey="benchmark"
            stroke="#94a3b8"
            strokeWidth={1.5}
            strokeDasharray="5 5"
            dot={false}
            name="S&P 500"
          />
        </LineChart>
      </ResponsiveContainer>
    </div>
  );
}
