'use client';
import { useState } from 'react';
import { Lead } from '@/lib/types';

interface Props {
  onAdd: (lead: Lead) => void;
  onClose: () => void;
}

export default function AddLeadModal({ onAdd, onClose }: Props) {
  const [company, setCompany]   = useState('');
  const [url, setUrl]           = useState('');
  const [loading, setLoading]   = useState(false);
  const [error, setError]       = useState('');

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!company.trim()) return;
    setLoading(true);
    setError('');
    try {
      const res = await fetch('/api/add-lead', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ company: company.trim(), sourceUrl: url.trim() || undefined }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error ?? `HTTP ${res.status}`);
      onAdd(data.lead as Lead);
      onClose();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to add lead');
    } finally {
      setLoading(false);
    }
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 px-4">
      <div className="w-full max-w-md rounded-2xl bg-white shadow-xl p-6">
        <div className="flex items-center justify-between mb-5">
          <h2 className="text-base font-bold text-slate-900">Add Lead Manually</h2>
          <button onClick={onClose} className="text-slate-400 hover:text-slate-600 text-xl leading-none">✕</button>
        </div>

        <form onSubmit={handleSubmit} className="space-y-4">
          <div>
            <label className="block text-xs font-semibold text-slate-600 mb-1">Company Name <span className="text-red-500">*</span></label>
            <input
              type="text"
              value={company}
              onChange={(e) => setCompany(e.target.value)}
              placeholder="e.g. Knouse Foods"
              className="w-full rounded-lg border border-slate-300 px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-lewisco-500"
              autoFocus
            />
          </div>

          <div>
            <label className="block text-xs font-semibold text-slate-600 mb-1">News Article URL <span className="text-slate-400 font-normal">(optional but recommended)</span></label>
            <input
              type="url"
              value={url}
              onChange={(e) => setUrl(e.target.value)}
              placeholder="https://..."
              className="w-full rounded-lg border border-slate-300 px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-lewisco-500"
            />
            <p className="text-xs text-slate-400 mt-1">AI will read the article to extract signal details and score the lead.</p>
          </div>

          {error && (
            <p className="text-xs text-red-600 bg-red-50 border border-red-200 rounded px-3 py-2">{error}</p>
          )}

          <div className="flex gap-3 pt-1">
            <button type="button" onClick={onClose}
              className="flex-1 rounded-lg border border-slate-300 px-4 py-2 text-sm font-semibold text-slate-600 hover:bg-slate-50 transition">
              Cancel
            </button>
            <button type="submit" disabled={loading || !company.trim()}
              className="flex-1 rounded-lg bg-lewisco-600 hover:bg-lewisco-500 disabled:bg-lewisco-300 disabled:cursor-wait text-white px-4 py-2 text-sm font-semibold transition flex items-center justify-center gap-2">
              {loading
                ? <><span className="h-3 w-3 rounded-full border-2 border-white/30 border-t-white animate-spin" /> Enriching…</>
                : 'Add Lead'}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}
