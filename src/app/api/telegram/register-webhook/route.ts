/**
 * DEPENDENCIES
 * Consumed by: Settings page (webhook setup)
 * Consumes: Telegram Bot API (setWebhook, getWebhookInfo)
 * Risk-sensitive: NO
 * Last modified: 2026-03-03
 * Notes: POST registers the webhook URL with Telegram.
 *        GET returns current webhook status.
 */

export const dynamic = 'force-dynamic';

import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';
import { parseJsonBody } from '@/lib/request-validation';
import { apiError } from '@/lib/api-response';

const registerSchema = z.object({
  webhookUrl: z.string().url('Must be a valid URL'),
});

/**
 * POST /api/telegram/register-webhook
 * Registers the webhook URL with Telegram Bot API.
 */
export async function POST(request: NextRequest) {
  try {
    const botToken = process.env.TELEGRAM_BOT_TOKEN;
    if (!botToken) {
      return apiError(400, 'NO_BOT_TOKEN', 'TELEGRAM_BOT_TOKEN not configured in environment');
    }

    const parsed = await parseJsonBody(request, registerSchema);
    if (!parsed.ok) return parsed.response;
    const { webhookUrl } = parsed.data;

    // Call Telegram setWebhook
    const response = await fetch(
      `https://api.telegram.org/bot${botToken}/setWebhook`,
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ url: webhookUrl }),
      }
    );

    const data = await response.json();

    if (!data.ok) {
      return apiError(400, 'WEBHOOK_FAILED', data.description || 'Failed to set webhook');
    }

    const isLocalhost = webhookUrl.includes('localhost') || webhookUrl.includes('127.0.0.1');

    return NextResponse.json({
      success: true,
      description: data.description || 'Webhook set',
      url: webhookUrl,
      warning: isLocalhost
        ? 'Webhook URL appears to be localhost — Telegram cannot deliver messages to a local address. Use a tunnel like ngrok.'
        : null,
    });
  } catch (error) {
    console.error('[telegram/register-webhook] Error:', error);
    return apiError(500, 'WEBHOOK_REGISTER_FAILED', (error as Error).message, undefined, true);
  }
}

/**
 * GET /api/telegram/register-webhook
 * Returns current webhook status from Telegram.
 */
export async function GET(_request: NextRequest) {
  try {
    const botToken = process.env.TELEGRAM_BOT_TOKEN;
    if (!botToken) {
      return NextResponse.json({
        configured: false,
        url: null,
        error: 'TELEGRAM_BOT_TOKEN not set',
      });
    }

    const response = await fetch(
      `https://api.telegram.org/bot${botToken}/getWebhookInfo`
    );
    const data = await response.json();

    if (!data.ok) {
      return NextResponse.json({
        configured: false,
        url: null,
        error: data.description || 'Failed to get webhook info',
      });
    }

    const info = data.result;

    return NextResponse.json({
      configured: !!info.url,
      url: info.url || null,
      pendingUpdateCount: info.pending_update_count ?? 0,
      lastErrorDate: info.last_error_date
        ? new Date(info.last_error_date * 1000).toISOString()
        : null,
      lastErrorMessage: info.last_error_message ?? null,
      maxConnections: info.max_connections ?? null,
    });
  } catch (error) {
    console.error('[telegram/register-webhook] GET error:', error);
    return apiError(500, 'WEBHOOK_INFO_FAILED', (error as Error).message, undefined, true);
  }
}
