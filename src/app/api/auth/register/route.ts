import { NextRequest, NextResponse } from 'next/server';
import { prisma } from '@/lib/prisma';
import bcrypt from 'bcryptjs';
import { apiError } from '@/lib/api-response';
import { z } from 'zod';
import { parseJsonBody } from '@/lib/request-validation';

const registerSchema = z.object({
  name: z.string().trim().min(1),
  email: z.string().trim().email(),
  password: z.string().min(8),
});

export async function POST(request: NextRequest) {
  try {
    const parsed = await parseJsonBody(request, registerSchema);
    if (!parsed.ok) {
      return parsed.response;
    }
    const { name, email, password } = parsed.data;

    // Check if user exists
    const existingUser = await prisma.user.findUnique({
      where: { email },
    });

    if (existingUser) {
      return apiError(409, 'EMAIL_ALREADY_EXISTS', 'An account with this email already exists');
    }

    // Hash password
    const hashedPassword = await bcrypt.hash(password, 12);

    // Create user
    const user = await prisma.user.create({
      data: {
        name,
        email,
        password: hashedPassword,
        riskProfile: 'BALANCED',
        equity: 100000,
      },
    });

    return NextResponse.json(
      { message: 'Account created successfully', userId: user.id },
      { status: 201 }
    );
  } catch (error) {
    console.error('Registration error:', error);
    return apiError(500, 'REGISTRATION_FAILED', 'Internal server error', (error as Error).message, true);
  }
}
