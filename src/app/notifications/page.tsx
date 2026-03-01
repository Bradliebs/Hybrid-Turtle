'use client';

import { useState, useEffect, useCallback } from 'react';
import Navbar from '@/components/shared/Navbar';
import { cn } from '@/lib/utils';
import {
  Bell,
  CheckCircle,
  CheckCheck,
  AlertTriangle,
  TrendingUp,
  BarChart3,
  Shield,
  Info,
  Loader2,
} from 'lucide-react';

// ── Types ───────────────────────────────────────────────────────────

interface Notification {
  id: number;
  createdAt: string;
  readAt: string | null;
  type: string;
  title: string;
  message: string;
  data: string | null;
  priority: string;
}

// ── Helpers ─────────────────────────────────────────────────────────

function timeAgo(dateStr: string): string {
  const diff = Date.now() - new Date(dateStr).getTime();
  const mins = Math.floor(diff / 60_000);
  if (mins < 1) return 'just now';
  if (mins < 60) return `${mins} min${mins !== 1 ? 's' : ''} ago`;
  const hours = Math.floor(mins / 60);
  if (hours < 24) return `${hours} hour${hours !== 1 ? 's' : ''} ago`;
  const days = Math.floor(hours / 24);
  if (days < 7) return `${days} day${days !== 1 ? 's' : ''} ago`;
  return new Date(dateStr).toLocaleDateString();
}

function typeIcon(type: string) {
  switch (type) {
    case 'TRADE_TRIGGER': return <TrendingUp className="w-5 h-5 text-profit" />;
    case 'STOP_HIT': return <AlertTriangle className="w-5 h-5 text-loss" />;
    case 'BREAKOUT_FAILURE': return <AlertTriangle className="w-5 h-5 text-amber-400" />;
    case 'PYRAMID_ADD': return <BarChart3 className="w-5 h-5 text-primary-400" />;
    case 'WEEKLY_SUMMARY': return <BarChart3 className="w-5 h-5 text-blue-400" />;
    case 'SYSTEM': return <Shield className="w-5 h-5 text-muted-foreground" />;
    default: return <Info className="w-5 h-5 text-muted-foreground" />;
  }
}

function typeLabel(type: string): string {
  switch (type) {
    case 'TRADE_TRIGGER': return 'Trade Alert';
    case 'STOP_HIT': return 'Stop Hit';
    case 'BREAKOUT_FAILURE': return 'Breakout Failure';
    case 'PYRAMID_ADD': return 'Pyramid Add';
    case 'WEEKLY_SUMMARY': return 'Weekly Summary';
    case 'SYSTEM': return 'System';
    default: return type;
  }
}

function priorityBorder(priority: string): string {
  switch (priority) {
    case 'CRITICAL': return 'border-l-loss';
    case 'WARNING': return 'border-l-amber-500';
    case 'INFO': return 'border-l-primary';
    default: return 'border-l-border';
  }
}

// ── Page Component ──────────────────────────────────────────────────

export default function NotificationsPage() {
  const [notifications, setNotifications] = useState<Notification[]>([]);
  const [unreadCount, setUnreadCount] = useState(0);
  const [loading, setLoading] = useState(true);
  const [filter, setFilter] = useState<'all' | 'unread'>('all');

  const fetchNotifications = useCallback(async () => {
    try {
      const params = new URLSearchParams();
      if (filter === 'unread') params.set('unreadOnly', 'true');
      params.set('limit', '100');
      const res = await fetch(`/api/notifications?${params.toString()}`);
      if (res.ok) {
        const data = await res.json();
        setNotifications(data.notifications || []);
        setUnreadCount(data.unreadCount ?? 0);
      }
    } catch {
      console.error('Failed to fetch notifications');
    } finally {
      setLoading(false);
    }
  }, [filter]);

  useEffect(() => {
    fetchNotifications();
  }, [fetchNotifications]);

  const markAsRead = async (id: number) => {
    try {
      const res = await fetch(`/api/notifications/${id}/read`, { method: 'POST' });
      if (res.ok) {
        setNotifications((prev) =>
          prev.map((n) => (n.id === id ? { ...n, readAt: new Date().toISOString() } : n))
        );
        setUnreadCount((c) => Math.max(0, c - 1));
      }
    } catch {
      console.error('Failed to mark notification as read');
    }
  };

  const markAllAsRead = async () => {
    try {
      const res = await fetch('/api/notifications/read-all', { method: 'POST' });
      if (res.ok) {
        setNotifications((prev) =>
          prev.map((n) => ({ ...n, readAt: n.readAt || new Date().toISOString() }))
        );
        setUnreadCount(0);
      }
    } catch {
      console.error('Failed to mark all as read');
    }
  };

  return (
    <div className="min-h-screen bg-background">
      <Navbar />

      <main className="max-w-3xl mx-auto px-4 sm:px-6 py-6 space-y-6 animate-fade-in">
        {/* Header */}
        <div className="flex items-center justify-between">
          <div>
            <h1 className="text-2xl font-bold text-foreground flex items-center gap-3">
              <Bell className="w-6 h-6 text-primary-400" />
              Notifications
              {unreadCount > 0 && (
                <span className="ml-1 px-2 py-0.5 text-xs font-bold rounded-full bg-loss text-white">
                  {unreadCount}
                </span>
              )}
            </h1>
            <p className="text-sm text-muted-foreground mt-1">
              Trade alerts, stop warnings, and weekly summaries
            </p>
          </div>
          <div className="flex items-center gap-2">
            {/* Filter tabs */}
            <div className="flex gap-1 bg-surface-2 rounded-lg p-1">
              <button
                onClick={() => setFilter('all')}
                className={cn(
                  'px-3 py-1.5 text-xs rounded-md transition-colors',
                  filter === 'all'
                    ? 'bg-primary text-white'
                    : 'text-muted-foreground hover:text-foreground'
                )}
              >
                All
              </button>
              <button
                onClick={() => setFilter('unread')}
                className={cn(
                  'px-3 py-1.5 text-xs rounded-md transition-colors',
                  filter === 'unread'
                    ? 'bg-primary text-white'
                    : 'text-muted-foreground hover:text-foreground'
                )}
              >
                Unread
              </button>
            </div>
            {unreadCount > 0 && (
              <button
                onClick={markAllAsRead}
                className="flex items-center gap-1.5 px-3 py-1.5 text-xs text-primary-400 hover:text-primary-300 border border-primary/30 rounded-lg transition-colors"
              >
                <CheckCheck className="w-3.5 h-3.5" />
                Mark all as read
              </button>
            )}
          </div>
        </div>

        {/* Notification List */}
        {loading ? (
          <div className="flex items-center justify-center py-16">
            <Loader2 className="w-6 h-6 animate-spin text-primary-400" />
            <span className="ml-2 text-sm text-muted-foreground">Loading notifications...</span>
          </div>
        ) : notifications.length === 0 ? (
          <div className="card-surface p-12 text-center">
            <Bell className="w-12 h-12 text-muted-foreground/30 mx-auto mb-3" />
            <p className="text-muted-foreground">
              {filter === 'unread' ? 'No unread notifications' : 'No notifications yet'}
            </p>
            <p className="text-xs text-muted-foreground mt-1">
              Alerts will appear here when the nightly pipeline runs
            </p>
          </div>
        ) : (
          <div className="space-y-2">
            {notifications.map((notification) => {
              const isUnread = !notification.readAt;
              return (
                <div
                  key={notification.id}
                  className={cn(
                    'card-surface p-4 border-l-4 transition-all',
                    priorityBorder(notification.priority),
                    isUnread
                      ? 'bg-surface-2/80'
                      : 'opacity-60'
                  )}
                >
                  <div className="flex items-start gap-3">
                    {/* Type icon */}
                    <div className="flex-shrink-0 mt-0.5">
                      {typeIcon(notification.type)}
                    </div>

                    {/* Content */}
                    <div className="flex-1 min-w-0">
                      <div className="flex items-center gap-2 mb-1">
                        <span className="text-[10px] font-medium text-muted-foreground uppercase tracking-wider">
                          {typeLabel(notification.type)}
                        </span>
                        <span className="text-[10px] text-muted-foreground">
                          — {timeAgo(notification.createdAt)}
                        </span>
                        {isUnread && (
                          <span className="w-2 h-2 rounded-full bg-primary animate-pulse" />
                        )}
                      </div>
                      <h3 className={cn(
                        'text-sm font-semibold mb-1',
                        isUnread ? 'text-foreground' : 'text-muted-foreground'
                      )}>
                        {notification.title}
                      </h3>
                      <p className="text-xs text-muted-foreground whitespace-pre-line leading-relaxed">
                        {notification.message}
                      </p>
                    </div>

                    {/* Mark as read button */}
                    {isUnread && (
                      <button
                        onClick={() => markAsRead(notification.id)}
                        className="flex-shrink-0 p-1.5 rounded-lg hover:bg-navy-600/50 transition-colors text-muted-foreground hover:text-foreground"
                        title="Mark as read"
                      >
                        <CheckCircle className="w-4 h-4" />
                      </button>
                    )}
                  </div>
                </div>
              );
            })}
          </div>
        )}
      </main>
    </div>
  );
}
