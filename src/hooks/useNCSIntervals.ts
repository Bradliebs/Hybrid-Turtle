/**
 * DEPENDENCIES
 * Consumed by: TodayPanel.tsx (or any component needing NCS intervals)
 * Consumes: /api/prediction/calibrate (GET for status), conformal-calibrator.ts (client-side math)
 * Risk-sensitive: NO — read-only
 * Last modified: 2026-03-07
 * Notes: Fetches calibration parameters once, then computes intervals client-side.
 *        Avoids N API calls per candidate.
 */

'use client';

import { useState, useEffect, useCallback } from 'react';
import {
  getInterval,
  classifyConfidence,
  type ConformalInterval,
  type IntervalConfidence,
} from '@/lib/prediction/conformal-calibrator';

interface CalibrationData {
  qHatUp: number;
  qHatDown: number;
  coverageLevel: number;
  sampleSize: number;
  source: string;
  calibratedAt: string;
}

interface CalibrationStatus {
  hasCalibration: boolean;
  calibration: CalibrationData | null;
  loading: boolean;
}

export interface NCSIntervalResult {
  interval: ConformalInterval | null;
  confidence: IntervalConfidence | null;
}

/**
 * Hook that fetches conformal calibration data once and provides
 * a function to compute intervals for any NCS score.
 */
export function useNCSIntervals(): {
  status: CalibrationStatus;
  getIntervalForNCS: (ncs: number) => NCSIntervalResult;
} {
  const [status, setStatus] = useState<CalibrationStatus>({
    hasCalibration: false,
    calibration: null,
    loading: true,
  });

  useEffect(() => {
    let cancelled = false;

    const fetchCalibration = async () => {
      try {
        const res = await fetch('/api/prediction/calibrate');
        if (!res.ok) {
          setStatus({ hasCalibration: false, calibration: null, loading: false });
          return;
        }
        const json = await res.json();
        if (!cancelled && json.ok && json.data?.hasCalibration) {
          // Use the 90% coverage level as default display
          const cal90 = json.data.calibrations?.['0.90'];
          setStatus({
            hasCalibration: true,
            calibration: cal90 ?? null,
            loading: false,
          });
        } else if (!cancelled) {
          setStatus({ hasCalibration: false, calibration: null, loading: false });
        }
      } catch {
        if (!cancelled) {
          setStatus({ hasCalibration: false, calibration: null, loading: false });
        }
      }
    };

    fetchCalibration();
    return () => { cancelled = true; };
  }, []);

  const getIntervalForNCS = useCallback(
    (ncs: number): NCSIntervalResult => {
      if (!status.hasCalibration || !status.calibration) {
        return { interval: null, confidence: null };
      }

      const { qHatUp, qHatDown, coverageLevel } = status.calibration;
      const interval = getInterval(ncs, qHatUp, qHatDown, coverageLevel);
      const confidence = classifyConfidence(interval.width);

      return { interval, confidence };
    },
    [status]
  );

  return { status, getIntervalForNCS };
}
