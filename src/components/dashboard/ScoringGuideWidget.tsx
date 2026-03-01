'use client';

import { useState } from 'react';
import { BookOpen, ChevronDown, ChevronUp } from 'lucide-react';
import { cn } from '@/lib/utils';
import GlossaryTerm from '@/components/GlossaryTerm';

const BPS_BANDS = [
  { range: '14–19', label: 'High probability', desc: 'Strong setup across most factors', color: 'text-emerald-400', bg: 'bg-emerald-500/15' },
  { range: '10–13', label: 'Decent setup', desc: 'Some factors weak', color: 'text-blue-400', bg: 'bg-blue-500/15' },
  { range: '6–9', label: 'Marginal', desc: 'Proceed with caution', color: 'text-amber-400', bg: 'bg-amber-500/15' },
  { range: '0–5', label: 'Poor setup', desc: 'Likely to fail', color: 'text-muted-foreground', bg: 'bg-navy-700' },
] as const;

const BPS_FACTORS = [
  { name: 'Consolidation Quality', max: 3, desc: 'Tighter ATR% = better base' },
  { name: 'Volume Accumulation', max: 3, desc: 'Rising volume slope = buying pressure' },
  { name: 'RS Rank', max: 3, desc: 'Outperformance vs benchmark' },
  { name: 'Sector Momentum', max: 2, desc: 'Sector ETF tailwind' },
  { name: 'Consolidation Duration', max: 3, desc: '10–30 day sweet spot' },
  { name: 'Prior Trend', max: 3, desc: 'Weekly ADX trend conviction' },
  { name: 'Failed Breakout', max: 2, desc: 'No recent fakeout = clean' },
] as const;

export default function ScoringGuideWidget() {
  const [expanded, setExpanded] = useState(false);

  return (
    <div className="card-surface p-4">
      <button
        type="button"
        onClick={() => setExpanded(!expanded)}
        className="w-full flex items-center justify-between"
      >
        <h3 className="text-sm font-semibold text-foreground flex items-center gap-2">
          <BookOpen className="w-4 h-4 text-blue-400" />
          Scoring Guide
        </h3>
        {expanded ? (
          <ChevronUp className="w-4 h-4 text-muted-foreground" />
        ) : (
          <ChevronDown className="w-4 h-4 text-muted-foreground" />
        )}
      </button>

      {/* Always-visible: BPS quick reference */}
      <div className="mt-3 space-y-1.5">
        <div className="text-[10px] text-muted-foreground font-medium uppercase tracking-wider mb-1">
          BPS — Breakout Probability Score (0–19)
        </div>
        {BPS_BANDS.map(({ range, label, desc, color, bg }) => (
          <div key={range} className={cn('flex items-center justify-between px-2.5 py-1.5 rounded-md', bg)}>
            <div className="flex items-center gap-2">
              <span className={cn('font-mono text-xs font-bold tabular-nums', color)}>{range}</span>
              <span className={cn('text-xs font-medium', color)}>{label}</span>
            </div>
            <span className="text-[10px] text-muted-foreground">{desc}</span>
          </div>
        ))}
      </div>

      {/* Expandable: factor breakdown */}
      {expanded && (
        <div className="mt-4 space-y-3 animate-fade-in">
          <div className="text-[10px] text-muted-foreground font-medium uppercase tracking-wider">
            7 Factors
          </div>
          <div className="space-y-1">
            {BPS_FACTORS.map(({ name, max, desc }) => (
              <div key={name} className="flex items-center justify-between text-xs px-2 py-1 rounded hover:bg-navy-700/50">
                <div className="flex items-center gap-2">
                  <span className="text-foreground font-medium">{name}</span>
                  <span className="text-muted-foreground">— {desc}</span>
                </div>
                <span className="font-mono text-[10px] text-muted-foreground tabular-nums">0–{max}</span>
              </div>
            ))}
          </div>

          {/* Existing scores reference */}
          <div className="border-t border-border pt-3 mt-3">
            <div className="text-[10px] text-muted-foreground font-medium uppercase tracking-wider mb-2">
              Other Scores Reference
            </div>
            <div className="grid grid-cols-3 gap-2 text-[10px]">
              <div className="bg-navy-700 rounded px-2 py-1.5">
                <div className="text-foreground font-semibold"><GlossaryTerm term="BQS">BQS</GlossaryTerm></div>
                <div className="text-muted-foreground">Breakout Quality<br />0–100, higher = better</div>
              </div>
              <div className="bg-navy-700 rounded px-2 py-1.5">
                <div className="text-foreground font-semibold"><GlossaryTerm term="FWS">FWS</GlossaryTerm></div>
                <div className="text-muted-foreground">Fatal Weakness<br />0–95, higher = <span className="text-red-400">worse</span></div>
              </div>
              <div className="bg-navy-700 rounded px-2 py-1.5">
                <div className="text-foreground font-semibold"><GlossaryTerm term="NCS">NCS</GlossaryTerm></div>
                <div className="text-muted-foreground">Net Composite<br />BQS − 0.8×FWS + 10</div>
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
