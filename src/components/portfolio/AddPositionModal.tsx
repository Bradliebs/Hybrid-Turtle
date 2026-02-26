'use client';

import { useState } from 'react';
import { cn } from '@/lib/utils';
import { X, Plus, AlertTriangle, DollarSign, Hash, Calendar, FileText, Layers } from 'lucide-react';

interface AddPositionModalProps {
  isOpen: boolean;
  onClose: () => void;
  onSubmit: (position: ManualPositionData) => void;
}

export interface ManualPositionData {
  ticker: string;
  name: string;
  sleeve: 'CORE' | 'HIGH_RISK' | 'ETF' | 'HEDGE';
  entryPrice: number;
  shares: number;
  stopLoss: number;
  entryDate: string;
  notes: string;
  accountType: 'invest' | 'isa';
}

export default function AddPositionModal({ isOpen, onClose, onSubmit }: AddPositionModalProps) {
  const [ticker, setTicker] = useState('');
  const [name, setName] = useState('');
  const [sleeve, setSleeve] = useState<'CORE' | 'HIGH_RISK' | 'ETF' | 'HEDGE'>('CORE');
  const [accountType, setAccountType] = useState<'invest' | 'isa'>('invest');
  const [entryPrice, setEntryPrice] = useState('');
  const [shares, setShares] = useState('');
  const [stopLoss, setStopLoss] = useState('');
  const [entryDate, setEntryDate] = useState(new Date().toISOString().split('T')[0]);
  const [notes, setNotes] = useState('');
  const [error, setError] = useState<string | null>(null);

  if (!isOpen) return null;

  const price = parseFloat(entryPrice) || 0;
  const stop = parseFloat(stopLoss) || 0;
  const qty = parseFloat(shares) || 0;
  const riskPerShare = price - stop;
  const totalRisk = riskPerShare * qty;
  const totalCost = price * qty;

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);

    if (!ticker.trim()) {
      setError('Ticker is required');
      return;
    }

    if (price <= 0) {
      setError('Entry price must be greater than 0');
      return;
    }

    if (qty <= 0) {
      setError('Shares must be greater than 0');
      return;
    }

    if (stop <= 0) {
      setError('Stop-loss must be greater than 0');
      return;
    }

    if (stop >= price) {
      setError('Stop-loss must be below entry price');
      return;
    }

    onSubmit({
      ticker: ticker.toUpperCase().trim(),
      name: name.trim() || ticker.toUpperCase().trim(),
      sleeve,
      entryPrice: price,
      shares: qty,
      stopLoss: stop,
      entryDate,
      notes: notes.trim(),
      accountType,
    });

    // Reset form
    setTicker('');
    setName('');
    setSleeve('CORE');
    setAccountType('invest');
    setEntryPrice('');
    setShares('');
    setStopLoss('');
    setEntryDate(new Date().toISOString().split('T')[0]);
    setNotes('');
    onClose();
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center">
      {/* Backdrop */}
      <div className="absolute inset-0 bg-black/60 backdrop-blur-sm" onClick={onClose} />

      {/* Modal */}
      <div className="relative bg-navy-900 border border-border rounded-xl shadow-2xl w-full max-w-lg mx-4 animate-fade-in">
        {/* Header */}
        <div className="flex items-center justify-between p-5 border-b border-border">
          <h2 className="text-lg font-semibold text-foreground flex items-center gap-2">
            <Plus className="w-5 h-5 text-primary-400" />
            Add Manual Position
          </h2>
          <button
            onClick={onClose}
            className="text-muted-foreground hover:text-foreground transition-colors"
          >
            <X className="w-5 h-5" />
          </button>
        </div>

        {/* Form */}
        <form onSubmit={handleSubmit} className="p-5 space-y-4">
          {error && (
            <div className="p-3 bg-loss/10 border border-loss/30 rounded-lg text-sm text-loss flex items-center gap-2">
              <AlertTriangle className="w-4 h-4 flex-shrink-0" />
              {error}
            </div>
          )}

          {/* Ticker & Name */}
          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="block text-sm text-muted-foreground mb-1">
                <span className="flex items-center gap-1"><Hash className="w-3 h-3" /> Ticker *</span>
              </label>
              <input
                type="text"
                value={ticker}
                onChange={(e) => setTicker(e.target.value.toUpperCase())}
                placeholder="AAPL"
                className="input-field w-full font-mono"
                autoFocus
              />
            </div>
            <div>
              <label className="block text-sm text-muted-foreground mb-1">Company Name</label>
              <input
                type="text"
                value={name}
                onChange={(e) => setName(e.target.value)}
                placeholder="Apple Inc."
                className="input-field w-full"
              />
            </div>
          </div>

          {/* Sleeve, Account & Date */}
          <div className="grid grid-cols-3 gap-3">
            <div>
              <label className="block text-sm text-muted-foreground mb-1">
                <span className="flex items-center gap-1"><Layers className="w-3 h-3" /> Sleeve</span>
              </label>
              <select
                value={sleeve}
                onChange={(e) => setSleeve(e.target.value as 'CORE' | 'HIGH_RISK' | 'ETF' | 'HEDGE')}
                className="input-field w-full"
              >
                <option value="CORE">Core</option>
                <option value="ETF">ETF</option>
                <option value="HIGH_RISK">High Risk</option>
                <option value="HEDGE">Hedge</option>
              </select>
            </div>
            <div>
              <label className="block text-sm text-muted-foreground mb-1">
                T212 Account
              </label>
              <select
                value={accountType}
                onChange={(e) => setAccountType(e.target.value as 'invest' | 'isa')}
                className="input-field w-full"
              >
                <option value="invest">Invest</option>
                <option value="isa">ISA</option>
              </select>
            </div>
            <div>
              <label className="block text-sm text-muted-foreground mb-1">
                <span className="flex items-center gap-1"><Calendar className="w-3 h-3" /> Entry Date</span>
              </label>
              <input
                type="date"
                value={entryDate}
                onChange={(e) => setEntryDate(e.target.value)}
                className="input-field w-full"
              />
            </div>
          </div>

          {/* Entry Price & Shares */}
          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="block text-sm text-muted-foreground mb-1">
                <span className="flex items-center gap-1"><DollarSign className="w-3 h-3" /> Entry Price *</span>
              </label>
              <input
                type="number"
                step="0.01"
                value={entryPrice}
                onChange={(e) => setEntryPrice(e.target.value)}
                placeholder="150.00"
                className="input-field w-full font-mono"
              />
            </div>
            <div>
              <label className="block text-sm text-muted-foreground mb-1">Shares *</label>
              <input
                type="number"
                step="0.001"
                value={shares}
                onChange={(e) => setShares(e.target.value)}
                placeholder="10"
                className="input-field w-full font-mono"
              />
            </div>
          </div>

          {/* Stop-Loss */}
          <div>
            <label className="block text-sm text-muted-foreground mb-1">
              <span className="flex items-center gap-1">
                <AlertTriangle className="w-3 h-3 text-loss" /> Stop-Loss Price *
              </span>
            </label>
            <input
              type="number"
              step="0.01"
              value={stopLoss}
              onChange={(e) => setStopLoss(e.target.value)}
              placeholder="142.50"
              className="input-field w-full font-mono"
            />
            {price > 0 && stop > 0 && stop < price && (
              <div className="mt-1 text-xs text-muted-foreground flex gap-4">
                <span>Risk/share: <span className="text-loss font-mono">${riskPerShare.toFixed(2)}</span></span>
                <span>Total risk: <span className="text-loss font-mono">${totalRisk.toFixed(2)}</span></span>
                <span>Total cost: <span className="font-mono">${totalCost.toFixed(2)}</span></span>
              </div>
            )}
          </div>

          {/* Notes */}
          <div>
            <label className="block text-sm text-muted-foreground mb-1">
              <span className="flex items-center gap-1"><FileText className="w-3 h-3" /> Notes</span>
            </label>
            <textarea
              value={notes}
              onChange={(e) => setNotes(e.target.value)}
              placeholder="Optional trade notes..."
              className="input-field w-full h-16 resize-none text-sm"
            />
          </div>

          {/* Actions */}
          <div className="flex justify-end gap-3 pt-2">
            <button
              type="button"
              onClick={onClose}
              className="px-4 py-2 text-sm text-muted-foreground hover:text-foreground transition-colors"
            >
              Cancel
            </button>
            <button
              type="submit"
              className="btn-primary flex items-center gap-2"
            >
              <Plus className="w-4 h-4" />
              Add Position
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}
