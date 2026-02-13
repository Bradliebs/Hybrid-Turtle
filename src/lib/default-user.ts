import prisma from '@/lib/prisma';

const DEFAULT_USER_ID = 'default-user';
const DEFAULT_USER_EMAIL = 'trader@hybridturtle.local';

/**
 * Ensures a default user exists in the database.
 * Returns the user ID.
 */
export async function ensureDefaultUser(): Promise<string> {
  const user = await prisma.user.upsert({
    where: { id: DEFAULT_USER_ID },
    update: {},
    create: {
      id: DEFAULT_USER_ID,
      email: DEFAULT_USER_EMAIL,
      name: 'Trader',
      password: '', // No password needed for local-only usage
      riskProfile: 'BALANCED',
      equity: 10000,
    },
  });

  return user.id;
}

export { DEFAULT_USER_ID };
