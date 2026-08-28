'use client';
import { useState, useEffect, useCallback, useRef } from 'react';
import { Lead, LeadStatus, ZohoMatch } from '@/lib/types';
import { accumulateLeads, updateLeadStatus, updateLeadAssignment, updateLeadDeal, updateLeadNotes, updateLeadCurrentlyActive } from '@/lib/persistence';
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
  const [statusFilter, setStatusFilter] = useState<'all' | 'active' | 'contacted' | 'deals' | 'currently-active'>('all');
  const [personFilter, setPersonFilter] = useState<'all' | 'unassigned' | 'assigned' | string>('all');
  const [zohoMap, setZohoMap]           = useState<Record<string, ZohoMatch>>({});

  // Save debounce — avoid hammering KV on rapid status/assignment changes
  const saveTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  const handleZohoLink = useCallback((company: string, match: ZohoMatch | null) => {
    setZohoMap((prev) => {
      if (match === null) {
        // Unlinked — revert to not-found state
        return { ...prev, [company]: { found: false, boughtManager: '', vendorOriginatorByName: '' } };
      }
      return { ...prev, [company]: match };
    });
  }, []);

  const enrichZoho = useCallback((pool: Lead[]) => {
    if (!pool.length) return;
    const companies = [...new Set(pool.map((l) => l.company))];
    fetch('/api/zoho-enrich', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ companies }),
    })
      .then((r) => r.json())
      .then((map: Record<string, ZohoMatch>) => setZohoMap(map))
      .catch(console.error);
  }, []);

  // Load pool from server on mount
  useEffect(() => {
    fetch('/api/pool')
      .then((r) => r.json())
      .then((state) => {
        if (state.leads?.length) {
          setLeads(state.leads);
          setGeneratedAt(state.generatedAt ?? null);
          setStatus('done');
          enrichZoho(state.leads);
        }
      })
      .catch(console.error)
      .finally(() => setPoolLoading(false));
  }, [enrichZoho]);

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
      setLeads((current) => { enrichZoho(current); return current; });
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

  const handleCurrentlyActive = useCallback((id: string, active: boolean) => {
    setLeads((prev) => {
      const next = updateLeadCurrentlyActive(prev, id, active);
      persistPool(next, generatedAt);
      return next;
    });
  }, [generatedAt, persistPool]);

  const handleNotes = useCallback((id: string, notes: string) => {
    setLeads((prev) => {
      const next = updateLeadNotes(prev, id, notes);
      persistPool(next, generatedAt);
      return next;
    });
  }, [generatedAt, persistPool]);

  const handleDeal = useCallback((id: string, dealMade: boolean, dealNotes: string) => {
    setLeads((prev) => {
      const next = updateLeadDeal(prev, id, dealMade, dealNotes);
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

  const isLoading            = status === 'searching' || status === 'scoring';
  const totalLeads           = leads.length;
  const assignedCount        = leads.filter((l) => l.assignedTo).length;
  const contactedCount       = leads.filter((l) => l.status === 'contacted' && !l.dealMade).length;
  const unassignedCount      = leads.filter((l) => !l.assignedTo && l.status !== 'contacted').length;
  const dealCount            = leads.filter((l) => l.dealMade).length;

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
          AI-generated leads via live web search · Assign leads to buyer managers · Mark engaged when outreach is in motion
        </div>
      </header>

      <main className="mx-auto max-w-5xl px-4 py-6">
        {/* Stats bar */}
        {totalLeads > 0 && (
          <div className="mb-5 grid grid-cols-2 sm:grid-cols-5 gap-3">
            {([
              { label: 'Total Leads', value: totalLeads,      num: 'text-blue-600',    ring: 'ring-blue-400',    onClick: () => { setStatusFilter('all');       setPersonFilter('all'); } },
              { label: 'Unassigned',  value: unassignedCount, num: 'text-orange-500',  ring: 'ring-orange-400',  onClick: () => { setStatusFilter('all');       setPersonFilter('unassigned'); } },
              { label: 'Assigned',    value: assignedCount,   num: 'text-indigo-600',  ring: 'ring-indigo-400',  onClick: () => { setStatusFilter('all');       setPersonFilter('assigned'); } },
              { label: 'Engaged',     value: contactedCount,  num: 'text-emerald-600', ring: 'ring-emerald-400', onClick: () => { setStatusFilter('contacted'); setPersonFilter('all'); } },
              { label: 'Deals Made', value: dealCount, num: 'text-yellow-500', ring: 'ring-yellow-400', onClick: () => { setStatusFilter('deals'); setPersonFilter('all'); } },
            ] as const).map(({ label, value, num, ring, onClick }) => {
              const isActive =
                (label === 'Total Leads'      && statusFilter === 'all'              && personFilter === 'all') ||
                (label === 'Unassigned'       && personFilter === 'unassigned') ||
                (label === 'Assigned'         && personFilter === 'assigned') ||
                (label === 'Engaged'          && statusFilter === 'contacted'        && personFilter === 'all') ||
                (label === 'Deals Made' && statusFilter === 'deals');
              return (
                <button key={label} onClick={onClick}
                  className={`rounded-xl bg-white border-2 px-4 py-3 shadow-sm text-center transition cursor-pointer hover:shadow-md ${
                    isActive ? `border-slate-300 ring-2 ring-offset-1 ${ring}` : 'border-slate-300 hover:border-slate-400'
                  }`}>
                  <div className={`text-2xl font-bold ${num}`}>{value}</div>
                  <div className="text-xs mt-0.5 font-medium text-slate-500">{label}</div>
                </button>
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
            statusFilter={statusFilter}
            personFilter={personFilter}
            onPersonFilter={setPersonFilter}
            onUpdateStatus={handleUpdateStatus}
            onAssign={handleAssign}
            onDeal={handleDeal}
            onNotes={handleNotes}
            onCurrentlyActive={handleCurrentlyActive}
            onGenerate={handleGenerate}
            isLoading={isLoading}
            genLabel={STATUS_LABEL[status]}
            zohoMap={zohoMap}
            onZohoLink={handleZohoLink}
          />
        )}
      </main>
      {showAddModal && (
        <AddLeadModal onAdd={handleAddLead} onClose={() => setShowAddModal(false)} />
      )}
    </div>
  );
}
