export const dynamic = 'force-dynamic';

import { NextRequest, NextResponse } from 'next/server';
import { getAllFlags } from '@/lib/feature-flags';

export async function GET(_request: NextRequest) {
  return NextResponse.json({ flags: getAllFlags() });
}
