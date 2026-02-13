import { NextRequest, NextResponse } from 'next/server';
import prisma from '@/lib/prisma';
import { Trading212Client } from '@/lib/trading212';
import { ensureDefaultUser } from '@/lib/default-user';

// POST /api/trading212/connect — Test connection and save credentials
export async function POST(request: NextRequest) {
  try {
    const body = await request.json();
    const { apiKey, apiSecret, environment = 'demo' } = body;
    let { userId } = body;

    // Ensure user exists
    if (!userId) {
      userId = await ensureDefaultUser();
    }

    if (!apiKey || !apiSecret) {
      return NextResponse.json({ error: 'API Key and API Secret are required' }, { status: 400 });
    }

    // Test the connection
    const client = new Trading212Client(apiKey, apiSecret, environment);
    const result = await client.testConnection();

    if (!result.ok) {
      return NextResponse.json(
        { error: result.error || 'Failed to connect to Trading 212' },
        { status: 400 }
      );
    }

    // Save credentials to user profile (ensure user exists first)
    await ensureDefaultUser();
    await prisma.user.update({
      where: { id: userId },
      data: {
        t212ApiKey: apiKey,
        t212ApiSecret: apiSecret,
        t212Environment: environment,
        t212Connected: true,
        t212AccountId: result.accountId?.toString(),
        t212Currency: result.currency,
      },
    });

    return NextResponse.json({
      success: true,
      accountId: result.accountId,
      currency: result.currency,
      environment,
    });
  } catch (error) {
    console.error('Trading 212 connect error:', error);
    return NextResponse.json(
      { error: (error as Error).message || 'Failed to connect to Trading 212' },
      { status: 500 }
    );
  }
}

// DELETE /api/trading212/connect — Disconnect Trading 212
export async function DELETE(request: NextRequest) {
  try {
    const { searchParams } = request.nextUrl;
    let userId = searchParams.get('userId');

    if (!userId) {
      userId = await ensureDefaultUser();
    }

    await prisma.user.update({
      where: { id: userId },
      data: {
        t212ApiKey: null,
        t212ApiSecret: null,
        t212Connected: false,
        t212LastSync: null,
        t212AccountId: null,
        t212Currency: null,
      },
    });

    return NextResponse.json({ success: true });
  } catch (error) {
    console.error('Trading 212 disconnect error:', error);
    return NextResponse.json(
      { error: 'Failed to disconnect Trading 212' },
      { status: 500 }
    );
  }
}
