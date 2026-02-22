import { memo } from 'react';
import { cn } from '@/lib/utils';
import { Check, X } from 'lucide-react';

interface FilterResult {
  ticker: string;
  name: string;
  priceAboveMa200: boolean;
  adxAbove20: boolean;
  plusDIAboveMinusDI: boolean;
  atrPercentBelow8: boolean;
  efficiencyAbove30: boolean;
  dataQuality: boolean;
  passesAll: boolean;
}

interface TechnicalFilterGridProps {
  results: FilterResult[];
}

const filterLabels = [
  { key: 'priceAboveMa200', label: 'Price > 200 MA' },
  { key: 'adxAbove20', label: 'ADX ≥ 20' },
  { key: 'plusDIAboveMinusDI', label: '+DI > -DI' },
  { key: 'atrPercentBelow8', label: 'ATR% < cap' },
  { key: 'efficiencyAbove30', label: 'Efficiency ≥ 30%' },
  { key: 'dataQuality', label: 'Data Quality' },
];

function TechnicalFilterGrid({ results }: TechnicalFilterGridProps) {
  return (
    <div className="card-surface overflow-x-auto">
      <table className="data-table">
        <thead>
          <tr>
            <th>Ticker</th>
            {filterLabels.map((f) => (
              <th key={f.key} className="text-center">{f.label}</th>
            ))}
            <th className="text-center">Result</th>
          </tr>
        </thead>
        <tbody>
          {results.map((result) => (
            <tr key={result.ticker}>
              <td>
                <div>
                  <span className="text-primary-400 font-semibold">{result.ticker}</span>
                  <div className="text-xs text-muted-foreground">{result.name}</div>
                </div>
              </td>
              {filterLabels.map((f) => {
                const passed = result[f.key as keyof FilterResult];
                return (
                  <td key={f.key} className="text-center">
                    {passed ? (
                      <Check className="w-4 h-4 text-profit mx-auto" />
                    ) : (
                      <X className="w-4 h-4 text-loss mx-auto" />
                    )}
                  </td>
                );
              })}
              <td className="text-center">
                <span
                  className={cn(
                    'inline-flex items-center px-2 py-0.5 rounded-full text-xs font-bold',
                    result.passesAll
                      ? 'bg-profit/20 text-profit'
                      : 'bg-loss/20 text-loss'
                  )}
                >
                  {result.passesAll ? 'PASS' : 'FAIL'}
                </span>
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

export default memo(TechnicalFilterGrid);
