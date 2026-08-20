'use client';
import { useState, useEffect, useCallback, useRef } from 'react';
import { Lead, LeadStatus } from '@/lib/types';
import { BUYER_NAMES } from '@/lib/buyers';
import { accumulateLeads, updateLeadStatus, updateLeadAssignment } from '@/lib/persistence';
import LeadList from './components/LeadList';
import AddLeadModal from './components/AddLeadModal';

type GenStatus = 'idle' | 'searching' | 'scoring' | 'done' | 'error';

const STATUS_LABEL: Record<GenStatus, string> = {
  idle:      'Generate Leads',
  searching: 'Searching web...',
  scoring:   'Scoring with AI...',
  done:      'Refresh Leads',
  error:     'Retry',
};

export default function AdminPage() {
  const [leads, setLeads]             = useState<Lead[]>([]);
  const [generatedAt, setGeneratedAt] = useState<string | null>(null);
  const [status, setStatus]           = useState<GenStatus>('idle');
  const [errorMsg, setErrorMsg]       = useState('');
  const [meta, setMeta]               = useState<{ searches: number; signals: number; deduped: boolean } | null>(null);
  const [poolLoading, setPoolLoading] = useState(true);
  const [showAddModal, setShowAddModal] = useState(false);

  // Save debounce — avoid hammering KV on rapid status/assignment changes
  const saveTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  // Load pool from server on mount
  useEffect(() => {
    fetch('/api/pool')
      .then((r) => r.json())
      .then((state) => {
        if (state.leads?.length) {
          setLeads(state.leads);
          setGeneratedAt(state.generatedAt ?? null);
          setStatus('done');
        }
      })
      .catch(console.error)
      .finally(() => setPoolLoading(false));
  }, []);

  // Persist pool to server whenever leads change (debounced 800ms)
  const persistPool = useCallback((nextLeads: Lead[], nextGeneratedAt: string | null) => {
    if (saveTimer.current) clearTimeout(saveTimer.current);
    saveTimer.current = setTimeout(() => {
      fetch('/api/pool', {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ leads: nextLeads, generatedAt: nextGeneratedAt }),
      }).catch(console.error);
    }, 800);
  }, []);

  const handleGenerate = useCallback(async () => {
    setStatus('searching');
    setErrorMsg('');
    try {
      await new Promise((r) => setTimeout(r, 80));
      setStatus('scoring');

      const res = await fetch('/api/generate-leads', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ options: { excludeContacted: false, excludeDismissed: false, windowDays: 90 } }),
      });

      if (!res.ok) {
        const err = await res.json();
        throw new Error(err.error ?? `HTTP ${res.status}`);
      }

      const result = await res.json();
      const fresh: Lead[] = result.leads ?? [];

      setLeads((prev) => {
        const next = accumulateLeads(prev, fresh);
        persistPool(next, result.generatedAt);
        return next;
      });
      setGeneratedAt(result.generatedAt);
      setMeta({ searches: result.searchesRun, signals: result.rawSignalsFound, deduped: result.zohoDeduped });
      setStatus('done');
    } catch (err) {
      setErrorMsg(err instanceof Error ? err.message : 'Unknown error');
      setStatus('error');
    }
  }, [persistPool]);

  const handleUpdateStatus = useCallback((id: string, s: LeadStatus) => {
    setLeads((prev) => {
      const next = updateLeadStatus(prev, id, s);
      persistPool(next, generatedAt);
      return next;
    });
  }, [generatedAt, persistPool]);

  const handleAssign = useCallback((id: string, name: string) => {
    setLeads((prev) => {
      const next = updateLeadAssignment(prev, id, name);
      persistPool(next, generatedAt);
      return next;
    });
  }, [generatedAt, persistPool]);

  const handleAddLead = useCallback((lead: Lead) => {
    setLeads((prev) => {
      const next = [lead, ...prev];
      persistPool(next, generatedAt);
      return next;
    });
  }, [generatedAt, persistPool]);

  async function handleClearPool() {
    if (!confirm('Clear all leads and start fresh? This cannot be undone.')) return;
    await fetch('/api/pool', { method: 'DELETE' });
    setLeads([]);
    setGeneratedAt(null);
    setMeta(null);
    setStatus('idle');
  }

  async function handleLogout() {
    await fetch('/api/auth', { method: 'DELETE' });
    window.location.href = '/login';
  }

  const isLoading       = status === 'searching' || status === 'scoring';
  const totalLeads      = leads.length;
  const assignedCount   = leads.filter((l) => l.assignedTo).length;
  const contactedCount  = leads.filter((l) => l.status === 'contacted').length;
  const unassignedCount = leads.filter((l) => !l.assignedTo && l.status !== 'contacted').length;

  return (
    <div className="min-h-screen bg-slate-50">
      {/* Header */}
      <header className="header-platinum text-white shadow-lg overflow-hidden relative">
        <span className="absolute left-3 top-1 text-white/5 text-7xl font-bold select-none pointer-events-none">$</span>
        <span className="absolute left-28 top-2 text-white/3 text-5xl font-bold select-none pointer-events-none">$</span>
        <span className="absolute left-1/4 top-0 text-white/4 text-6xl font-bold select-none pointer-events-none">$</span>
        <span className="absolute left-1/2 top-1 text-white/3 text-5xl font-bold select-none pointer-events-none">$</span>
        <span className="absolute right-48 top-0 text-white/4 text-6xl font-bold select-none pointer-events-none">$</span>
        <span className="absolute right-24 top-2 text-white/3 text-5xl font-bold select-none pointer-events-none">$</span>
        <span className="absolute right-4 top-1 text-white/4 text-6xl font-bold select-none pointer-events-none">$</span>

        <div className="mx-auto max-w-5xl px-4 py-4 flex flex-wrap items-center justify-between gap-4 relative z-10">
          <div className="flex items-center gap-4">
            <img src="/lewisco-logo.png" alt="Lewisco Holdings" className="h-10 w-auto" />
            <div>
              <div className="flex items-center gap-2 leading-none">
                <h1 className="text-lg font-bold tracking-tight">Buyer Deal Generator</h1>
                <span className="live-badge text-xs font-bold text-white rounded px-2.5 py-1 tracking-wide">LIVE</span>
              </div>
              <p className="text-xs text-slate-400 mt-0.5">Lewisco Holdings · Admin</p>
            </div>
          </div>

          <div className="flex items-center gap-3">
            <button onClick={() => setShowAddModal(true)}
              className="text-xs text-slate-300 hover:text-white border border-slate-500 hover:border-slate-300 rounded px-2.5 py-1 transition">
              + Add Lead
            </button>
            {leads.length > 0 && (
              <button onClick={handleClearPool}
                className="text-xs text-slate-400 hover:text-red-400 border border-slate-600 hover:border-red-500 rounded px-2.5 py-1 transition">
                Clear Pool
              </button>
            )}
            <button onClick={handleLogout}
              className="text-xs text-slate-400 hover:text-white border border-slate-600 hover:border-slate-400 rounded px-2.5 py-1 transition">
              Sign out
            </button>
          </div>
        </div>

        <div className="bg-black/20 border-t border-white/10 px-4 py-1.5 text-center text-xs text-slate-400">
          AI-generated leads via live web search · Assign leads to buyer managers · Mark contacted when outreach is complete
        </div>
      </header>

      <main className="mx-auto max-w-5xl px-4 py-6">
        {/* Stats bar */}
        {totalLeads > 0 && (
          <div className="mb-5 grid grid-cols-2 sm:grid-cols-4 gap-3">
            {[
              { label: 'Total Leads',  value: totalLeads,      color: 'text-slate-900' },
              { label: 'Unassigned',   value: unassignedCount, color: 'text-amber-700' },
              { label: 'Assigned',     value: assignedCount,   color: 'text-lewisco-700' },
              { label: 'Contacted',    value: contactedCount,  color: 'text-emerald-700' },
            ].map(({ label, value, color }) => (
              <div key={label} className="rounded-xl bg-white border border-slate-200 px-4 py-3 shadow-sm text-center">
                <div className={`text-2xl font-bold ${color}`}>{value}</div>
                <div className="text-xs text-slate-500 mt-0.5">{label}</div>
              </div>
            ))}
          </div>
        )}

        {/* Buyer summary chips */}
        {totalLeads > 0 && (
          <div className="mb-5 flex flex-wrap gap-2">
            {BUYER_NAMES.map((name) => {
              const count = leads.filter((l) => l.assignedTo === name).length;
              return (
                <div key={name} className="inline-flex items-center gap-2 rounded-full border border-slate-200 bg-white px-3 py-1.5 text-xs shadow-sm">
                  <span className="w-5 h-5 rounded-full bg-lewisco-100 text-lewisco-700 font-bold flex items-center justify-center text-[10px]">
                    {name[0]}
                  </span>
                  <span className="font-medium text-slate-700">{name.split(' ')[0]}</span>
                  <span className="font-semibold text-lewisco-700">{count}</span>
                </div>
              );
            })}
          </div>
        )}

        {/* Meta info */}
        {meta && (
          <div className="mb-4 text-xs text-slate-400 flex flex-wrap gap-3">
            <span>{meta.searches} searches</span>
            <span>{meta.signals} raw signals</span>
            {meta.deduped && <span className="text-emerald-600">✓ Zoho deduped</span>}
            {generatedAt && <span>Updated {new Date(generatedAt).toLocaleString()}</span>}
          </div>
        )}

        {/* Error */}
        {status === 'error' && (
          <div className="mb-4 rounded-lg border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700">
            <strong>Generation failed:</strong> {errorMsg}
          </div>
        )}

        {/* Empty / loading / lead list */}
        {poolLoading ? (
          <div className="flex flex-col items-center justify-center py-24 text-slate-400 gap-4">
            <div className="h-8 w-8 rounded-full border-4 border-slate-200 border-t-slate-500 animate-spin" />
            <p className="text-sm">Loading pool...</p>
          </div>
        ) : leads.length === 0 && !isLoading ? (
          <div className="flex flex-col items-center justify-center py-24 text-slate-400 gap-3">
            <span className="text-5xl">💰</span>
            <p className="text-base font-medium">No leads yet.</p>
            <p className="text-sm text-center max-w-sm">
              Generate leads across all Lewisco categories — assign them to Dewey, Igor, or Ed as you work down the list.
            </p>
            <button onClick={handleGenerate} disabled={isLoading}
              className="mt-2 rounded-md bg-lewisco-500 hover:bg-lewisco-400 text-white font-semibold px-5 py-2.5 text-sm transition shadow">
              Generate Leads
            </button>
            <p className="text-xs text-slate-300">Takes ~1–2 minutes.</p>
          </div>
        ) : isLoading ? (
          <div className="flex flex-col items-center justify-center py-24 text-slate-400 gap-4">
            <div className="h-10 w-10 rounded-full border-4 border-lewisco-200 border-t-lewisco-600 animate-spin" />
            <div className="text-center">
              <p className="text-sm font-medium">
                {status === 'searching' ? 'Scanning the web for closeout signals...' : 'AI is scoring and ranking leads.. 1-2 minutes wait time'}
              </p>
              <p className="text-xs text-slate-300 mt-1">Usually 1–2 minutes</p>
            </div>
          </div>
        ) : (
          <LeadList
            leads={leads}
            onUpdateStatus={handleUpdateStatus}
            onAssign={handleAssign}
            onGenerate={handleGenerate}
            isLoading={isLoading}
            genLabel={STATUS_LABEL[status]}
          />
        )}
      </main>
      {showAddModal && (
        <AddLeadModal onAdd={handleAddLead} onClose={() => setShowAddModal(false)} />
      )}
    </div>
  );
}
