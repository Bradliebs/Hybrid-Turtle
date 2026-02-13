import { NextRequest, NextResponse } from 'next/server';

/**
 * POST /api/settings/telegram-test
 * Sends a test message via Telegram using the provided token and chat ID.
 */
export async function POST(request: NextRequest) {
  try {
    const { botToken, chatId } = await request.json();

    if (!botToken || !chatId) {
      return NextResponse.json(
        { error: 'Bot token and chat ID are required' },
        { status: 400 }
      );
    }

    // First verify the bot token is valid
    const meResponse = await fetch(`https://api.telegram.org/bot${botToken}/getMe`);
    if (!meResponse.ok) {
      return NextResponse.json(
        { error: 'Invalid bot token — check the token and try again' },
        { status: 400 }
      );
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
      return NextResponse.json(
        { error: `Telegram error: ${description}` },
        { status: 400 }
      );
    }

    return NextResponse.json({ success: true, botName });
  } catch (error) {
    console.error('Telegram test error:', error);
    return NextResponse.json(
      { error: 'Failed to test Telegram connection' },
      { status: 500 }
    );
  }
}
