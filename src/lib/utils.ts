import { type ClassValue, clsx } from 'clsx';
import { twMerge } from 'tailwind-merge';

export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs));
}

export function formatCurrency(value: number, currency = 'GBP'): string {
  return new Intl.NumberFormat('en-GB', {
    style: 'currency',
    currency,
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  }).format(value);
}

/**
 * Format a price in its native/trading currency — matches what T212 shows.
 * GBX (pence) → "2,116.00p", USD → "$182.50", GBP → "£21.16", EUR → "€45.30"
 */
export function formatPrice(value: number, priceCurrency = 'GBP'): string {
  if (priceCurrency === 'GBX' || priceCurrency === 'GBp') {
    return `${new Intl.NumberFormat('en-GB', {
      minimumFractionDigits: 2,
      maximumFractionDigits: 2,
    }).format(value)}p`;
  }
  return new Intl.NumberFormat('en-GB', {
    style: 'currency',
    currency: priceCurrency,
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  }).format(value);
}

export function formatPercent(value: number, decimals = 2): string {
  const sign = value >= 0 ? '+' : '';
  return `${sign}${value.toFixed(decimals)}%`;
}

export function formatNumber(value: number, decimals = 0): string {
  return new Intl.NumberFormat('en-US', {
    minimumFractionDigits: decimals,
    maximumFractionDigits: decimals,
  }).format(value);
}

export function formatR(rMultiple: number): string {
  const sign = rMultiple >= 0 ? '+' : '';
  return `${sign}${rMultiple.toFixed(1)}R`;
}

export function formatDate(date: Date | string): string {
  return new Date(date).toLocaleDateString('en-US', {
    year: 'numeric',
    month: 'short',
    day: 'numeric',
  });
}

export function formatDateTime(date: Date | string): string {
  return new Date(date).toLocaleString('en-US', {
    year: 'numeric',
    month: 'short',
    day: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  });
}

export function getDayOfWeek(): number {
  return new Date().getDay();
}

export function isMonday(): boolean {
  return getDayOfWeek() === 1;
}

export function isSunday(): boolean {
  return getDayOfWeek() === 0;
}

export function isTuesday(): boolean {
  return getDayOfWeek() === 2;
}

export function getWeekStart(date: Date = new Date()): Date {
  const d = new Date(date);
  const day = d.getDay();
  d.setDate(d.getDate() - day);
  d.setHours(0, 0, 0, 0);
  return d;
}

export function timeSince(date: Date | string): string {
  const seconds = Math.floor((new Date().getTime() - new Date(date).getTime()) / 1000);
  
  if (seconds < 60) return `${seconds}s ago`;
  if (seconds < 3600) return `${Math.floor(seconds / 60)}m ago`;
  if (seconds < 86400) return `${Math.floor(seconds / 3600)}h ago`;
  return `${Math.floor(seconds / 86400)}d ago`;
}
