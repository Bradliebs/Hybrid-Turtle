'use client';

import { useState } from 'react';
import { HelpCircle, ChevronDown, ChevronUp, TrendingUp, AlertTriangle, Target, Zap } from 'lucide-react';
import { cn } from '@/lib/utils';

function Section({ title, icon, children, defaultOpen = false }: {
  title: string;
  icon: React.ReactNode;
  children: React.ReactNode;
  defaultOpen?: boolean;
}) {
  const [open, setOpen] = useState(defaultOpen);
  return (
    <div className="border border-border/40 rounded-lg overflow-hidden">
      <button
        onClick={() => setOpen(!open)}
        className="w-full flex items-center justify-between px-4 py-2.5 bg-navy-800/40 hover:bg-navy-800/60 transition-colors"
      >
        <span className="flex items-center gap-2 text-sm font-semibold text-foreground">
          {icon}
          {title}
        </span>
        {open ? <ChevronUp className="w-4 h-4 text-muted-foreground" /> : <ChevronDown className="w-4 h-4 text-muted-foreground" />}
      </button>
      {open && <div className="px-4 py-3 space-y-2 text-xs text-muted-foreground">{children}</div>}
    </div>
  );
}

function Row({ label, max, desc }: { label: string; max: string; desc: string }) {
  return (
    <div className="grid grid-cols-[120px_50px_1fr] gap-2 items-start py-1 border-b border-border/20 last:border-0">
      <span className="font-semibold text-foreground">{label}</span>
      <span className="font-mono text-primary-400">{max}</span>
      <span>{desc}</span>
    </div>
  );
}

export default function ScoringGuide() {
  const [open, setOpen] = useState(false);

  return (
    <div className="card-surface overflow-hidden">
      <button
        onClick={() => setOpen(!open)}
        className="w-full flex items-center justify-between px-4 py-3 hover:bg-navy-800/30 transition-colors"
      >
        <span className="flex items-center gap-2 text-sm font-semibold text-foreground">
          <HelpCircle className="w-4 h-4 text-primary-400" />
          How Scoring Works
        </span>
        {open
          ? <ChevronUp className="w-4 h-4 text-muted-foreground" />
          : <span className="text-xs text-muted-foreground flex items-center gap-1">Click to expand <ChevronDown className="w-3 h-3" /></span>
        }
      </button>

      {open && (
        <div className="px-4 pb-4 space-y-3 animate-fade-in">
          {/* Overview */}
          <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
            <div className="rounded-lg bg-blue-500/10 border border-blue-500/30 p-3">
              <div className="text-sm font-bold text-blue-400 mb-1">BQS 0–100</div>
              <div className="text-xs text-muted-foreground">Breakout Quality Score — how strong the setup is. <span className="text-blue-300 font-semibold">Higher = better.</span></div>
            </div>
            <div className="rounded-lg bg-amber-500/10 border border-amber-500/30 p-3">
              <div className="text-sm font-bold text-amber-400 mb-1">FWS 0–100</div>
              <div className="text-xs text-muted-foreground">Fatal Weakness Score — early-failure risk. <span className="text-amber-300 font-semibold">Higher = worse.</span></div>
            </div>
            <div className="rounded-lg bg-emerald-500/10 border border-emerald-500/30 p-3">
              <div className="text-sm font-bold text-emerald-400 mb-1">NCS 0–100</div>
              <div className="text-xs text-muted-foreground">Net Composite Score — final desirability after penalties. <span className="text-emerald-300 font-semibold">Higher = better.</span></div>
            </div>
          </div>

          {/* BQS Breakdown */}
          <Section title="BQS Components (higher = stronger setup)" icon={<TrendingUp className="w-4 h-4 text-blue-400" />}>
            <div className="space-y-0.5">
              <Row label="Trend (ADX)" max="25" desc="Trend strength. Scales from 0 at ADX 15 to full at 35+." />
              <Row label="Direction (DI)" max="10" desc="+DI minus −DI spread. Higher = buyers in control." />
              <Row label="Volatility" max="15" desc="ATR% sweet spot. Full at 1–4%, fades above 4%, penalised below 1%." />
              <Row label="Proximity" max="15" desc="Distance to 20d/55d breakout high. Within 0% = full, drops off past 3%." />
              <Row label="Tailwind" max="15" desc="Market regime. Bullish+stable = 15, Neutral = 6, Bearish = 1.5." />
              <Row label="RS Score" max="15" desc="Relative strength vs benchmark. Outperformers score higher." />
              <Row label="Vol Bonus" max="5" desc="Extra credit if volume ratio &gt; 1.2× average (breakout confirmation)." />
              <Row label="Weekly ADX" max="±10" desc="Higher-timeframe trend confirmation. ≥30 = +10, ≥25 = +5, &lt;20 = −5. No data = neutral." />
              <Row label="Hurst" max="8" desc="Trend persistence (R/S Analysis). H ≥ 0.7 = +8 (strong), 0.6–0.7 = +5, 0.5–0.6 = +2, &lt; 0.5 = 0 (mean-reverting)." />
            </div>
            <div className="mt-2 text-[11px] bg-navy-800/60 rounded p-2">
              <span className="text-emerald-400 font-semibold">Green ≥ 60</span> = solid setup&ensp;•&ensp;
              <span className="text-amber-400 font-semibold">Amber 40–59</span> = marginal&ensp;•&ensp;
              <span className="text-red-400 font-semibold">Red &lt; 40</span> = weak
            </div>
          </Section>

          {/* FWS Breakdown */}
          <Section title="FWS Components (higher = more fragile)" icon={<AlertTriangle className="w-4 h-4 text-amber-400" />}>
            <div className="space-y-0.5">
              <Row label="Volume Risk" max="30" desc="Vol ratio below 1.2× — breakout on thin volume is suspect." />
              <Row label="Extension" max="25" desc="Price already ran past 20d/55d high recently. Both flags = 25, one = 15." />
              <Row label="Marginal Trend" max="10" desc="ADX < 20 = no real trend (10). 20–25 = borderline (7). 25–30 = mild (3)." />
              <Row label="Vol Shock" max="20" desc="ATR spiking (20) or collapsing (10) — unstable volatility." />
              <Row label="Regime Instab." max="10" desc="Market regime recently flipped — reduces conviction." />
            </div>
            <div className="mt-2 text-[11px] bg-navy-800/60 rounded p-2">
              <span className="text-emerald-400 font-semibold">Green ≤ 30</span> = few red flags&ensp;•&ensp;
              <span className="text-amber-400 font-semibold">Amber 31–60</span> = caution&ensp;•&ensp;
              <span className="text-red-400 font-semibold">Red &gt; 65</span> = auto-reject
            </div>
          </Section>

          {/* NCS Formula */}
          <Section title="NCS Formula & Penalties" icon={<Target className="w-4 h-4 text-emerald-400" />}>
            <div className="bg-navy-800/60 rounded p-2.5 font-mono text-sm text-foreground mb-2">
              BaseNCS = clamp(BQS − 0.8 × FWS + 10)
              <br />
              NCS = BaseNCS − EarningsPen − ClusterPen − SuperClusterPen
            </div>
            <div className="space-y-0.5">
              <Row label="Earnings" max="−20" desc="Earnings within 1d = −20, ≤3d = −15, ≤5d = −10. Avoid entering before announcements." />
              <Row label="Cluster" max="−20+" desc="Overexposed in the same sector cluster. Scales from 80% of limit." />
              <Row label="Super Cluster" max="−25+" desc="Overexposed at the broader super-cluster level." />
            </div>
          </Section>

          {/* Action Classification */}
          <Section title="Action Classification — What to Do" icon={<Zap className="w-4 h-4 text-primary-400" />} defaultOpen>
            <div className="space-y-2">
              <div className="flex items-start gap-2">
                <span className="inline-block mt-0.5 px-2 py-0.5 rounded text-[11px] font-bold text-emerald-300 bg-emerald-500/20 border border-emerald-500/30 whitespace-nowrap">Auto-Yes</span>
                <span>NCS ≥ 70 <em>and</em> FWS ≤ 30 — strong setup, few weaknesses. Trade it on breakout.</span>
              </div>
              <div className="flex items-start gap-2">
                <span className="inline-block mt-0.5 px-2 py-0.5 rounded text-[11px] font-bold text-red-300 bg-red-500/20 border border-red-500/30 whitespace-nowrap">Auto-No</span>
                <span>FWS &gt; 65 — too fragile. Skip regardless of BQS.</span>
              </div>
              <div className="flex items-start gap-2">
                <span className="inline-block mt-0.5 px-2 py-0.5 rounded text-[11px] font-bold text-amber-300 bg-amber-500/10 border border-amber-500/30 whitespace-nowrap">Conditional</span>
                <span>Everything else — needs extra confirmation: volume ≥ 1.0× on breakout day, or wait for a re-test.</span>
              </div>
            </div>
            <div className="mt-3 text-[11px] bg-navy-800/60 rounded p-2 space-y-1">
              <div className="text-foreground font-semibold">Quick checklist:</div>
              <div>1. Sort by NCS desc — best opportunities at top</div>
              <div>2. Look for <span className="text-emerald-400">green BQS</span> (≥60) + <span className="text-emerald-400">green FWS</span> (≤30)</div>
              <div>3. Click a row to inspect the <span className="text-primary-400">Why Card</span> breakdown</div>
              <div>4. Use filters to narrow to actionable candidates</div>
              <div>5. Conditional tickers can still work if volume confirms on breakout day</div>
            </div>
          </Section>
        </div>
      )}
    </div>
  );
}
