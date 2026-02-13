export class ApiClientError extends Error {
  status: number;
  code?: string;
  details?: string;
  retryable?: boolean;

  constructor(message: string, status: number, code?: string, details?: string, retryable?: boolean) {
    super(message);
    this.name = 'ApiClientError';
    this.status = status;
    this.code = code;
    this.details = details;
    this.retryable = retryable;
  }
}

function parseErrorPayload(payload: unknown): {
  message: string;
  code?: string;
  details?: string;
  retryable?: boolean;
} {
  const fallback = { message: 'Request failed' };

  if (!payload || typeof payload !== 'object') return fallback;

  const obj = payload as Record<string, unknown>;

  // New contract: { ok: false, error: { code, message, details, retryable } }
  const nested = obj.error;
  if (nested && typeof nested === 'object') {
    const errObj = nested as Record<string, unknown>;
    return {
      message: typeof errObj.message === 'string' ? errObj.message : fallback.message,
      code: typeof errObj.code === 'string' ? errObj.code : undefined,
      details: typeof errObj.details === 'string' ? errObj.details : undefined,
      retryable: typeof errObj.retryable === 'boolean' ? errObj.retryable : undefined,
    };
  }

  // Legacy contract: { error: 'message', message?: 'details', code?: 'X' }
  return {
    message: typeof obj.error === 'string'
      ? obj.error
      : typeof obj.message === 'string'
      ? obj.message
      : fallback.message,
    code: typeof obj.code === 'string' ? obj.code : undefined,
    details: typeof obj.message === 'string' ? obj.message : undefined,
    retryable: undefined,
  };
}

export async function apiRequest<T>(input: RequestInfo | URL, init?: RequestInit): Promise<T> {
  const response = await fetch(input, init);

  let payload: unknown = null;
  try {
    payload = await response.json();
  } catch {
    // Non-JSON response
  }

  if (!response.ok) {
    const err = parseErrorPayload(payload);
    throw new ApiClientError(err.message, response.status, err.code, err.details, err.retryable);
  }

  return payload as T;
}
