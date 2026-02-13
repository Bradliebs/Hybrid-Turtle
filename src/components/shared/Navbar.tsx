'use client';

import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { cn } from '@/lib/utils';
import { MAIN_NAV_ITEMS, RISK_PROFILES } from '@/types';
import { useStore } from '@/store/useStore';
import {
  LayoutDashboard,
  Briefcase,
  Search,
  ClipboardList,
  ShieldAlert,
  Settings,
  User,
  Shield,
} from 'lucide-react';

const iconMap: Record<string, React.ReactNode> = {
  Dashboard: <LayoutDashboard className="w-4 h-4" />,
  Portfolio: <Briefcase className="w-4 h-4" />,
  Scan: <Search className="w-4 h-4" />,
  Plan: <ClipboardList className="w-4 h-4" />,
  Risk: <ShieldAlert className="w-4 h-4" />,
  Settings: <Settings className="w-4 h-4" />,
};

export default function Navbar() {
  const pathname = usePathname();
  const { riskProfile } = useStore();

  const profileConfig = RISK_PROFILES[riskProfile];
  const profileColor =
    riskProfile === 'CONSERVATIVE'
      ? { bg: 'bg-blue-500/15', border: 'border-blue-500/40', text: 'text-blue-400', dot: 'bg-blue-400' }
      : riskProfile === 'SMALL_ACCOUNT'
      ? { bg: 'bg-amber-500/15', border: 'border-amber-500/40', text: 'text-amber-400', dot: 'bg-amber-400' }
      : { bg: 'bg-primary/15', border: 'border-primary/40', text: 'text-primary-400', dot: 'bg-primary-400' };

  const isActive = (href: string) => {
    if (href === '/dashboard') return pathname === '/dashboard';
    return pathname.startsWith(href);
  };

  return (
    <nav className="sticky top-0 z-40 w-full border-b border-border bg-navy-900/95 backdrop-blur-md">
      <div className="max-w-[1600px] mx-auto px-4 sm:px-6">
        <div className="flex items-center justify-between h-16">
          {/* Logo */}
          <Link href="/dashboard" className="flex items-center gap-2">
            <div className="w-8 h-8 rounded-lg bg-primary flex items-center justify-center">
              <span className="text-white font-bold text-sm">🐢</span>
            </div>
            <span className="text-lg font-bold text-foreground">
              Hybrid<span className="text-primary-500">Turtle</span>
            </span>
            <span className="hidden sm:inline text-[10px] text-muted-foreground font-mono bg-navy-700/60 px-1.5 py-0.5 rounded border border-border/40">
              v6.0.0
            </span>
          </Link>

          {/* Navigation Links */}
          <div className="hidden md:flex items-center gap-1">
            {MAIN_NAV_ITEMS.map((item) => (
              <Link
                key={item.href}
                href={item.href}
                className={cn(
                  'flex items-center gap-2 px-3 py-2 rounded-lg text-sm font-medium transition-all',
                  isActive(item.href)
                    ? 'text-foreground bg-primary/15 border border-primary/30'
                    : 'text-muted-foreground hover:text-foreground hover:bg-navy-600/50'
                )}
              >
                {iconMap[item.label]}
                {item.label}
              </Link>
            ))}
          </div>

          {/* Right Section */}
          <div className="flex items-center gap-3">
            {/* Risk Profile Badge */}
            <Link
              href="/settings"
              className={cn(
                'hidden sm:flex items-center gap-1.5 px-2.5 py-1.5 rounded-lg text-xs font-semibold border transition-all hover:brightness-125',
                profileColor.bg,
                profileColor.border,
                profileColor.text
              )}
              title={`Risk Profile: ${profileConfig.name} — ${profileConfig.description}`}
            >
              <Shield className="w-3.5 h-3.5" />
              <span className={cn('w-1.5 h-1.5 rounded-full', profileColor.dot)} />
              {profileConfig.name}
            </Link>
            <Link
              href="/settings"
              className="flex items-center gap-2 p-1.5 rounded-lg hover:bg-navy-600/50 transition-colors"
              title="Account Settings"
            >
              <div className="w-8 h-8 rounded-full bg-primary/20 border border-primary/30 flex items-center justify-center">
                <User className="w-4 h-4 text-primary-400" />
              </div>
            </Link>
          </div>
        </div>
      </div>

      {/* Mobile Navigation */}
      <div className="md:hidden border-t border-border">
        <div className="flex overflow-x-auto px-2 py-1 gap-1">
          {MAIN_NAV_ITEMS.map((item) => (
            <Link
              key={item.href}
              href={item.href}
              className={cn(
                'flex items-center gap-1.5 px-3 py-2 rounded-md text-xs font-medium whitespace-nowrap transition-all',
                isActive(item.href)
                  ? 'text-foreground bg-primary/15'
                  : 'text-muted-foreground'
              )}
            >
              {iconMap[item.label]}
              {item.label}
            </Link>
          ))}
        </div>
      </div>
    </nav>
  );
}
