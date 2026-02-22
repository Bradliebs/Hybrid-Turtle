'use client';

import {
  ScatterChart, Scatter, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer, Cell,
  Label,
} from 'recharts';

interface BQSvsFWSScatterProps {
  tickers: { ticker: string; BQS: number; FWS: number; NCS: number; ActionNote: string }[];
}

function getActionColor(note: string): string {
  if (note.startsWith('Auto-Yes')) return '#22c55e';
  if (note.startsWith('Auto-No')) return '#ef4444';
  return '#f59e0b';
}

export default function BQSvsFWSScatter({ tickers }: BQSvsFWSScatterProps) {
  const data = tickers.map((t) => ({
    x: t.BQS,
    y: t.FWS,
    ticker: t.ticker,
    ncs: t.NCS,
    action: t.ActionNote,
    color: getActionColor(t.ActionNote),
  }));

  return (
    <div className="card-surface p-4 h-full">
      <h3 className="text-xs font-semibold text-muted-foreground uppercase tracking-wider mb-3">
        BQS vs FWS Scatter
      </h3>
      <ResponsiveContainer width="100%" height={240}>
        <ScatterChart margin={{ top: 10, right: 20, bottom: 20, left: 10 }}>
          <CartesianGrid strokeDasharray="3 3" stroke="rgba(139,92,246,0.1)" />
          <XAxis
            type="number"
            dataKey="x"
            domain={[0, 100]}
            tick={{ fill: '#94a3b8', fontSize: 11 }}
            axisLine={{ stroke: 'rgba(139,92,246,0.2)' }}
          >
            <Label value="BQS (higher = better setup)" offset={-12} position="insideBottom" fill="#94a3b8" fontSize={11} />
          </XAxis>
          <YAxis
            type="number"
            dataKey="y"
            domain={[0, 100]}
            tick={{ fill: '#94a3b8', fontSize: 11 }}
            axisLine={{ stroke: 'rgba(139,92,246,0.2)' }}
          >
            <Label value="FWS (lower = safer)" angle={-90} position="insideLeft" fill="#94a3b8" fontSize={11} />
          </YAxis>
          <Tooltip
            cursor={{ strokeDasharray: '3 3' }}
            content={({ payload }) => {
              if (!payload || payload.length === 0) return null;
              const d = payload[0].payload;
              return (
                <div className="bg-navy-700 border border-border rounded-lg p-2 text-xs text-foreground shadow-lg">
                  <div className="font-bold text-primary-400">{d.ticker}</div>
                  <div>BQS: {d.x.toFixed(1)}</div>
                  <div>FWS: {d.y.toFixed(1)}</div>
                  <div>NCS: {d.ncs.toFixed(1)}</div>
                </div>
              );
            }}
          />
          <Scatter data={data} fill="#f59e0b">
            {data.map((entry) => (
              <Cell key={entry.ticker} fill={entry.color} fillOpacity={0.7} r={4} />
            ))}
          </Scatter>
        </ScatterChart>
      </ResponsiveContainer>
      {/* Legend */}
      <div className="flex items-center gap-4 mt-2 justify-center">
        {[
          { label: 'Auto-Yes', color: '#22c55e' },
          { label: 'Conditional', color: '#f59e0b' },
          { label: 'Auto-No', color: '#ef4444' },
        ].map((l) => (
          <div key={l.label} className="flex items-center gap-1.5 text-xs text-muted-foreground">
            <span className="w-2.5 h-2.5 rounded-full" style={{ backgroundColor: l.color }} />
            {l.label}
          </div>
        ))}
      </div>
    </div>
  );
}
