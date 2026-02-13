'use client';

interface StageFunnelProps {
  stages: {
    label: string;
    count: number;
    color: string;
  }[];
}

export default function StageFunnel({ stages }: StageFunnelProps) {
  const maxCount = Math.max(...stages.map((s) => s.count));

  return (
    <div className="card-surface p-4">
      <h3 className="text-sm font-semibold text-foreground mb-4">Scan Funnel</h3>
      <div className="space-y-2">
        {stages.map((stage, i) => {
          const widthPercent = maxCount > 0 ? (stage.count / maxCount) * 100 : 0;
          return (
            <div key={i} className="flex items-center gap-3">
              <span className="text-xs text-muted-foreground w-32 text-right truncate">
                {stage.label}
              </span>
              <div className="flex-1 h-7 bg-navy-800 rounded overflow-hidden relative">
                <div
                  className="h-full rounded transition-all duration-700 flex items-center px-2"
                  style={{
                    width: `${Math.max(widthPercent, 5)}%`,
                    backgroundColor: stage.color,
                    opacity: 0.8,
                  }}
                >
                  <span className="text-xs font-mono text-white font-bold">{stage.count}</span>
                </div>
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}
