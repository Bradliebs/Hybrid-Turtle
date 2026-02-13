import { z } from 'zod';

const envSchema = z.object({
  DATABASE_URL: z.string().min(1, 'DATABASE_URL is required'),
  NEXTAUTH_SECRET: z.string().min(1, 'NEXTAUTH_SECRET is required'),
  CRON_SECRET: z.string().min(1, 'CRON_SECRET is required'),
  NEXTAUTH_URL: z.string().url('NEXTAUTH_URL must be a valid URL').optional(),
  NODE_ENV: z.enum(['development', 'test', 'production']).optional(),
});

function formatEnvIssues(issues: z.ZodIssue[]): string {
  return issues
    .map((issue) => {
      const key = issue.path.join('.') || 'environment';
      return `${key}: ${issue.message}`;
    })
    .join('; ');
}

function validateEnv() {
  const isTest = process.env.NODE_ENV === 'test';
  const isProduction = process.env.NODE_ENV === 'production';
  const isBuildPhase = process.env.NEXT_PHASE === 'phase-production-build';

  if (isTest) {
    return;
  }

  // Enforce fail-fast secrets at runtime startup, not during static build collection.
  if (!isProduction || isBuildPhase) {
    return;
  }

  const result = envSchema.safeParse(process.env);
  if (!result.success) {
    const diagnostics = formatEnvIssues(result.error.issues);
    throw new Error(
      `[Startup Env Validation Failed] ${diagnostics}`
    );
  }
}

validateEnv();
