'use client';

import { Search } from 'lucide-react';

interface DualScoreFiltersProps {
  search: string;
  onSearchChange: (v: string) => void;
  sleeve: string;
  onSleeveChange: (v: string) => void;
  status: string;
  onStatusChange: (v: string) => void;
  action: string;
  onActionChange: (v: string) => void;
  minNCS: number;
  onMinNCSChange: (v: number) => void;
  maxFWS: number;
  onMaxFWSChange: (v: number) => void;
  sleeves: string[];
  statuses: string[];
  resultCount: number;
}

export default function DualScoreFilters({
  search, onSearchChange,
  sleeve, onSleeveChange,
  status, onStatusChange,
  action, onActionChange,
  minNCS, onMinNCSChange,
  maxFWS, onMaxFWSChange,
  sleeves, statuses, resultCount,
}: DualScoreFiltersProps) {
  return (
    <div className="card-surface p-4 space-y-3">
      <div className="flex items-center gap-2 text-xs font-semibold text-muted-foreground uppercase tracking-wider">
        FILTERS
      </div>
      <div className="flex flex-wrap items-end gap-3">
        {/* Search */}
        <div className="relative">
          <Search className="absolute left-2.5 top-2.5 w-3.5 h-3.5 text-muted-foreground" />
          <input
            type="text"
            value={search}
            onChange={(e) => onSearchChange(e.target.value)}
            placeholder="Search ticker / name"
            className="input-field pl-8 h-9 w-48 text-sm"
          />
        </div>

        {/* Sleeve */}
        <select
          value={sleeve}
          onChange={(e) => onSleeveChange(e.target.value)}
          className="input-field h-9 text-sm min-w-[120px]"
        >
          <option value="">All Sleeves</option>
          {sleeves.map((s) => (
            <option key={s} value={s}>{s.replace(/_/g, ' ')}</option>
          ))}
        </select>

        {/* Status */}
        <select
          value={status}
          onChange={(e) => onStatusChange(e.target.value)}
          className="input-field h-9 text-sm min-w-[120px]"
        >
          <option value="">All Status</option>
          {statuses.map((s) => (
            <option key={s} value={s}>{s}</option>
          ))}
        </select>

        {/* Action */}
        <select
          value={action}
          onChange={(e) => onActionChange(e.target.value)}
          className="input-field h-9 text-sm min-w-[110px]"
        >
          <option value="">All Actions</option>
          <option value="Auto-Yes">Auto-Yes</option>
          <option value="Auto-No">Auto-No</option>
          <option value="Conditional">Conditional</option>
        </select>

        {/* Min NCS */}
        <div className="flex items-center gap-2">
          <label className="text-xs text-muted-foreground whitespace-nowrap">Min NCS</label>
          <div className="flex items-center gap-1">
            <span className="text-xs font-mono text-cyan-400 bg-cyan-500/10 border border-cyan-500/30 rounded px-1.5 py-0.5 min-w-[28px] text-center">
              {minNCS}
            </span>
            <input
              type="range"
              min={0}
              max={100}
              value={minNCS}
              onChange={(e) => onMinNCSChange(Number(e.target.value))}
              className="w-24 accent-cyan-400"
            />
          </div>
        </div>

        {/* Max FWS */}
        <div className="flex items-center gap-2">
          <label className="text-xs text-muted-foreground whitespace-nowrap">Max FWS</label>
          <div className="flex items-center gap-1">
            <span className="text-xs font-mono text-cyan-400 bg-cyan-500/10 border border-cyan-500/30 rounded px-1.5 py-0.5 min-w-[28px] text-center">
              {maxFWS}
            </span>
            <input
              type="range"
              min={0}
              max={100}
              value={maxFWS}
              onChange={(e) => onMaxFWSChange(Number(e.target.value))}
              className="w-24 accent-cyan-400"
            />
          </div>
        </div>
      </div>
      <div className="text-xs text-muted-foreground">
        Showing <span className="text-foreground font-semibold">{resultCount}</span> tickers
      </div>
    </div>
  );
}
