'use client';

/**
 * DEPENDENCIES
 * Consumed by: /dashboard page (top of main content)
 * Consumes: /api/onboarding (GET + POST)
 * Risk-sensitive: NO (display only + dismiss flag)
 * Last modified: 2026-03-04
 * Notes: Shows when required onboarding steps are incomplete and not dismissed.
 *        Compact by default, expands to show full checklist.
 */

import { useState, useEffect, useCallback } from 'react';
import { apiRequest } from '@/lib/api-client';
import { cn } from '@/lib/utils';
import {
  Rocket,
  Check,
  Circle,
  ChevronDown,
  ChevronUp,
  X,
  ArrowRight,
} from 'lucide-react';

interface OnboardingStepData {
  id: string;
  title: string;
  description: string;
  href: string;
  hrefLabel: string;
  required: boolean;
  completed: boolean;
}

interface OnboardingData {
  isComplete: boolean;
  isDismissed: boolean;
  completedSteps: string[];
  steps: OnboardingStepData[];
  requiredRemaining: number;
  optionalRemaining: number;
}

export default function OnboardingBanner() {
  const [data, setData] = useState<OnboardingData | null>(null);
  const [expanded, setExpanded] = useState(false);
  const [dismissing, setDismissing] = useState(false);

  const fetchStatus = useCallback(async () => {
    try {
      const result = await apiRequest<OnboardingData>('/api/onboarding');
      setData(result);
    } catch {
      // Non-critical — banner simply won't show
    }
  }, []);

  useEffect(() => {
    fetchStatus();
  }, [fetchStatus]);

  // Don't render if: loading, complete, dismissed, or no data
  if (!data || data.isComplete || data.isDismissed) return null;

  const totalRequired = data.steps.filter((s) => s.required).length;
  const completedRequired = data.steps.filter((s) => s.required && s.completed).length;
  const progressPct = totalRequired > 0 ? (completedRequired / totalRequired) * 100 : 0;

  const handleDismiss = async () => {
    setDismissing(true);
    try {
      await apiRequest('/api/onboarding', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action: 'dismiss' }),
      });
      setData((prev) => prev ? { ...prev, isDismissed: true } : null);
    } catch {
      // Best-effort
    } finally {
      setDismissing(false);
    }
  };

  // Find the next incomplete required step
  const nextStep = data.steps.find((s) => s.required && !s.completed)
    ?? data.steps.find((s) => !s.completed);

  return (
    <div className="rounded-lg border-l-4 border-l-primary-400 bg-navy-800/60 border border-border/40 p-4">
      {/* Compact header — always visible */}
      <div className="flex items-center justify-between gap-3">
        <div className="flex items-center gap-3 flex-1 min-w-0">
          <Rocket className="w-5 h-5 text-primary-400 flex-shrink-0" />
          <div className="flex-1 min-w-0">
            <div className="flex items-center gap-2 flex-wrap">
              <h2 className="text-sm font-semibold text-foreground">
                Getting Started
              </h2>
              <span className="text-[10px] px-1.5 py-0.5 rounded bg-primary/15 text-primary-400 font-medium">
                {completedRequired}/{totalRequired} required
              </span>
            </div>
            {!expanded && nextStep && (
              <p className="text-xs text-muted-foreground mt-0.5 truncate">
                Next: {nextStep.title}
              </p>
            )}
          </div>
        </div>

        <div className="flex items-center gap-2 flex-shrink-0">
          {/* Progress bar */}
          <div className="w-20 h-1.5 bg-navy-700 rounded-full overflow-hidden hidden sm:block">
            <div
              className="h-full bg-primary-400 rounded-full transition-all duration-500"
              style={{ width: `${progressPct}%` }}
            />
          </div>

          {/* Expand/collapse */}
          <button
            onClick={() => setExpanded(!expanded)}
            className="text-muted-foreground hover:text-foreground transition-colors p-1"
            title={expanded ? 'Collapse' : 'Show all steps'}
          >
            {expanded ? <ChevronUp className="w-4 h-4" /> : <ChevronDown className="w-4 h-4" />}
          </button>

          {/* Dismiss */}
          <button
            onClick={handleDismiss}
            disabled={dismissing}
            className="text-muted-foreground/40 hover:text-muted-foreground transition-colors p-1"
            title="Dismiss setup guide"
          >
            <X className="w-4 h-4" />
          </button>
        </div>
      </div>

      {/* Expanded checklist */}
      {expanded && (
        <div className="mt-4 pt-3 border-t border-border/30 space-y-2">
          {data.steps.map((step) => (
            <div
              key={step.id}
              className={cn(
                'flex items-start gap-3 p-2.5 rounded-lg transition-colors',
                step.completed ? 'bg-navy-800/30' : 'bg-navy-800/60'
              )}
            >
              {/* Status icon */}
              <div className="mt-0.5 flex-shrink-0">
                {step.completed ? (
                  <Check className="w-4 h-4 text-profit" />
                ) : (
                  <Circle className="w-4 h-4 text-muted-foreground/30" />
                )}
              </div>

              {/* Content */}
              <div className="flex-1 min-w-0">
                <div className="flex items-center gap-1.5">
                  <span className={cn(
                    'text-xs font-medium',
                    step.completed ? 'text-muted-foreground line-through' : 'text-foreground'
                  )}>
                    {step.title}
                  </span>
                  {!step.required && (
                    <span className="text-[9px] px-1 py-0.5 rounded bg-navy-700 text-muted-foreground">
                      optional
                    </span>
                  )}
                </div>
                {!step.completed && (
                  <p className="text-[10px] text-muted-foreground mt-0.5">{step.description}</p>
                )}
              </div>

              {/* Action link */}
              {!step.completed && (
                <a
                  href={step.href}
                  className="flex-shrink-0 text-[10px] text-primary-400 hover:text-primary-300 flex items-center gap-0.5 transition-colors mt-0.5"
                >
                  {step.hrefLabel}
                  <ArrowRight className="w-3 h-3" />
                </a>
              )}
            </div>
          ))}

          <p className="text-[10px] text-muted-foreground/50 pt-1">
            Complete all required steps to start trading. Optional steps enhance the experience but are not blocking.
          </p>
        </div>
      )}
    </div>
  );
}
