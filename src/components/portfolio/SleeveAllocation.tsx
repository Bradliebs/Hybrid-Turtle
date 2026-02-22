import { memo } from 'react';
import { cn } from '@/lib/utils';

interface SleeveData {
  name: string;
  used: number;
  max: number;
  nominalMax?: number;
  color: string;
}

interface SleeveAllocationProps {
  sleeves?: SleeveData[];
}

function SleeveAllocation({ sleeves = [] }: SleeveAllocationProps) {
  return (
    <div className="card-surface p-4">
      <h3 className="text-sm font-semibold text-foreground mb-4">Sleeve Allocation</h3>
      <div className="space-y-4">
        {sleeves.length === 0 && (
          <div className="text-xs text-muted-foreground text-center py-4">
            No sleeve data available yet.
          </div>
        )}
        {sleeves.map((sleeve) => {
          const percent = Math.min((sleeve.used / sleeve.max) * 100, 100);
          const isNearLimit = sleeve.used > sleeve.max * 0.9;
          const isOverLimit = sleeve.used > sleeve.max;
          const isRelaxed = sleeve.nominalMax !== undefined && sleeve.max > sleeve.nominalMax;

          return (
            <div key={sleeve.name}>
              <div className="flex items-center justify-between mb-1">
                <span className="text-sm text-muted-foreground">{sleeve.name}</span>
                <span
                  className={cn(
                    'text-sm font-mono',
                    isOverLimit ? 'text-loss' : isNearLimit ? 'text-warning' : 'text-foreground'
                  )}
                >
                  {sleeve.used.toFixed(0)}%{' '}
                  <span className="text-muted-foreground">
                    / {sleeve.nominalMax ?? sleeve.max}%
                  </span>
                </span>
              </div>
              <div className="w-full h-2.5 bg-navy-800 rounded-full overflow-hidden">
                <div
                  className="h-full rounded-full transition-all duration-500"
                  style={{
                    width: `${percent}%`,
                    backgroundColor: isOverLimit ? '#ef4444' : isNearLimit ? '#f59e0b' : sleeve.color,
                  }}
                />
              </div>
              {isRelaxed && sleeve.used > (sleeve.nominalMax ?? 0) && (
                <div className="text-[10px] text-muted-foreground mt-0.5">
                  Cap relaxed — few positions held
                </div>
              )}
            </div>
          );
        })}
      </div>
    </div>
  );
}

export default memo(SleeveAllocation);
