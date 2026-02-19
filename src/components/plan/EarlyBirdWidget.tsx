'use client';

import { useState } from 'react';
import { cn, formatCurrency } from '@/lib/utils';
import { apiRequest } from '@/lib/api-client';
import { Bird, Loader2, AlertTriangle, TrendingUp, Volume2 } from 'lucide-react';

interface EarlyBirdSignal {
  ticker: string;
  name: string;
  price: number;
  fiftyFiveDayHigh: number;
  rangePctile: number;
  volumeRatio: number;
  regime: string;
  eligible: boolean;
  reason: string;
}

interface EarlyBirdResponse {
  regime: string;
  signals: EarlyBirdSignal[];
  message: string;
  scannedCount: number;
}

export default function EarlyBirdWidget() {
  const [data, setData] = useState<EarlyBirdResponse | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const runScan = async () => {
    setLoading(true);
    setError(null);
    try {
      const result = await apiRequest<EarlyBirdResponse>('/api/modules/early-bird');
      setData(result);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Scan failed');
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="card-surface p-4">
      <div className="flex items-center justify-between mb-3">
        <h3 className="text-sm font-semibold text-foreground flex items-center gap-2">
          <Bird className="w-4 h-4 text-amber-400" />
          Early Bird Entry
        </h3>
        <button
          onClick={runScan}
          disabled={loading}
          className={cn(
            'inline-flex items-center gap-1.5 px-3 py-1.5 rounded-md text-xs font-medium transition-colors',
            loading
              ? 'bg-navy-700 text-muted-foreground cursor-not-allowed'
              : 'bg-amber-500/20 text-amber-400 hover:bg-amber-500/30 border border-amber-500/30'
          )}
        >
          {loading ? (
            <>
              <Loader2 className="w-3 h-3 animate-spin" />
              Scanning...
            </>
          ) : (
            'Run Scan'
          )}
        </button>
      </div>

      <p className="text-[10px] text-muted-foreground mb-3">
        Catches early momentum moves before ADX confirms — top 10% of 55d range + volume surge + bullish regime.
      </p>

      {error && (
        <div className="flex items-center gap-2 text-xs text-red-400 bg-red-500/10 border border-red-500/20 rounded-lg p-2 mb-3">
          <AlertTriangle className="w-3.5 h-3.5 flex-shrink-0" />
          {error}
        </div>
      )}

      {data && !loading && (
        <>
          {/* Regime status */}
          <div className="text-[10px] text-muted-foreground mb-2">
            Regime: <span className={cn(
              'font-semibold',
              data.regime === 'BULLISH' ? 'text-emerald-400' : data.regime === 'BEARISH' ? 'text-red-400' : 'text-amber-400'
            )}>{data.regime}</span>
            {data.scannedCount > 0 && <span> · {data.scannedCount} tickers scanned</span>}
          </div>

          {data.signals.length === 0 ? (
            <div className="text-center py-4 text-muted-foreground text-xs">
              {data.regime !== 'BULLISH'
                ? `Regime is ${data.regime} — Early Bird requires BULLISH`
                : 'No Early Bird candidates found'}
            </div>
          ) : (
            <div className="space-y-2">
              {data.signals.map((s) => (
                <div
                  key={s.ticker}
                  className="bg-navy-800 rounded-lg p-3 border border-amber-500/20"
                >
                  <div className="flex items-center justify-between mb-1">
                    <span className="text-amber-400 font-bold text-sm">{s.ticker}</span>
                    <span className="text-[10px] text-muted-foreground">{s.name}</span>
                  </div>
                  <div className="grid grid-cols-3 gap-2 text-xs">
                    <div>
                      <span className="text-muted-foreground">Price</span>
                      <div className="font-mono text-foreground">{formatCurrency(s.price)}</div>
                    </div>
                    <div>
                      <span className="text-muted-foreground flex items-center gap-1">
                        <TrendingUp className="w-3 h-3" /> Range
                      </span>
                      <div className="font-mono text-amber-400">{s.rangePctile.toFixed(0)}%</div>
                    </div>
                    <div>
                      <span className="text-muted-foreground flex items-center gap-1">
                        <Volume2 className="w-3 h-3" /> Vol
                      </span>
                      <div className="font-mono text-emerald-400">{s.volumeRatio.toFixed(1)}×</div>
                    </div>
                  </div>
                  <div className="mt-1.5 text-[10px] text-muted-foreground italic">
                    {s.reason}
                  </div>
                </div>
              ))}
            </div>
          )}
        </>
      )}

      {!data && !loading && !error && (
        <div className="text-center py-4 text-muted-foreground text-xs">
          Click &quot;Run Scan&quot; to check for early entries
        </div>
      )}
    </div>
  );
}
