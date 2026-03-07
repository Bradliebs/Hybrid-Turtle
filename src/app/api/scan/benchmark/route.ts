/**
 * DEPENDENCIES
 * Consumed by: Scan page (benchmark tab)
 * Consumes: benchmark-scan.ts
 * Risk-sensitive: NO — read-only comparison data
 * Last modified: 2026-03-06
 */
import { NextResponse } from 'next/server';
import { isEnabled } from '@/lib/feature-flags';
import { runBenchmarkScan } from '@/lib/benchmark-scan';
import prisma from '@/lib/prisma';

export async function GET() {
  if (!isEnabled('BENCHMARK_SCAN_MODE')) {
    return NextResponse.json(
      { ok: false, error: 'Benchmark scan mode is not enabled. Enable BENCHMARK_SCAN_MODE in feature flags.' },
      { status: 403 }
    );
  }

  // Get active user for equity/profile
  const user = await prisma.user.findFirst();
  if (!user) {
    return NextResponse.json({ ok: false, error: 'No user found' }, { status: 404 });
  }

  const equity = user.equity;
  const riskProfile = (user.riskProfile || 'SMALL_ACCOUNT') as 'CONSERVATIVE' | 'BALANCED' | 'SMALL_ACCOUNT' | 'AGGRESSIVE';

  const result = await runBenchmarkScan(equity, riskProfile);

  return NextResponse.json({
    ok: true,
    ...result,
  });
}
