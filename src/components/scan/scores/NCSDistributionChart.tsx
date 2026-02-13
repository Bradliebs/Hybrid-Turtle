'use client';

import {
  BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip, Cell, ResponsiveContainer, LabelList,
} from 'recharts';

interface NCSDistributionChartProps {
  tickers: { NCS: number }[];
}

const RANGES = [
  { label: '0-20', lo: 0, hi: 20, color: '#ef4444' },
  { label: '20-40', lo: 20, hi: 40, color: '#f97316' },
  { label: '40-60', lo: 40, hi: 60, color: '#f59e0b' },
  { label: '60-70', lo: 60, hi: 70, color: '#84cc16' },
  { label: '70-80', lo: 70, hi: 80, color: '#22c55e' },
  { label: '80-100', lo: 80, hi: 100, color: '#06b6d4' },
];

export default function NCSDistributionChart({ tickers }: NCSDistributionChartProps) {
  const data = RANGES.map((r) => ({
    range: r.label,
    count: tickers.filter((t) => t.NCS >= r.lo && t.NCS < (r.hi === 100 ? 101 : r.hi)).length,
    color: r.color,
  }));

  return (
    <div className="card-surface p-4 h-full">
      <h3 className="text-xs font-semibold text-muted-foreground uppercase tracking-wider mb-3">
        NCS Distribution
      </h3>
      <ResponsiveContainer width="100%" height={240}>
        <BarChart data={data} margin={{ top: 20, right: 10, bottom: 5, left: 0 }}>
          <CartesianGrid strokeDasharray="3 3" stroke="rgba(139,92,246,0.1)" />
          <XAxis
            dataKey="range"
            tick={{ fill: '#94a3b8', fontSize: 11 }}
            axisLine={{ stroke: 'rgba(139,92,246,0.2)' }}
            label={{ value: 'NCS Range', position: 'insideBottom', offset: -2, fill: '#94a3b8', fontSize: 11 }}
          />
          <YAxis
            tick={{ fill: '#94a3b8', fontSize: 11 }}
            axisLine={{ stroke: 'rgba(139,92,246,0.2)' }}
            label={{ value: 'Count', angle: -90, position: 'insideLeft', fill: '#94a3b8', fontSize: 11 }}
          />
          <Tooltip
            contentStyle={{
              backgroundColor: '#1e2347',
              border: '1px solid rgba(139,92,246,0.3)',
              borderRadius: '8px',
              color: '#fff',
              fontSize: 12,
            }}
          />
          <Bar dataKey="count" radius={[4, 4, 0, 0]}>
            <LabelList dataKey="count" position="top" fill="#fff" fontSize={11} fontWeight={700} />
            {data.map((entry, i) => (
              <Cell key={i} fill={entry.color} />
            ))}
          </Bar>
        </BarChart>
      </ResponsiveContainer>
    </div>
  );
}
