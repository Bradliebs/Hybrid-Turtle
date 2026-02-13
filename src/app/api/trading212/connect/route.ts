import { NextRequest, NextResponse } from 'next/server';
import prisma from '@/lib/prisma';
import { Trading212Client } from '@/lib/trading212';
import { ensureDefaultUser } from '@/lib/default-user';
import { apiError } from '@/lib/api-response';
import { z } from 'zod';
import { parseJsonBody } from '@/lib/request-validation';

const connectSchema = z.object({
  apiKey: z.string().trim().min(1),
  apiSecret: z.string().trim().min(1),
  environment: z.enum(['demo', 'live']).optional(),
  userId: z.string().trim().min(1).optional(),
});

// POST /api/trading212/connect — Test connection and save credentials
export async function POST(request: NextRequest) {
  try {
    const parsed = await parseJsonBody(request, connectSchema);
    if (!parsed.ok) {
      return parsed.response;
    }
    const { apiKey, apiSecret, environment = 'demo' } = parsed.data;
    let { userId } = parsed.data;

    // Ensure user exists
    if (!userId) {
      userId = await ensureDefaultUser();
    }
    // Test the connection
    const client = new Trading212Client(apiKey, apiSecret, environment);
    const result = await client.testConnection();

    if (!result.ok) {
      return apiError(400, 'T212_CONNECT_FAILED', result.error || 'Failed to connect to Trading 212');
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
    return apiError(500, 'T212_CONNECT_FAILED', (error as Error).message || 'Failed to connect to Trading 212', undefined, true);
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
    return apiError(500, 'T212_DISCONNECT_FAILED', 'Failed to disconnect Trading 212', (error as Error).message, true);
  }
}
