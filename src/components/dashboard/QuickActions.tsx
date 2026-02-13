'use client';

import Link from 'next/link';
import { TrendingUp, PieChart, ShieldCheck, Scale } from 'lucide-react';

const actions = [
  {
    label: 'Track Investments',
    description: 'Monitor your open positions',
    href: '/portfolio/positions',
    icon: TrendingUp,
    color: 'text-profit',
    bgColor: 'bg-profit/10',
  },
  {
    label: 'Build Portfolio',
    description: 'Run scans and find candidates',
    href: '/scan',
    icon: PieChart,
    color: 'text-primary-400',
    bgColor: 'bg-primary/10',
  },
  {
    label: 'Analyze Portfolio Risk',
    description: 'Review risk caps and exposure',
    href: '/risk',
    icon: ShieldCheck,
    color: 'text-warning',
    bgColor: 'bg-warning/10',
  },
  {
    label: 'Balance Portfolio',
    description: 'Check sleeve allocations',
    href: '/portfolio/distribution',
    icon: Scale,
    color: 'text-blue-400',
    bgColor: 'bg-blue-500/10',
  },
];

export default function QuickActions() {
  return (
    <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
      {actions.map((action) => {
        const Icon = action.icon;
        return (
          <Link
            key={action.label}
            href={action.href}
            className="card-surface p-4 hover:shadow-glow transition-all group cursor-pointer"
          >
            <div className={`${action.bgColor} w-10 h-10 rounded-lg flex items-center justify-center mb-3`}>
              <Icon className={`w-5 h-5 ${action.color}`} />
            </div>
            <h3 className="text-sm font-semibold text-foreground group-hover:text-primary-400 transition-colors">
              {action.label}
            </h3>
            <p className="text-xs text-muted-foreground mt-1">
              {action.description}
            </p>
          </Link>
        );
      })}
    </div>
  );
}
