'use client';

import { useEffect, useState } from 'react';
import { apiRequest } from '@/lib/api-client';
import { GitCompareArrows, AlertTriangle, Loader2 } from 'lucide-react';

interface CorrelationFlag {
  tickerA: string;
  tickerB: string;
  correlation: number;
  flag: string;
}

interface CorrelationResponse {
  flags: CorrelationFlag[];
  count: number;
}

export default function CorrelationPanel() {
  const [data, setData] = useState<CorrelationResponse | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    const fetchCorrelation = async () => {
      try {
        const result = await apiRequest<CorrelationResponse>('/api/risk/correlation');
        setData(result);
      } catch {
        // Silent fail — panel just shows empty state
      } finally {
        setLoading(false);
      }
    };
    fetchCorrelation();
  }, []);

  if (loading) {
    return (
      <div className="card-surface p-4">
        <h3 className="text-sm font-semibold text-foreground mb-3 flex items-center gap-2">
          <GitCompareArrows className="w-4 h-4 text-primary-400" />
          Correlation Matrix
        </h3>
        <div className="flex items-center justify-center gap-2 py-4 text-muted-foreground">
          <Loader2 className="w-4 h-4 animate-spin" />
          <span className="text-xs">Loading...</span>
        </div>
      </div>
    );
  }

  const flags = data?.flags ?? [];

  return (
    <div className="card-surface p-4">
      <h3 className="text-sm font-semibold text-foreground mb-3 flex items-center gap-2">
        <GitCompareArrows className="w-4 h-4 text-primary-400" />
        Correlation Matrix
        {flags.length > 0 && (
          <span className="ml-auto text-xs font-mono px-1.5 py-0.5 bg-warning/20 text-warning rounded">
            {flags.length} pair{flags.length !== 1 ? 's' : ''}
          </span>
        )}
      </h3>

      {flags.length === 0 ? (
        <p className="text-xs text-muted-foreground py-2">
          No highly correlated pairs detected. Computed nightly.
        </p>
      ) : (
        <div className="space-y-2 max-h-64 overflow-y-auto">
          {flags.map((flag) => (
            <div
              key={`${flag.tickerA}-${flag.tickerB}`}
              className="flex items-center justify-between px-3 py-2 bg-navy-800 rounded-lg"
            >
              <div className="flex items-center gap-2">
                <AlertTriangle className="w-3.5 h-3.5 text-warning flex-shrink-0" />
                <span className="text-sm font-mono text-foreground">
                  {flag.tickerA}
                </span>
                <span className="text-xs text-muted-foreground">↔</span>
                <span className="text-sm font-mono text-foreground">
                  {flag.tickerB}
                </span>
              </div>
              <div className="flex items-center gap-2">
                <span className={`text-xs font-mono px-1.5 py-0.5 rounded ${
                  flag.correlation >= 0.9
                    ? 'bg-loss/20 text-loss'
                    : 'bg-warning/20 text-warning'
                }`}>
                  r={flag.correlation.toFixed(2)}
                </span>
              </div>
            </div>
          ))}
        </div>
      )}

      <p className="text-[10px] text-muted-foreground mt-3">
        90-day Pearson correlation. Pairs with r &gt; 0.75 flagged. Updated nightly.
      </p>
    </div>
  );
}
