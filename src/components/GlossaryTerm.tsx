'use client';

/**
 * DEPENDENCIES
 * Consumed by: WhyCard.tsx, ScoringGuideWidget.tsx, TodayPanel.tsx
 * Consumes: glossary.ts
 * Risk-sensitive: NO — display only
 * Last modified: 2026-03-01
 * Notes: CSS-only tooltip — no new npm packages. Dotted underline text with hover/tap tooltip.
 */

import { useState, useRef, useEffect, type ReactNode } from 'react';
import { GLOSSARY } from '@/lib/glossary';

interface GlossaryTermProps {
  term: string;
  children: ReactNode;
}

export default function GlossaryTerm({ term, children }: GlossaryTermProps) {
  const definition = GLOSSARY[term];
  const [visible, setVisible] = useState(false);
  const ref = useRef<HTMLSpanElement>(null);

  // Close on outside click/tap
  useEffect(() => {
    if (!visible) return;
    const handleClickOutside = (e: MouseEvent | TouchEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) {
        setVisible(false);
      }
    };
    document.addEventListener('mousedown', handleClickOutside);
    document.addEventListener('touchstart', handleClickOutside);
    return () => {
      document.removeEventListener('mousedown', handleClickOutside);
      document.removeEventListener('touchstart', handleClickOutside);
    };
  }, [visible]);

  // If no definition found, render children without tooltip
  if (!definition) return <>{children}</>;

  return (
    <span
      ref={ref}
      className="glossary-term"
      onMouseEnter={() => setVisible(true)}
      onMouseLeave={() => setVisible(false)}
      onClick={() => setVisible((v) => !v)}
    >
      {children}
      {visible && (
        <span className="glossary-tooltip" role="tooltip">
          <span className="glossary-tooltip-title">{term}</span>
          <span className="glossary-tooltip-body">{definition}</span>
        </span>
      )}

      <style jsx>{`
        .glossary-term {
          position: relative;
          text-decoration: underline;
          text-decoration-style: dotted;
          text-underline-offset: 2px;
          cursor: help;
          display: inline;
        }
        .glossary-tooltip {
          position: absolute;
          bottom: calc(100% + 6px);
          left: 50%;
          transform: translateX(-50%);
          max-width: 280px;
          min-width: 180px;
          padding: 10px 12px;
          background: #1e293b;
          border: 1px solid rgba(255, 255, 255, 0.12);
          border-radius: 8px;
          box-shadow: 0 8px 24px rgba(0, 0, 0, 0.4);
          z-index: 50;
          display: flex;
          flex-direction: column;
          gap: 4px;
          pointer-events: none;
          white-space: normal;
          text-align: left;
        }
        .glossary-tooltip-title {
          font-weight: 600;
          font-size: 12px;
          color: #f1f5f9;
        }
        .glossary-tooltip-body {
          font-weight: 400;
          font-size: 11px;
          color: #94a3b8;
          line-height: 1.5;
        }
      `}</style>
    </span>
  );
}
