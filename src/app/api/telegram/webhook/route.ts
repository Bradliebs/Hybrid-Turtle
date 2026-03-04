/**
 * DEPENDENCIES
 * Consumed by: Telegram Bot API (webhook delivery)
 * Consumes: telegram-commands.ts
 * Risk-sensitive: NO (read-only command responses)
 * Last modified: 2026-03-03
 * Notes: Always returns 200 to Telegram — even on errors.
 *        Unauthorised chat IDs are silently ignored.
 */

export const dynamic = 'force-dynamic';

import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';
import { parseCommand, handleCommand, type TelegramUpdate } from '@/lib/telegram-commands';

// Zod schema for Telegram Update (loose — only what we need)
const telegramUpdateSchema = z.object({
  update_id: z.number(),
  message: z.object({
    message_id: z.number(),
    from: z.object({ id: z.number() }).passthrough(),
    chat: z.object({ id: z.number() }).passthrough(),
    text: z.string().optional(),
    date: z.number(),
  }).passthrough().optional(),
}).passthrough();

/**
 * POST /api/telegram/webhook
 * Receives inbound messages from Telegram Bot API.
 * Must always return 200 — non-200 causes Telegram retry loops.
 */
export async function POST(request: NextRequest) {
  try {
    const body = await request.json();
    const parsed = telegramUpdateSchema.safeParse(body);

    if (!parsed.success) {
      console.warn('[telegram/webhook] Invalid update shape:', parsed.error.message);
      return NextResponse.json({ ok: true }); // 200 always
    }

    const update = parsed.data as TelegramUpdate;

    // No message or no text — ignore (could be edit, reaction, etc.)
    if (!update.message?.text) {
      return NextResponse.json({ ok: true });
    }

    const chatId = update.message.chat.id;
    const text = update.message.text;

    // ── Security: verify chat ID ──
    const authorisedChatId = process.env.TELEGRAM_CHAT_ID;
    if (!authorisedChatId || String(chatId) !== authorisedChatId) {
      console.warn(`[telegram/webhook] Unauthorised chat ID: ${chatId} (expected: ${authorisedChatId ?? 'not set'})`);
      return NextResponse.json({ ok: true }); // Silent ignore
    }

    // ── Parse and handle command ──
    const command = parseCommand(text);
    const response = await handleCommand(command);

    // ── Send response via Telegram ──
    const botToken = process.env.TELEGRAM_BOT_TOKEN;
    if (!botToken) {
      console.error('[telegram/webhook] TELEGRAM_BOT_TOKEN not set');
      return NextResponse.json({ ok: true });
    }

    await fetch(`https://api.telegram.org/bot${botToken}/sendMessage`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        chat_id: chatId,
        text: response.text,
        parse_mode: response.parseMode,
        disable_web_page_preview: true,
      }),
    });

    return NextResponse.json({ ok: true });
  } catch (err) {
    console.error('[telegram/webhook] Error:', err);
    return NextResponse.json({ ok: true }); // 200 always
  }
}
