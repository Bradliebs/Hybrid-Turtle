import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';
import { parseJsonBody } from '@/lib/request-validation';
import { apiError } from '@/lib/api-response';

const telegramTestSchema = z.object({
  botToken: z.string().trim().min(1),
  chatId: z.string().trim().min(1),
});

/**
 * POST /api/settings/telegram-test
 * Sends a test message via Telegram using the provided token and chat ID.
 */
export async function POST(request: NextRequest) {
  try {
    const parsed = await parseJsonBody(request, telegramTestSchema);
    if (!parsed.ok) {
      return parsed.response;
    }
    const { botToken, chatId } = parsed.data;

    // First verify the bot token is valid
    const meResponse = await fetch(`https://api.telegram.org/bot${botToken}/getMe`);
    if (!meResponse.ok) {
      return apiError(400, 'INVALID_BOT_TOKEN', 'Invalid bot token — check the token and try again');
    }

    const meData = await meResponse.json();
    const botName = meData.result?.first_name || 'Unknown';

    // Send a test message
    const message = `🐢 <b>HybridTurtle Test</b>\n\nTelegram integration is working!\nBot: ${botName}\nTime: ${new Date().toLocaleString('en-GB', { timeZone: 'Europe/London' })}`;

    const sendResponse = await fetch(
      `https://api.telegram.org/bot${botToken}/sendMessage`,
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          chat_id: chatId,
          text: message,
          parse_mode: 'HTML',
          disable_web_page_preview: true,
        }),
      }
    );

    if (!sendResponse.ok) {
      const err = await sendResponse.json();
      const description = err?.description || 'Failed to send message';
      return apiError(400, 'TELEGRAM_SEND_FAILED', `Telegram error: ${description}`);
    }

    return NextResponse.json({ success: true, botName });
  } catch (error) {
    console.error('Telegram test error:', error);
    return apiError(500, 'TELEGRAM_TEST_FAILED', 'Failed to test Telegram connection', (error as Error).message, true);
  }
}
