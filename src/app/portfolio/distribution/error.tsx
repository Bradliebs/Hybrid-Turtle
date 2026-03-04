'use client';

import { useEffect } from 'react';

export default function DistributionError({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  useEffect(() => {
    console.error('[Distribution] Error:', error);
  }, [error]);

  return (
    <div className="min-h-screen bg-background flex items-center justify-center p-6">
      <div className="max-w-lg w-full card-surface p-8 text-center space-y-6">
        <div className="w-16 h-16 rounded-full bg-red-500/20 mx-auto flex items-center justify-center">
          <span className="text-3xl">📈</span>
        </div>
        <h1 className="text-2xl font-bold text-foreground">Distribution Error</h1>
        <p className="text-sm text-muted-foreground font-mono bg-navy-900 rounded p-3 break-words">
          {error.message || 'Failed to load distribution view'}
        </p>
        <button
          onClick={reset}
          className="px-6 py-2 bg-primary-600 hover:bg-primary-500 text-white font-medium rounded-lg transition-colors"
        >
          Try again
        </button>
      </div>
    </div>
  );
}
