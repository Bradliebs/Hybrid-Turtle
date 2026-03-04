import { describe, it, expect, vi, beforeEach } from 'vitest';

// Must mock before importing
vi.mock('./fetch-retry', async () => {
  const actual = await vi.importActual<typeof import('./fetch-retry')>('./fetch-retry');
  return { ...actual };
});

import { withRetry, YAHOO_RETRY_ENABLED } from './fetch-retry';

describe('withRetry', () => {
  beforeEach(() => {
    vi.restoreAllMocks();
  });

  it('returns result on first success', async () => {
    const fn = vi.fn().mockResolvedValue({ price: 100 });
    const result = await withRetry(fn, 'test:success');
    expect(result).toEqual({ price: 100 });
    expect(fn).toHaveBeenCalledTimes(1);
  });

  it('retries on 503 and succeeds on third attempt', async () => {
    const fn = vi.fn()
      .mockRejectedValueOnce(new Error('HTTP 503 Service Unavailable'))
      .mockRejectedValueOnce(new Error('HTTP 503 Service Unavailable'))
      .mockResolvedValueOnce({ price: 42 });

    const result = await withRetry(fn, 'test:503-retry');
    expect(result).toEqual({ price: 42 });
    expect(fn).toHaveBeenCalledTimes(3);
  });

  it('retries on 429 rate limit', async () => {
    const fn = vi.fn()
      .mockRejectedValueOnce(new Error('429 Too Many Requests'))
      .mockResolvedValueOnce({ data: 'ok' });

    const result = await withRetry(fn, 'test:429');
    expect(result).toEqual({ data: 'ok' });
    expect(fn).toHaveBeenCalledTimes(2);
  });

  it('retries on network errors', async () => {
    const fn = vi.fn()
      .mockRejectedValueOnce(new Error('fetch failed'))
      .mockResolvedValueOnce('ok');

    const result = await withRetry(fn, 'test:network');
    expect(result).toBe('ok');
    expect(fn).toHaveBeenCalledTimes(2);
  });

  it('does NOT retry on 400 client error', async () => {
    const fn = vi.fn()
      .mockRejectedValue(new Error('HTTP 400 Bad Request'));

    await expect(withRetry(fn, 'test:400')).rejects.toThrow('400 Bad Request');
    expect(fn).toHaveBeenCalledTimes(1);
  });

  it('does NOT retry on 404 not found', async () => {
    const fn = vi.fn()
      .mockRejectedValue(new Error('HTTP 404 Not Found'));

    await expect(withRetry(fn, 'test:404')).rejects.toThrow('404 Not Found');
    expect(fn).toHaveBeenCalledTimes(1);
  });

  it('throws after all retries exhausted', async () => {
    const fn = vi.fn()
      .mockRejectedValue(new Error('HTTP 503 Service Unavailable'));

    await expect(withRetry(fn, 'test:exhaust')).rejects.toThrow('503');
    // MAX_RETRIES = 3, so 3 total attempts
    expect(fn).toHaveBeenCalledTimes(3);
  });

  it('YAHOO_RETRY_ENABLED is true by default', () => {
    expect(YAHOO_RETRY_ENABLED).toBe(true);
  });
});
