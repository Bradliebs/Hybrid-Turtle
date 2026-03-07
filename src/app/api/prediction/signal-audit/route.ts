/**
 * DEPENDENCIES
 * Consumed by: /signal-audit page
 * Consumes: mutual-information.ts, prisma.ts, api-response.ts
 * Risk-sensitive: NO — analysis only
 * Last modified: 2026-03-07
 * Notes: POST triggers a new MI analysis. GET returns latest stored result.
 *        Analysis is compute-heavy so runs on-demand, not nightly.
 */

import { NextRequest, NextResponse } from 'next/server';
import { apiError } from '@/lib/api-response';
import { runSignalAudit, SIGNAL_LABELS } from '@/lib/prediction/mutual-information';
import { prisma } from '@/lib/prisma';
import { sendAlert } from '@/lib/alert-service';

export const dynamic = 'force-dynamic';

export async function POST() {
  try {
    const report = await runSignalAudit();

    // Build human-readable summary
    const keepSignals = report.conditionalMI.filter(s => s.recommendation === 'KEEP');
    const redundantSignals = report.conditionalMI.filter(s => s.recommendation === 'REDUNDANT');
    const summary = [
      `Analysis of ${report.sampleSize} observations.`,
      `Strong signals: ${keepSignals.map(s => SIGNAL_LABELS[s.signal]).join(', ') || 'none identified'}`,
      `Potentially redundant: ${redundantSignals.map(s => SIGNAL_LABELS[s.signal]).join(', ') || 'none'}`,
      report.highCorrelationPairs.length > 0
        ? `High correlation pairs: ${report.highCorrelationPairs.map(p => `${SIGNAL_LABELS[p.signalA]}↔${SIGNAL_LABELS[p.signalB]} (MI=${p.mi})`).join(', ')}`
        : 'No highly correlated signal pairs detected.',
    ].join(' ');

    // Persist
    await prisma.signalAuditResult.create({
      data: {
        sampleSize: report.sampleSize,
        hasOutcomes: report.conditionalMI.length > 0,
        miMatrix: JSON.stringify(report.miMatrix),
        conditionalMI: JSON.stringify(report.conditionalMI),
        highCorrPairs: report.highCorrelationPairs.length > 0
          ? JSON.stringify(report.highCorrelationPairs) : null,
        summary,
      },
    });

    // Notification: signal audit completed (item 27)
    const redundantCount = report.conditionalMI.filter(s => s.recommendation === 'REDUNDANT').length;
    await sendAlert({
      type: 'SIGNAL_AUDIT_COMPLETE',
      title: 'Signal Audit Complete',
      message: redundantCount > 0
        ? `Signal audit ready — ${redundantCount} signal${redundantCount > 1 ? 's' : ''} flagged for review`
        : `Signal audit complete — all signals contributing unique information`,
      priority: 'INFO',
      skipTelegram: true,
    }).catch(() => {});

    return NextResponse.json({
      ok: true,
      data: {
        miMatrix: report.miMatrix,
        conditionalMI: report.conditionalMI,
        highCorrPairs: report.highCorrelationPairs,
        sampleSize: report.sampleSize,
        computedAt: report.computedAt,
        summary,
      },
    });
  } catch (error) {
    console.error('[SignalAudit] Analysis error:', (error as Error).message);
    return apiError(500, 'SIGNAL_AUDIT_FAILED', 'Failed to run signal audit', (error as Error).message);
  }
}

export async function GET() {
  try {
    const latest = await prisma.signalAuditResult.findFirst({
      orderBy: { computedAt: 'desc' },
    });

    if (!latest) {
      return NextResponse.json({
        ok: true,
        data: { hasResult: false, result: null },
      });
    }

    return NextResponse.json({
      ok: true,
      data: {
        hasResult: true,
        result: {
          computedAt: latest.computedAt,
          sampleSize: latest.sampleSize,
          hasOutcomes: latest.hasOutcomes,
          miMatrix: JSON.parse(latest.miMatrix),
          conditionalMI: JSON.parse(latest.conditionalMI),
          highCorrPairs: latest.highCorrPairs ? JSON.parse(latest.highCorrPairs) : [],
          summary: latest.summary,
        },
      },
    });
  } catch (error) {
    return apiError(500, 'SIGNAL_AUDIT_FETCH_FAILED', 'Failed to fetch signal audit', (error as Error).message);
  }
}
