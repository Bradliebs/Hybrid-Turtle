import { describe, expect, it } from 'vitest';
import { countTruthyPassFlags, normalizePersistedPassFlag } from './scan-pass-flags';

describe('scan pass flag reconstruction', () => {
  it('preserves persisted true/false values', () => {
    expect(normalizePersistedPassFlag(true)).toBe(true);
    expect(normalizePersistedPassFlag(false)).toBe(false);
  });

  it('maps missing persisted values to undefined', () => {
    expect(normalizePersistedPassFlag(null)).toBeUndefined();
    expect(normalizePersistedPassFlag(undefined)).toBeUndefined();
  });

  it('never force-counts missing values as pass', () => {
    const values = [
      normalizePersistedPassFlag(true),
      normalizePersistedPassFlag(false),
      normalizePersistedPassFlag(null),
      normalizePersistedPassFlag(undefined),
    ];

    expect(countTruthyPassFlags(values)).toBe(1);
  });
});
