'use client';

import { useState } from 'react';
import { cn } from '@/lib/utils';
import type { ScoredTicker } from '@/lib/dual-score';
import { ChevronUp, ChevronDown } from 'lucide-react';

interface DualScoreTableProps {
  tickers: ScoredTicker[];
  selectedTicker: string | null;
  onSelect: (ticker: string | null) => void;
}

type SortKey = 'ticker' | 'name' | 'sleeve' | 'status' | 'close' | 'BQS' | 'FWS' | 'NCS' | 'adx_14' | 'atr_pct' | 'entry_trigger' | 'stop_level';
type SortDir = 'asc' | 'desc';

const COLUMNS: { key: SortKey; label: string; align?: 'right' }[] = [
  { key: 'ticker', label: 'ticker' },
  { key: 'name', label: 'name' },
  { key: 'sleeve', label: 'sleeve' },
  { key: 'status', label: 'status' },
  { key: 'close', label: 'close', align: 'right' },
  { key: 'BQS', label: 'BQS', align: 'right' },
  { key: 'FWS', label: 'FWS', align: 'right' },
  { key: 'NCS', label: 'NCS', align: 'right' },
  { key: 'entry_trigger', label: 'entry_trigger', align: 'right' },
  { key: 'stop_level', label: 'stop_level', align: 'right' },
  { key: 'adx_14', label: 'adx_14', align: 'right' },
  { key: 'atr_pct', label: 'atr_pct', align: 'right' },
];

function scoreBadge(value: number, type: 'bqs' | 'fws' | 'ncs') {
  let bg: string;
  if (type === 'bqs') {
    bg = value >= 60 ? 'bg-emerald-500' : value >= 40 ? 'bg-amber-500' : 'bg-red-500';
  } else if (type === 'fws') {
    bg = value <= 30 ? 'bg-emerald-500' : value <= 60 ? 'bg-amber-500' : 'bg-red-500';
  } else {
    bg = value >= 70 ? 'bg-emerald-500' : value >= 40 ? 'bg-amber-500' : 'bg-red-500';
  }
  return (
    <span className={`inline-block px-2 py-0.5 rounded text-[11px] font-bold text-white ${bg}`}>
      {value.toFixed(1)}
    </span>
  );
}

function actionBadge(note: string) {
  if (note.startsWith('Auto-Yes')) {
    return (
      <span className="inline-block px-2 py-0.5 rounded text-[11px] font-bold text-emerald-300 bg-emerald-500/20 border border-emerald-500/30 whitespace-nowrap">
        Auto-Yes
      </span>
    );
  }
  if (note.startsWith('Auto-No')) {
    return (
      <span className="inline-block px-2 py-0.5 rounded text-[11px] font-bold text-red-300 bg-red-500/20 border border-red-500/30 whitespace-nowrap">
        Auto-No
      </span>
    );
  }
  return (
    <span
      className="inline-block px-2 py-0.5 rounded text-[10px] font-medium text-amber-300 bg-amber-500/10 border border-amber-500/30 max-w-[280px] truncate cursor-help"
      title={note}
    >
      {note}
    </span>
  );
}

export default function DualScoreTable({ tickers, selectedTicker, onSelect }: DualScoreTableProps) {
  const [sortKey, setSortKey] = useState<SortKey>('NCS');
  const [sortDir, setSortDir] = useState<SortDir>('desc');

  const handleSort = (key: SortKey) => {
    if (sortKey === key) {
      setSortDir((d) => (d === 'asc' ? 'desc' : 'asc'));
    } else {
      setSortKey(key);
      setSortDir(key === 'ticker' || key === 'name' || key === 'sleeve' || key === 'status' ? 'asc' : 'desc');
    }
  };

  const sorted = [...tickers].sort((a, b) => {
    const av = a[sortKey] ?? '';
    const bv = b[sortKey] ?? '';
    const cmp = typeof av === 'number' && typeof bv === 'number'
      ? av - bv
      : String(av).localeCompare(String(bv));
    return sortDir === 'asc' ? cmp : -cmp;
  });

  return (
    <div className="card-surface overflow-x-auto">
      <table className="data-table">
        <thead>
          <tr>
            <th className="w-8"></th>
            {COLUMNS.map((col) => (
              <th
                key={col.key}
                className={cn('cursor-pointer select-none hover:text-foreground', col.align === 'right' && 'text-right')}
                onClick={() => handleSort(col.key)}
              >
                <span className="inline-flex items-center gap-1">
                  {col.label}
                  {sortKey === col.key && (
                    sortDir === 'asc'
                      ? <ChevronUp className="w-3 h-3" />
                      : <ChevronDown className="w-3 h-3" />
                  )}
                </span>
              </th>
            ))}
            <th>Action</th>
          </tr>
        </thead>
        <tbody>
          {sorted.map((row) => (
            <tr
              key={row.ticker}
              className={cn(
                'cursor-pointer transition-colors',
                selectedTicker === row.ticker
                  ? 'bg-primary/10 border-l-2 border-l-primary-400'
                  : 'hover:bg-navy-600/30'
              )}
              onClick={() => onSelect(selectedTicker === row.ticker ? null : row.ticker)}
            >
              <td>
                <input
                  type="checkbox"
                  checked={selectedTicker === row.ticker}
                  readOnly
                  className="accent-primary"
                />
              </td>
              <td className="text-primary-400 font-semibold text-sm">{row.ticker}</td>
              <td className="text-sm text-foreground max-w-[180px] truncate">{row.name}</td>
              <td className="text-xs text-muted-foreground">{row.sleeve?.replace(/_/g, ' ')}</td>
              <td className="text-xs text-muted-foreground">{row.status}</td>
              <td className="text-right font-mono text-sm">{safeNum(row.close).toFixed(2)}</td>
              <td className="text-right">{scoreBadge(row.BQS, 'bqs')}</td>
              <td className="text-right">{scoreBadge(row.FWS, 'fws')}</td>
              <td className="text-right">{scoreBadge(row.NCS, 'ncs')}</td>
              <td className="text-right font-mono text-sm">{safeNum(row.entry_trigger).toFixed(2)}</td>
              <td className="text-right font-mono text-sm">{safeNum(row.stop_level).toFixed(2)}</td>
              <td className="text-right font-mono text-sm">{safeNum(row.adx_14).toFixed(1)}</td>
              <td className="text-right font-mono text-sm">{safeNum(row.atr_pct).toFixed(2)}</td>
              <td>{actionBadge(row.ActionNote)}</td>
            </tr>
          ))}
          {sorted.length === 0 && (
            <tr>
              <td colSpan={COLUMNS.length + 2} className="text-center text-muted-foreground py-8">
                No tickers match filters
              </td>
            </tr>
          )}
        </tbody>
      </table>
    </div>
  );
}

function safeNum(v: unknown, fallback = 0): number {
  if (v == null) return fallback;
  const n = Number(v);
  return Number.isFinite(n) ? n : fallback;
}
