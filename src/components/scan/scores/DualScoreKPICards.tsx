import { memo } from 'react';

interface DualScoreKPICardsProps {
  autoYes: number;
  autoNo: number;
  conditional: number;
  avgNCS: number;
  avgBQS: number;
  avgFWS: number;
  total: number;
}

function DualScoreKPICards({
  autoYes, autoNo, conditional, avgNCS, avgBQS, avgFWS, total,
}: DualScoreKPICardsProps) {
  const cards = [
    {
      value: autoYes,
      label: 'AUTO-YES',
      sub: 'NCS ≥ 70 & FWS ≤ 30',
      color: 'text-emerald-400',
      border: 'border-emerald-500/40',
      bg: 'bg-emerald-500/10',
    },
    {
      value: autoNo,
      label: 'AUTO-NO',
      sub: 'FWS > 65 (fragile)',
      color: 'text-red-400',
      border: 'border-red-500/40',
      bg: 'bg-red-500/10',
    },
    {
      value: conditional,
      label: 'CONDITIONAL',
      sub: 'Needs confirmation',
      color: 'text-amber-400',
      border: 'border-amber-500/40',
      bg: 'bg-amber-500/10',
    },
    {
      value: avgNCS,
      label: 'AVG NCS',
      sub: `BQS ${avgBQS} / FWS ${avgFWS}`,
      color: 'text-cyan-400',
      border: 'border-cyan-500/40',
      bg: 'bg-cyan-500/10',
    },
    {
      value: total,
      label: 'TOTAL TICKERS',
      sub: 'Scored universe',
      color: 'text-purple-400',
      border: 'border-purple-500/40',
      bg: 'bg-purple-500/10',
    },
  ];

  return (
    <div className="grid grid-cols-2 md:grid-cols-5 gap-3">
      {cards.map((card) => (
        <div
          key={card.label}
          className={`rounded-lg border p-4 ${card.border} ${card.bg}`}
        >
          <div className={`text-3xl font-bold font-mono ${card.color}`}>
            {typeof card.value === 'number' && card.value % 1 !== 0
              ? card.value.toFixed(1)
              : card.value}
          </div>
          <div className="text-xs font-semibold text-foreground mt-1 uppercase tracking-wider">
            {card.label}
          </div>
          <div className="text-[10px] text-muted-foreground mt-0.5">{card.sub}</div>
        </div>
      ))}
    </div>
  );
}

export default memo(DualScoreKPICards);
