import { NextResponse } from 'next/server';

export interface ApiErrorPayload {
  ok: false;
  error: {
    code: string;
    message: string;
    details?: string;
    retryable?: boolean;
  };
}

export function apiError(
  status: number,
  code: string,
  message: string,
  details?: string,
  retryable?: boolean
) {
  return NextResponse.json<ApiErrorPayload>(
    {
      ok: false,
      error: { code, message, details, retryable },
    },
    { status }
  );
}
