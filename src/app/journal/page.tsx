'use client';

/**
 * DEPENDENCIES
 * Consumed by: app router (navigation)
 * Consumes: /api/journal, /api/journal/[positionId]/entry, /api/journal/[positionId]/close
 * Risk-sensitive: NO — journal notes only
 * Last modified: 2026-03-01
 */

import { useEffect, useState, useCallback } from 'react';
import Navbar from '@/components/shared/Navbar';
import { apiRequest } from '@/lib/api-client';
import { formatDate, cn } from '@/lib/utils';
import { BookOpen, Pencil, Star, TrendingUp, TrendingDown, X } from 'lucide-react';

interface JournalEntry {
  id: number;
  positionId: string;
  ticker: string;
  companyName: string;
  entryDate: string;
  exitDate: string | null;
  status: string;
  entryPrice: number;
  exitPrice: number | null;
  shares: number;
  gainLoss: number | null;
  entryNote: string | null;
  entryConfidence: number | null;
  closeNote: string | null;
  learnedNote: string | null;
  entryNoteAt: string | null;
  closeNoteAt: string | null;
  createdAt: string;
}

// Modal for editing entry notes
function EntryNoteModal({
  positionId,
  existing,
  onClose,
  onSaved,
}: {
  positionId: string;
  existing: { entryNote: string | null; entryConfidence: number | null };
  onClose: () => void;
  onSaved: () => void;
}) {
  const [note, setNote] = useState(existing.entryNote ?? '');
  const [confidence, setConfidence] = useState(existing.entryConfidence ?? 3);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const handleSave = async () => {
    if (!note.trim()) return;
    setSaving(true);
    setError(null);
    try {
      await apiRequest(`/api/journal/${positionId}/entry`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ entryNote: note.trim(), entryConfidence: confidence }),
      });
      onSaved();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to save');
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-sm" onClick={onClose}>
      <div className="card-surface p-6 w-full max-w-md mx-4" onClick={(e) => e.stopPropagation()}>
        <div className="flex items-center justify-between mb-4">
          <h3 className="text-lg font-semibold text-foreground">Entry Note</h3>
          <button onClick={onClose} className="text-muted-foreground hover:text-foreground">
            <X className="w-5 h-5" />
          </button>
        </div>

        <textarea
          className="w-full h-28 bg-navy-800 border border-border rounded-lg p-3 text-sm text-foreground resize-none focus:outline-none focus:ring-1 focus:ring-primary"
          placeholder="Why did you take this trade? What setup did you see?"
          value={note}
          onChange={(e) => setNote(e.target.value)}
        />

        <div className="mt-3">
          <label className="text-xs text-muted-foreground mb-1.5 block">Confidence (1–5)</label>
          <div className="flex gap-1">
            {[1, 2, 3, 4, 5].map((n) => (
              <button
                key={n}
                onClick={() => setConfidence(n)}
                className={cn(
                  'p-1 transition-colors',
                  n <= confidence ? 'text-amber-400' : 'text-navy-600'
                )}
              >
                <Star className="w-5 h-5" fill={n <= confidence ? 'currentColor' : 'none'} />
              </button>
            ))}
          </div>
        </div>

        {error && <p className="text-xs text-loss mt-2">{error}</p>}

        <div className="flex gap-2 mt-4">
          <button
            onClick={onClose}
            className="flex-1 px-4 py-2 text-sm rounded-lg border border-border text-muted-foreground hover:bg-navy-700 transition-colors"
          >
            Cancel
          </button>
          <button
            onClick={handleSave}
            disabled={saving || !note.trim()}
            className="flex-1 px-4 py-2 text-sm rounded-lg bg-primary text-white font-medium hover:bg-primary/90 disabled:opacity-50 transition-colors"
          >
            {saving ? 'Saving…' : 'Save'}
          </button>
        </div>
      </div>
    </div>
  );
}

// Modal for close notes
function CloseNoteModal({
  positionId,
  existing,
  onClose,
  onSaved,
}: {
  positionId: string;
  existing: { closeNote: string | null; learnedNote: string | null };
  onClose: () => void;
  onSaved: () => void;
}) {
  const [closeNote, setCloseNote] = useState(existing.closeNote ?? '');
  const [learnedNote, setLearnedNote] = useState(existing.learnedNote ?? '');
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const handleSave = async () => {
    if (!closeNote.trim()) return;
    setSaving(true);
    setError(null);
    try {
      await apiRequest(`/api/journal/${positionId}/close`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          closeNote: closeNote.trim(),
          learnedNote: learnedNote.trim() || undefined,
        }),
      });
      onSaved();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to save');
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-sm" onClick={onClose}>
      <div className="card-surface p-6 w-full max-w-md mx-4" onClick={(e) => e.stopPropagation()}>
        <div className="flex items-center justify-between mb-4">
          <h3 className="text-lg font-semibold text-foreground">Close Note</h3>
          <button onClick={onClose} className="text-muted-foreground hover:text-foreground">
            <X className="w-5 h-5" />
          </button>
        </div>

        <textarea
          className="w-full h-24 bg-navy-800 border border-border rounded-lg p-3 text-sm text-foreground resize-none focus:outline-none focus:ring-1 focus:ring-primary"
          placeholder="Why did you close? What happened?"
          value={closeNote}
          onChange={(e) => setCloseNote(e.target.value)}
        />

        <label className="text-xs text-muted-foreground mt-3 mb-1.5 block">What did you learn? (optional)</label>
        <textarea
          className="w-full h-20 bg-navy-800 border border-border rounded-lg p-3 text-sm text-foreground resize-none focus:outline-none focus:ring-1 focus:ring-primary"
          placeholder="Lessons for next time..."
          value={learnedNote}
          onChange={(e) => setLearnedNote(e.target.value)}
        />

        {error && <p className="text-xs text-loss mt-2">{error}</p>}

        <div className="flex gap-2 mt-4">
          <button
            onClick={onClose}
            className="flex-1 px-4 py-2 text-sm rounded-lg border border-border text-muted-foreground hover:bg-navy-700 transition-colors"
          >
            Cancel
          </button>
          <button
            onClick={handleSave}
            disabled={saving || !closeNote.trim()}
            className="flex-1 px-4 py-2 text-sm rounded-lg bg-primary text-white font-medium hover:bg-primary/90 disabled:opacity-50 transition-colors"
          >
            {saving ? 'Saving…' : 'Save'}
          </button>
        </div>
      </div>
    </div>
  );
}

function ConfidenceStars({ level }: { level: number }) {
  return (
    <span className="inline-flex gap-0.5">
      {[1, 2, 3, 4, 5].map((n) => (
        <Star
          key={n}
          className={cn('w-3.5 h-3.5', n <= level ? 'text-amber-400' : 'text-navy-600')}
          fill={n <= level ? 'currentColor' : 'none'}
        />
      ))}
    </span>
  );
}

function daysHeld(entryDate: string, exitDate: string | null): number {
  const start = new Date(entryDate).getTime();
  const end = exitDate ? new Date(exitDate).getTime() : Date.now();
  return Math.max(1, Math.round((end - start) / (1000 * 60 * 60 * 24)));
}

export default function JournalPage() {
  const [entries, setEntries] = useState<JournalEntry[]>([]);
  const [loading, setLoading] = useState(true);
  const [editingEntry, setEditingEntry] = useState<string | null>(null);
  const [editingClose, setEditingClose] = useState<string | null>(null);

  const fetchEntries = useCallback(async () => {
    try {
      const data = await apiRequest<{ entries: JournalEntry[] }>('/api/journal');
      setEntries(data.entries ?? []);
    } catch {
      // Non-critical: empty state will show
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    fetchEntries();
  }, [fetchEntries]);

  const handleSaved = () => {
    setEditingEntry(null);
    setEditingClose(null);
    fetchEntries();
  };

  return (
    <div className="min-h-screen bg-background">
      <Navbar />
      <main className="max-w-[1200px] mx-auto px-4 sm:px-6 py-6">
        <div className="flex items-center gap-3 mb-6">
          <BookOpen className="w-6 h-6 text-primary-400" />
          <h1 className="text-2xl font-bold text-foreground">Trade Journal</h1>
        </div>

        {loading && (
          <div className="text-center py-16 text-muted-foreground text-sm">Loading journal…</div>
        )}

        {!loading && entries.length === 0 && (
          <div className="card-surface p-8 text-center">
            <BookOpen className="w-10 h-10 text-muted-foreground mx-auto mb-3" />
            <p className="text-foreground font-medium mb-1">No journal entries yet.</p>
            <p className="text-sm text-muted-foreground">
              When you take a trade, you&apos;ll be prompted to record why you took it.
            </p>
          </div>
        )}

        {!loading && entries.length > 0 && (
          <div className="space-y-4">
            {entries.map((entry) => {
              const held = daysHeld(entry.entryDate, entry.exitDate);
              const isWin = entry.gainLoss != null && entry.gainLoss > 0;
              const isClosed = entry.status === 'CLOSED';

              return (
                <div key={entry.id} className="card-surface p-5">
                  {/* Header */}
                  <div className="flex items-start justify-between gap-4 mb-3">
                    <div>
                      <h3 className="text-base font-semibold text-foreground">
                        {entry.ticker}
                        <span className="text-muted-foreground font-normal ml-2 text-sm">
                          {entry.companyName}
                        </span>
                      </h3>
                      <p className="text-xs text-muted-foreground mt-0.5">
                        Bought: {formatDate(new Date(entry.entryDate))}
                        {entry.exitDate && <> · Sold: {formatDate(new Date(entry.exitDate))}</>}
                        {' · Held '}
                        {held} day{held !== 1 ? 's' : ''}
                      </p>
                    </div>

                    <div className="text-right shrink-0">
                      {isClosed && entry.gainLoss != null ? (
                        <div className={cn('flex items-center gap-1', isWin ? 'text-gain' : 'text-loss')}>
                          {isWin ? <TrendingUp className="w-4 h-4" /> : <TrendingDown className="w-4 h-4" />}
                          <span className="font-semibold text-sm">
                            {isWin ? '+' : ''}£{entry.gainLoss.toFixed(2)}
                          </span>
                          <span className="text-xs ml-1">{isWin ? '✓' : '✗'}</span>
                        </div>
                      ) : (
                        <span className="text-xs text-muted-foreground bg-navy-700 px-2 py-1 rounded">
                          Open position
                        </span>
                      )}
                    </div>
                  </div>

                  {/* Entry note */}
                  {entry.entryNote && (
                    <div className="mb-3">
                      <p className="text-xs text-muted-foreground mb-1">Entry note:</p>
                      <p className="text-sm text-foreground/90 italic">&ldquo;{entry.entryNote}&rdquo;</p>
                      {entry.entryConfidence != null && (
                        <div className="mt-1 flex items-center gap-2">
                          <span className="text-xs text-muted-foreground">Confidence:</span>
                          <ConfidenceStars level={entry.entryConfidence} />
                        </div>
                      )}
                    </div>
                  )}

                  {/* Close note */}
                  {entry.closeNote && (
                    <div className="mb-3">
                      <p className="text-xs text-muted-foreground mb-1">Close note:</p>
                      <p className="text-sm text-foreground/90 italic">&ldquo;{entry.closeNote}&rdquo;</p>
                    </div>
                  )}

                  {/* Learned note */}
                  {entry.learnedNote && (
                    <div className="mb-3">
                      <p className="text-xs text-muted-foreground mb-1">Learned:</p>
                      <p className="text-sm text-foreground/90 italic">&ldquo;{entry.learnedNote}&rdquo;</p>
                    </div>
                  )}

                  {/* Actions */}
                  <div className="flex gap-2 mt-3 pt-3 border-t border-border/50">
                    <button
                      onClick={() => setEditingEntry(entry.positionId)}
                      className="text-xs text-muted-foreground hover:text-foreground flex items-center gap-1 transition-colors"
                    >
                      <Pencil className="w-3 h-3" />
                      {entry.entryNote ? 'Edit entry note' : 'Add entry note'}
                    </button>
                    {isClosed && (
                      <button
                        onClick={() => setEditingClose(entry.positionId)}
                        className="text-xs text-muted-foreground hover:text-foreground flex items-center gap-1 transition-colors"
                      >
                        <Pencil className="w-3 h-3" />
                        {entry.closeNote ? 'Edit close note' : 'Add close note'}
                      </button>
                    )}
                  </div>
                </div>
              );
            })}
          </div>
        )}

        {/* Modals */}
        {editingEntry && (() => {
          const entry = entries.find((e) => e.positionId === editingEntry);
          return entry ? (
            <EntryNoteModal
              positionId={editingEntry}
              existing={{ entryNote: entry.entryNote, entryConfidence: entry.entryConfidence }}
              onClose={() => setEditingEntry(null)}
              onSaved={handleSaved}
            />
          ) : null;
        })()}

        {editingClose && (() => {
          const entry = entries.find((e) => e.positionId === editingClose);
          return entry ? (
            <CloseNoteModal
              positionId={editingClose}
              existing={{ closeNote: entry.closeNote, learnedNote: entry.learnedNote }}
              onClose={() => setEditingClose(null)}
              onSaved={handleSaved}
            />
          ) : null;
        })()}
      </main>
    </div>
  );
}
