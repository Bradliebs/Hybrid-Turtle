'use client';

import { RISK_PROFILES } from '@/types';
import { useStore } from '@/store/useStore';
import { cn, formatPercent, formatCurrency } from '@/lib/utils';
import { Shield, Check } from 'lucide-react';

const profileDescriptions: Record<string, string> = {
  CONSERVATIVE: 'Lower risk per trade, more positions, tighter limits. Best for larger accounts prioritizing capital preservation.',
  BALANCED: 'Moderate risk per trade with balanced position limits. Default profile for most traders.',
  SMALL_ACCOUNT: 'Higher risk per trade to allow meaningful position sizes on smaller accounts. Fewer max positions.',
  AGGRESSIVE: 'Building mode — 2 concentrated positions with 1% risk per trade. Expansion enabled at ADX ≥ 25. Max cluster 35%.',
};

const profileColors: Record<string, string> = {
  CONSERVATIVE: 'border-blue-400/40 bg-blue-500/10',
  BALANCED: 'border-primary/40 bg-primary/10',
  SMALL_ACCOUNT: 'border-warning/40 bg-warning/10',
  AGGRESSIVE: 'border-red-400/40 bg-red-500/10',
};

export default function RiskProfileSelector() {
  const { riskProfile, setRiskProfile, equity } = useStore();

  return (
    <div className="card-surface p-4">
      <h3 className="text-sm font-semibold text-foreground mb-4 flex items-center gap-2">
        <Shield className="w-4 h-4 text-primary-400" />
        Risk Profile
      </h3>

      <div className="space-y-3">
        {(Object.keys(RISK_PROFILES) as Array<keyof typeof RISK_PROFILES>).map((key) => {
          const profile = RISK_PROFILES[key];
          const isActive = riskProfile === key;
          const riskPerTrade = equity * (profile.riskPerTrade / 100);

          return (
            <button
              key={key}
              onClick={() => setRiskProfile(key)}
              className={cn(
                'w-full text-left p-4 rounded-lg border transition-all',
                isActive
                  ? profileColors[key] + ' border-2'
                  : 'bg-navy-800/50 border-navy-600 hover:border-navy-500'
              )}
            >
              <div className="flex items-center justify-between mb-2">
                <span className="text-sm font-bold text-foreground">{key.replace(/_/g, ' ')}</span>
                {isActive && <Check className="w-4 h-4 text-profit" />}
              </div>

              <p className="text-xs text-muted-foreground mb-3">
                {profileDescriptions[key]}
              </p>

              <div className="grid grid-cols-4 gap-2">
                <div className="bg-navy-900/50 p-2 rounded text-center">
                  <div className="text-xs text-muted-foreground">Risk %</div>
                  <div className="text-sm font-mono font-bold text-foreground">
                    {formatPercent(profile.riskPerTrade)}
                  </div>
                </div>
                <div className="bg-navy-900/50 p-2 rounded text-center">
                  <div className="text-xs text-muted-foreground">Max Pos</div>
                  <div className="text-sm font-mono font-bold text-foreground">
                    {profile.maxPositions}
                  </div>
                </div>
                <div className="bg-navy-900/50 p-2 rounded text-center">
                  <div className="text-xs text-muted-foreground">Max Risk</div>
                  <div className="text-sm font-mono font-bold text-foreground">
                    {formatPercent(profile.maxOpenRisk)}
                  </div>
                </div>
                <div className="bg-navy-900/50 p-2 rounded text-center">
                  <div className="text-xs text-muted-foreground">$ / Trade</div>
                  <div className="text-sm font-mono font-bold text-foreground">
                    {formatCurrency(riskPerTrade)}
                  </div>
                </div>
              </div>
            </button>
          );
        })}
      </div>
    </div>
  );
}
