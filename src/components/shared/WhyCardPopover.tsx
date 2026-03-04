'use client';

/**
 * DEPENDENCIES
 * Consumed by: CandidateTable, BuyConfirmationModal, LaggardAlertsWidget
 * Consumes: why-explanations.ts
 * Risk-sensitive: NO (display only)
 * Last modified: 2026-03-03
 * Notes: Reusable popover that shows contextual explanations for scan statuses,
 *        risk gate failures, and laggard flags. Only one can be open at a time.
 */

import { useState, useRef, useEffect, useCallback, createContext, useContext, type ReactNode } from 'react';
import { cn } from '@/lib/utils';
import { Info, X } from 'lucide-react';

// ── Global dismiss context — only one WhyCard open at a time ──

type DismissCallback = () => void;
const WhyCardContext = createContext<{
  register: (dismiss: DismissCallback) => void;
  dismissAll: () => void;
}>({
  register: () => {},
  dismissAll: () => {},
});

export function WhyCardProvider({ children }: { children: ReactNode }) {
  const callbacksRef = useRef<Set<DismissCallback>>(new Set());

  const register = useCallback((dismiss: DismissCallback) => {
    // Dismiss all others first
    callbacksRef.current.forEach((cb) => cb());
    callbacksRef.current.clear();
    callbacksRef.current.add(dismiss);
  }, []);

  const dismissAll = useCallback(() => {
    callbacksRef.current.forEach((cb) => cb());
    callbacksRef.current.clear();
  }, []);

  return (
    <WhyCardContext.Provider value={{ register, dismissAll }}>
      {children}
    </WhyCardContext.Provider>
  );
}

// ── WhyCard Content ──

export interface WhyCardSection {
  label: string;
  value?: string;
  status?: 'pass' | 'fail' | 'info';
}

export interface WhyCardData {
  title: string;
  description: string;
  tip?: string;
  sections?: WhyCardSection[];
}

// ── Popover Component ──

interface WhyCardPopoverProps {
  data: WhyCardData;
  /** Render the trigger as a small icon / link */
  triggerClassName?: string;
  /** Use "icon" for ⓘ, "text" for "Why?" link */
  triggerStyle?: 'icon' | 'text';
}

export default function WhyCardPopover({
  data,
  triggerClassName,
  triggerStyle = 'icon',
}: WhyCardPopoverProps) {
  const [open, setOpen] = useState(false);
  const popoverRef = useRef<HTMLDivElement>(null);
  const triggerRef = useRef<HTMLButtonElement>(null);
  const ctx = useContext(WhyCardContext);

  const dismiss = useCallback(() => setOpen(false), []);

  // Close on Escape
  useEffect(() => {
    if (!open) return;
    const handleKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') setOpen(false);
    };
    document.addEventListener('keydown', handleKey);
    return () => document.removeEventListener('keydown', handleKey);
  }, [open]);

  // Close on click outside
  useEffect(() => {
    if (!open) return;
    const handleClick = (e: MouseEvent) => {
      if (
        popoverRef.current && !popoverRef.current.contains(e.target as Node) &&
        triggerRef.current && !triggerRef.current.contains(e.target as Node)
      ) {
        setOpen(false);
      }
    };
    document.addEventListener('mousedown', handleClick);
    return () => document.removeEventListener('mousedown', handleClick);
  }, [open]);

  const handleOpen = (e: React.MouseEvent) => {
    e.stopPropagation();
    if (open) {
      setOpen(false);
    } else {
      ctx.register(dismiss); // Dismiss any other open WhyCard
      setOpen(true);
    }
  };

  return (
    <span className="relative inline-flex">
      {/* Trigger */}
      <button
        ref={triggerRef}
        onClick={handleOpen}
        className={cn(
          'transition-colors',
          triggerStyle === 'icon'
            ? 'text-muted-foreground/40 hover:text-muted-foreground'
            : 'text-[10px] text-muted-foreground/50 hover:text-muted-foreground underline',
          triggerClassName
        )}
        title="Why?"
      >
        {triggerStyle === 'icon' ? (
          <Info className="w-3.5 h-3.5" />
        ) : (
          'Why?'
        )}
      </button>

      {/* Popover */}
      {open && (
        <div
          ref={popoverRef}
          className="absolute z-50 right-0 top-full mt-1 w-72 rounded-lg border border-border bg-navy-900 shadow-xl shadow-black/40 p-3 space-y-2 animate-fade-in"
          onClick={(e) => e.stopPropagation()}
        >
          {/* Header */}
          <div className="flex items-start justify-between gap-2">
            <h4 className="text-xs font-semibold text-foreground">{data.title}</h4>
            <button
              onClick={() => setOpen(false)}
              className="text-muted-foreground hover:text-foreground transition-colors flex-shrink-0"
              title="Close"
            >
              <X className="w-3 h-3" />
            </button>
          </div>

          {/* Description */}
          <p className="text-[11px] text-muted-foreground leading-relaxed">
            {data.description}
          </p>

          {/* Sections (pass/fail items) */}
          {data.sections && data.sections.length > 0 && (
            <div className="space-y-1 pt-1 border-t border-border/30">
              {data.sections.map((section) => (
                <div key={section.label} className="flex items-start gap-1.5">
                  {section.status === 'pass' && (
                    <span className="text-[10px] text-profit mt-0.5">✓</span>
                  )}
                  {section.status === 'fail' && (
                    <span className="text-[10px] text-loss mt-0.5">✗</span>
                  )}
                  {section.status === 'info' && (
                    <span className="text-[10px] text-muted-foreground mt-0.5">·</span>
                  )}
                  <div className="flex-1 min-w-0">
                    <span className="text-[10px] text-muted-foreground">{section.label}</span>
                    {section.value && (
                      <span className="text-[10px] text-foreground ml-1 font-mono">{section.value}</span>
                    )}
                  </div>
                </div>
              ))}
            </div>
          )}

          {/* Tip */}
          {data.tip && (
            <div className="pt-1.5 border-t border-border/30">
              <p className="text-[10px] text-primary-400/80 leading-relaxed">
                💡 {data.tip}
              </p>
            </div>
          )}
        </div>
      )}
    </span>
  );
}
