/**
 * DEPENDENCIES
 * Consumed by: settings/page.tsx
 * Consumes: /api/settings (GET + PUT)
 * Risk-sensitive: NO — user preferences only
 * Last modified: 2026-03-07
 * Notes: Prediction engine toggle settings.
 *        - Show intraday NCS updates (controls LiveNCSTracker)
 *        - Apply Kelly multiplier (controls KellySizePanel)
 *        - RL Shadow Mode (controls TradeAdvisorPanel mode)
 */

'use client';

import { useState, useEffect } from 'react';
import { apiRequest } from '@/lib/api-client';
import { Brain, Loader2, Save, Check } from 'lucide-react';
import { cn } from '@/lib/utils';

interface PredictionSettings {
  showIntradayNCS: boolean;
  applyKellyMultiplier: boolean;
  rlShadowMode: boolean;
}

export default function PredictionPanel() {
  const [settings, setSettings] = useState<PredictionSettings>({
    showIntradayNCS: true,
    applyKellyMultiplier: false,
    rlShadowMode: true,
  });
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState(false);
  const [dirty, setDirty] = useState(false);

  useEffect(() => {
    const fetchSettings = async () => {
      try {
        const data = await apiRequest<PredictionSettings>('/api/settings?userId=default-user');
        setSettings({
          showIntradayNCS: data.showIntradayNCS ?? true,
          applyKellyMultiplier: data.applyKellyMultiplier ?? false,
          rlShadowMode: data.rlShadowMode ?? true,
        });
      } catch {
        // Use defaults
      } finally {
        setLoading(false);
      }
    };
    fetchSettings();
  }, []);

  const handleToggle = (key: keyof PredictionSettings) => {
    setSettings(prev => ({ ...prev, [key]: !prev[key] }));
    setDirty(true);
    setSaved(false);
  };

  const handleSave = async () => {
    setSaving(true);
    try {
      await apiRequest('/api/settings', {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ userId: 'default-user', ...settings }),
      });
      setSaved(true);
      setDirty(false);
    } catch {
      // Error handled by apiRequest
    } finally {
      setSaving(false);
    }
  };

  if (loading) {
    return (
      <div className="card-surface p-6 flex items-center gap-3 text-muted-foreground">
        <Loader2 className="w-4 h-4 animate-spin" /> Loading prediction settings...
      </div>
    );
  }

  return (
    <div className="card-surface overflow-hidden">
      <div className="px-6 py-4 border-b border-border/30 flex items-center gap-3">
        <Brain className="w-5 h-5 text-primary-400" />
        <div>
          <h2 className="font-semibold text-foreground">Prediction Engine</h2>
          <p className="text-xs text-muted-foreground">Configure prediction layers and AI features</p>
        </div>
      </div>

      <div className="p-6 space-y-5">
        {/* Toggle: Show intraday NCS updates */}
        <ToggleRow
          label="Show intraday NCS updates"
          description="Display real-time NCS tracking during UK trading hours (08:00–16:30)"
          checked={settings.showIntradayNCS}
          onChange={() => handleToggle('showIntradayNCS')}
        />

        {/* Toggle: Apply Kelly multiplier */}
        <ToggleRow
          label="Apply Kelly multiplier to sizing"
          description="Use Kelly Criterion to adjust position sizes based on prediction confidence. Currently advisory only."
          checked={settings.applyKellyMultiplier}
          onChange={() => handleToggle('applyKellyMultiplier')}
          warning={settings.applyKellyMultiplier ? 'Kelly sizing active — position sizes may be reduced based on uncertainty' : undefined}
        />

        {/* Toggle: RL Shadow Mode */}
        <ToggleRow
          label="RL Shadow Mode"
          description="When ON (default): RL trade advisor shows recommendations only. When OFF: RL TIGHTEN/TRAIL actions pre-fill the stop update UI."
          checked={settings.rlShadowMode}
          onChange={() => handleToggle('rlShadowMode')}
          warning={!settings.rlShadowMode ? 'Active mode — RL recommendations will pre-fill stop adjustments for confirmation' : undefined}
        />

        {/* Save button */}
        {dirty && (
          <button
            onClick={handleSave}
            disabled={saving}
            className="flex items-center gap-2 bg-primary-600 hover:bg-primary-500 disabled:opacity-50 text-white px-4 py-2 rounded-lg text-sm font-medium transition-colors"
          >
            {saving ? <Loader2 className="w-4 h-4 animate-spin" /> : saved ? <Check className="w-4 h-4" /> : <Save className="w-4 h-4" />}
            {saving ? 'Saving...' : saved ? 'Saved' : 'Save Changes'}
          </button>
        )}
      </div>
    </div>
  );
}

// ── Toggle Row ───────────────────────────────────────────────

function ToggleRow({ label, description, checked, onChange, warning }: {
  label: string;
  description: string;
  checked: boolean;
  onChange: () => void;
  warning?: string;
}) {
  return (
    <div className="flex items-start justify-between gap-4">
      <div className="flex-1">
        <div className="text-sm font-medium text-foreground">{label}</div>
        <div className="text-xs text-muted-foreground mt-0.5">{description}</div>
        {warning && (
          <div className="text-[10px] text-amber-400 mt-1">⚠ {warning}</div>
        )}
      </div>
      <button
        onClick={onChange}
        className={cn(
          'relative inline-flex h-6 w-11 items-center rounded-full transition-colors flex-shrink-0',
          checked ? 'bg-primary-600' : 'bg-navy-700'
        )}
      >
        <span className={cn(
          'inline-block h-4 w-4 rounded-full bg-white transition-transform',
          checked ? 'translate-x-6' : 'translate-x-1'
        )} />
      </button>
    </div>
  );
}
