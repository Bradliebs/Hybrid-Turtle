import { PrismaClient } from '@prisma/client';
import '@/lib/env';

const globalForPrisma = globalThis as unknown as {
  prisma: PrismaClient | undefined;
};

export const prisma =
  globalForPrisma.prisma ??
  new PrismaClient({
    log: process.env.NODE_ENV === 'development' ? ['error', 'warn'] : ['error'],
  });

if (process.env.NODE_ENV !== 'production') globalForPrisma.prisma = prisma;

// SQLite concurrency: WAL allows reads during writes, busy_timeout retries
// instead of failing immediately with SQLITE_BUSY.
// WAL is persistent (stored in DB file), busy_timeout is per-connection.
// These run once per process on first import — errors are non-fatal.
prisma.$queryRawUnsafe('PRAGMA journal_mode = WAL;').catch(() => {});
prisma.$queryRawUnsafe('PRAGMA busy_timeout = 5000;').catch(() => {});

export default prisma;
