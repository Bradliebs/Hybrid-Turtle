'use client';

/**
 * DEPENDENCIES
 * Consumed by: /settings page
 * Consumes: /api/settings/telegram-test, TelegramWebhookPanel
 * Risk-sensitive: NO
 * Last modified: 2026-03-03
 * Notes: Notifications section — Telegram config, test, and webhook setup.
 */

import { useState, useCallback } from 'react';
import { apiRequest } from '@/lib/api-client';
import { cn } from '@/lib/utils';
import { Bell, TestTube, Eye, EyeOff, Loader2, Check } from 'lucide-react';
import TelegramWebhookPanel from '@/components/settings/TelegramWebhookPanel';

export default function NotificationsPanel() {
  const [telegramToken, setTelegramToken] = useState('');
  const [telegramChatId, setTelegramChatId] = useState('');
  const [showToken, setShowToken] = useState(false);
  const [telegramTesting, setTelegramTesting] = useState(false);
  const [telegramTestResult, setTelegramTestResult] = useState<{ success: boolean; message: string } | null>(null);

  const handleTelegramTest = useCallback(async () => {
    if (!telegramToken || !telegramChatId) {
      setTelegramTestResult({ success: false, message: 'Enter both Bot Token and Chat ID' });
      return;
    }
    setTelegramTesting(true);
    setTelegramTestResult(null);
    try {
      const data = await apiRequest<{ botName: string }>('/api/settings/telegram-test', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ botToken: telegramToken, chatId: telegramChatId }),
      });
      setTelegramTestResult({ success: true, message: `Test sent via ${data.botName}` });
    } catch (err) {
      setTelegramTestResult({ success: false, message: err instanceof Error ? err.message : 'Network error' });
    } finally {
      setTelegramTesting(false);
      setTimeout(() => setTelegramTestResult(null), 5000);
    }
  }, [telegramToken, telegramChatId]);

  return (
    <div className="card-surface p-6">
      <h2 className="text-lg font-semibold text-foreground flex items-center gap-2 mb-1">
        <Bell className="w-5 h-5 text-primary-400" />
        Notifications
      </h2>
      <p className="text-xs text-muted-foreground mb-4">
        In-app notifications are always on. Telegram alerts are optional.
      </p>

      {/* In-app — always on */}
      <div className="border border-border rounded-lg p-4 mb-4">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-3">
            <div className="w-8 h-8 rounded-lg bg-primary/20 border border-primary/30 flex items-center justify-center">
              <Bell className="w-4 h-4 text-primary-400" />
            </div>
            <div>
              <h3 className="text-sm font-semibold text-foreground">In-app notifications</h3>
              <p className="text-xs text-muted-foreground">Bell icon in navbar · Notification centre page</p>
            </div>
          </div>
          <span className="px-2.5 py-1 rounded-full bg-profit/15 text-profit text-[10px] font-bold uppercase tracking-wider">Always on</span>
        </div>
      </div>

      {/* Telegram */}
      <div className="border border-border rounded-lg p-4">
        <div className="flex items-center gap-3 mb-3">
          <div className="w-8 h-8 rounded-lg bg-blue-500/20 border border-blue-500/30 flex items-center justify-center">
            <span className="text-sm">✈</span>
          </div>
          <div>
            <h3 className="text-sm font-semibold text-foreground">Telegram alerts</h3>
            <p className="text-xs text-muted-foreground">Optional — receive alerts via Telegram message</p>
          </div>
        </div>

        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
          <div>
            <label className="block text-sm text-muted-foreground mb-1">Bot Token</label>
            <div className="relative">
              <input
                type={showToken ? 'text' : 'password'}
                value={telegramToken}
                onChange={(e) => setTelegramToken(e.target.value)}
                placeholder="Enter bot token"
                className="input-field w-full pr-10"
              />
              <button onClick={() => setShowToken(!showToken)} className="absolute right-3 top-1/2 -translate-y-1/2 text-muted-foreground hover:text-foreground" title="Toggle visibility">
                {showToken ? <EyeOff className="w-4 h-4" /> : <Eye className="w-4 h-4" />}
              </button>
            </div>
          </div>
          <div>
            <label className="block text-sm text-muted-foreground mb-1">Chat ID</label>
            <input type="text" value={telegramChatId} onChange={(e) => setTelegramChatId(e.target.value)} placeholder="Enter chat ID" className="input-field w-full" />
          </div>
        </div>

        <div className="flex items-center gap-3 mt-3">
          <button onClick={handleTelegramTest} disabled={telegramTesting} className="text-xs text-primary-400 hover:text-primary-300 flex items-center gap-1 disabled:opacity-50">
            {telegramTesting ? <Loader2 className="w-3 h-3 animate-spin" /> : <TestTube className="w-3 h-3" />}
            {telegramTesting ? 'Sending...' : 'Send Test Message'}
          </button>
          {telegramTestResult && (
            <span className={cn('text-xs', telegramTestResult.success ? 'text-green-400' : 'text-red-400')}>
              {telegramTestResult.success ? '✓' : '✗'} {telegramTestResult.message}
            </span>
          )}
        </div>

        <p className="text-xs text-muted-foreground mt-3">
          Telegram credentials are read from environment variables. Set TELEGRAM_BOT_TOKEN and TELEGRAM_CHAT_ID in .env.
        </p>

        {/* Webhook setup */}
        <TelegramWebhookPanel />
      </div>
    </div>
  );
}
