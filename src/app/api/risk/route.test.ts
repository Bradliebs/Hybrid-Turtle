import { describe, expect, it, vi, beforeEach } from 'vitest';
import type { NextRequest } from 'next/server';

const { prismaMock } = vi.hoisted(() => ({
  prismaMock: {
    user: { findUnique: vi.fn() },
    position: { findMany: vi.fn() },
  },
}));

vi.mock('@/lib/prisma', () => ({
  default: prismaMock,
}));

vi.mock('@/lib/default-user', () => ({
  ensureDefaultUser: vi.fn(async () => 'default-user'),
}));

vi.mock('@/lib/market-data', () => ({
  getBatchPrices: vi.fn(async () => ({ AAA: 90 })),
  normalizeBatchPricesToGBP: vi.fn(async () => ({ AAA: 90 })),
  normalizePriceToGBP: vi.fn(async (price: number) => price),
}));

vi.mock('@/lib/risk-gates', () => ({
  getRiskBudget: vi.fn(() => ({
    usedRiskPercent: 0,
    availableRiskPercent: 5.5,
    maxRiskPercent: 5.5,
    usedPositions: 1,
    maxPositions: 8,
    sleeveUtilization: {
      CORE: { used: 10, max: 60 },
      ETF: { used: 0, max: 20 },
      HIGH_RISK: { used: 0, max: 20 },
      HEDGE: { used: 0, max: 15 },
    },
  })),
}));

vi.mock('@/lib/equity-snapshot', () => ({
  recordEquitySnapshot: vi.fn(async () => undefined),
  getWeeklyEquityChangePercent: vi.fn(async () => ({
    weeklyChangePercent: null,
    maxOpenRiskUsedPercent: null,
  })),
}));

import { GET } from './route';

describe('/api/risk GET open risk fields', () => {
  beforeEach(() => {
    prismaMock.user.findUnique.mockReset();
    prismaMock.position.findMany.mockReset();
  });

  it('returns openRiskGBP computed as max(0, current-stop)*shares and keeps compatibility risk field', async () => {
    prismaMock.user.findUnique.mockResolvedValue({
      equity: 10_000,
      riskProfile: 'BALANCED',
    });

    prismaMock.position.findMany.mockResolvedValue([
      {
        id: 'p1',
        entryPrice: 100,
        currentStop: 95,
        initialRisk: 5,
        shares: 10,
        protectionLevel: 'INITIAL',
        stock: {
          ticker: 'AAA',
          sleeve: 'CORE',
          sector: 'TECH',
          cluster: 'SOFTWARE',
          currency: 'GBP',
        },
      },
    ]);

    const request = {
      nextUrl: new URL('http://localhost/api/risk?userId=u1'),
    } as unknown as NextRequest;

    const response = await GET(request);
    const body = await response.json();

    const expectedOpenRisk = Math.max(0, (90 - 95) * 10);
    expect(body.positions[0].openRiskGBP).toBe(expectedOpenRisk);
    expect(body.positions[0].riskDollars).toBe(expectedOpenRisk);
  });
});
