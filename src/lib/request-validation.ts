import { NextRequest } from 'next/server';
import { z } from 'zod';
import { apiError } from '@/lib/api-response';

type ValidationResult<T> =
  | { ok: true; data: T }
  | { ok: false; response: ReturnType<typeof apiError> };

function formatZodError(error: z.ZodError): string {
  return error.issues
    .map((issue) => {
      const path = issue.path.length > 0 ? issue.path.join('.') : 'body';
      return `${path}: ${issue.message}`;
    })
    .join('; ');
}

export async function parseJsonBody<TSchema extends z.ZodTypeAny>(
  request: NextRequest,
  schema: TSchema
): Promise<ValidationResult<z.infer<TSchema>>> {
  let rawBody: unknown;

  try {
    rawBody = await request.json();
  } catch {
    return {
      ok: false,
      response: apiError(400, 'INVALID_JSON', 'Request body must be valid JSON'),
    };
  }

  const parsed = schema.safeParse(rawBody);
  if (!parsed.success) {
    return {
      ok: false,
      response: apiError(
        400,
        'INVALID_REQUEST',
        'Invalid request payload',
        formatZodError(parsed.error)
      ),
    };
  }

  return { ok: true, data: parsed.data };
}
