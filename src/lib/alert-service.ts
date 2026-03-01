/**
 * DEPENDENCIES
 * Consumed by: src/cron/nightly.ts, API routes
 * Consumes: prisma.ts, telegram.ts
 * Risk-sensitive: NO (delivery only — no trading logic)
 * Last modified: 2026-02-28
 * Notes: Layer 1 (DB) always fires. Layer 2 (Telegram) is optional.
 *        Layer 3 (Email) is a placeholder — not yet implemented.
 *        sendAlert() never throws. Errors are caught and logged.
 */

import prisma from '@/lib/prisma';
import { sendTelegramMessage } from '@/lib/telegram';

// ── Types ───────────────────────────────────────────────────────────

export type NotificationType =
  | 'TRADE_TRIGGER'
  | 'STOP_HIT'
  | 'PYRAMID_ADD'
  | 'WEEKLY_SUMMARY'
  | 'SYSTEM';

export type AlertPriority = 'INFO' | 'WARNING' | 'CRITICAL';

export interface AlertPayload {
  type: NotificationType;
  title: string;
  message: string;
  data?: Record<string, unknown>;
  priority: AlertPriority;
  /** When true, save to DB only — skip Telegram delivery. */
  skipTelegram?: boolean;
}

// ── Telegram Configuration Check ────────────────────────────────────
// Returns true only if both env vars are set and look plausible.
// Missing Telegram is a valid config choice — skip silently.

function isTelegramConfigured(): boolean {
  const token = process.env.TELEGRAM_BOT_TOKEN;
  const chatId = process.env.TELEGRAM_CHAT_ID;
  return (
    !!token &&
    !!chatId &&
    token.length > 10 &&
    chatId.length > 1
  );
}

// ── Email Placeholder ───────────────────────────────────────────────
// Layer 3 — future. Logs a message if email were to be configured.

function isEmailConfigured(): boolean {
  return !!process.env.EMAIL_SMTP_HOST;
}

function sendEmailAlert(_payload: AlertPayload): void {
  if (isEmailConfigured()) {
    console.log('[alert-service] Email alerts not yet implemented');
  }
  // No-op — silently skip
}

// ── Priority → Telegram emoji mapping ───────────────────────────────

function priorityEmoji(priority: AlertPriority): string {
  switch (priority) {
    case 'CRITICAL': return '🔴';
    case 'WARNING': return '⚠️';
    case 'INFO': return '🟢';
    default: return '📌';
  }
}

// ── Public API ──────────────────────────────────────────────────────

/**
 * Send an alert through all configured delivery layers.
 *
 * 1. Always saves to Notification table (Layer 1 — in-app)
 * 2. Attempts Telegram if configured (Layer 2)
 * 3. Placeholder for email (Layer 3 — future)
 *
 * Never throws. Errors are caught and logged.
 */
export async function sendAlert(payload: AlertPayload): Promise<void> {
  try {
    // Layer 1: Always save to DB (in-app notification centre)
    await prisma.notification.create({
      data: {
        type: payload.type,
        title: payload.title,
        message: payload.message,
        data: payload.data ? JSON.stringify(payload.data) : null,
        priority: payload.priority,
      },
    });
  } catch (error) {
    // DB write failed — log but don't throw
    console.error('[alert-service] Failed to save notification to DB:', (error as Error).message);
  }

  // Layer 2: Telegram (optional — skip silently if not configured or suppressed)
  if (isTelegramConfigured() && !payload.skipTelegram) {
    try {
      const emoji = priorityEmoji(payload.priority);
      const telegramText = `${emoji} <b>${escapeHtml(payload.title)}</b>\n\n${escapeHtml(payload.message)}`;
      await sendTelegramMessage({ text: telegramText, parseMode: 'HTML' });
    } catch (error) {
      // Telegram failed — not critical, in-app alert is already saved
      console.error('[alert-service] Telegram delivery failed:', (error as Error).message);
    }
  }

  // Layer 3: Email (placeholder — future)
  sendEmailAlert(payload);
}

/**
 * Send multiple alerts in sequence.
 * Convenience wrapper — each alert is independent.
 */
export async function sendAlerts(payloads: AlertPayload[]): Promise<void> {
  for (const payload of payloads) {
    await sendAlert(payload);
  }
}

// ── HTML escape for Telegram ────────────────────────────────────────

function escapeHtml(text: string): string {
  return text
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;');
}
