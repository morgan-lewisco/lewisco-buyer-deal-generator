'use client';
import { useState, useEffect, useCallback, useRef } from 'react';
import { Lead, LeadStatus } from '@/lib/types';
import { DEFAULT_BUYERS } from '@/lib/buyers';
import { loadBuyerState, saveBuyerState, accumulateLeads, buildOverrides, claimLead, releaseLead, filterClaimedByOthers } from '@/lib/persistence';
import LeadList from './components/LeadList';

type GenStatus = 'idle' | 'searching' | 'scoring' | 'done' | 'error';

const STATUS_LABEL: Record<GenStatus, string> = {
  idle:     'Generate Leads',
  searching:'Searching web...',
  scoring:  'Scoring with AI...',
  done:     'Find New Leads',
  error:    'Retry',
};

export default function HomePage() {
  const [buyerId, setBuyerId]             = useState(DEFAULT_BUYERS[0].id);
  const [leads, setLeads]                 = useState<Lead[]>([]);
  const [generatedAt, setGeneratedAt]     = useState<string | null>(null);
  const [status, setStatus]               = useState<GenStatus>('idle');
  const [errorMsg, setErrorMsg]           = useState('');
  const [excludeContacted, setExcludeContacted] = useState(true);
  const [excludeDismissed, setExcludeDismissed] = useState(true);
  const [meta, setMeta]                   = useState<{ searches: number; signals: number; deduped: boolean } | null>(null);
  // Prevents the save effect from writing stale leads when the buyer switches.
  // The load effect sets this true; the save effect skips one cycle, then resets it.
  const buyerJustChanged = useRef(false);

  useEffect(() => {
    buyerJustChanged.current = true;
    const state = loadBuyerState(buyerId);
    setLeads(state.leads);
    setGeneratedAt(state.generatedAt);
    setStatus(state.leads.length > 0 ? 'done' : 'idle');
  }, [buyerId]);

  useEffect(() => {
    if (buyerJustChanged.current) {
      buyerJustChanged.current = false;
      return;
    }
    if (leads.length === 0) return;
    const overrides = buildOverrides(leads);
    saveBuyerState(buyerId, { leads, generatedAt, statusOverrides: overrides });
  }, [buyerId, leads, generatedAt]);

  const handleGenerate = useCallback(async () => {
    setStatus('searching');
    setErrorMsg('');

    const existingState = loadBuyerState(buyerId);

    try {
      // Phase 1 — web searches (show "searching" label)
      await new Promise((r) => setTimeout(r, 100)); // flush UI update

      setStatus('scoring'); // Claude scoring starts as soon as searches return

      const res = await fetch('/api/generate-leads', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          buyerId,
          options: { excludeContacted, excludeDismissed, windowDays: 90 },
          statusOverrides: existingState.statusOverrides,
        }),
      });

      if (!res.ok) {
        const err = await res.json();
        throw new Error(err.error ?? `HTTP ${res.status}`);
      }

      const result = await res.json();
      const fresh: Lead[] = result.leads ?? [];
      const accumulated = accumulateLeads(leads, fresh, existingState.statusOverrides);

      setLeads(accumulated);
      setGeneratedAt(result.generatedAt);
      setMeta({ searches: result.searchesRun, signals: result.rawSignalsFound, deduped: result.zohoDeduped });
      setStatus('done');
    } catch (err) {
      setErrorMsg(err instanceof Error ? err.message : 'Unknown error');
      setStatus('error');
    }
  }, [buyerId, excludeContacted, excludeDismissed]);

  const handleUpdateStatus = useCallback((id: string, s: LeadStatus) => {
    setLeads((prev) => {
      const lead = prev.find((l) => l.id === id);
      if (lead) {
        const company = lead.zoomInfoId ?? lead.company;
        if (s === 'contacted') claimLead(buyerId, company);
        else if (lead.status === 'contacted') releaseLead(company);
      }
      return prev.map((l) => (l.id === id ? { ...l, status: s } : l));
    });
  }, [buyerId]);

  const buyer = DEFAULT_BUYERS.find((b) => b.id === buyerId)!;
  const isLoading = status === 'searching' || status === 'scoring';
  // Filter out leads another buyer has already claimed (contacted).
  // The lead stays in storage — releasing the claim brings it back.
  const visibleLeads = filterClaimedByOthers(buyerId, leads);

  return (
    <div className="min-h-screen bg-slate-50">
      {/* Header */}
      <header className="header-platinum text-white shadow-lg overflow-hidden relative">
        {/* Decorative dollar signs */}
        <span className="absolute left-3 top-1 text-white/5 text-7xl font-bold select-none pointer-events-none">$</span>
        <span className="absolute left-16 top-3 text-white/4 text-4xl font-bold select-none pointer-events-none">$</span>
        <span className="absolute right-48 top-0 text-white/4 text-6xl font-bold select-none pointer-events-none">$</span>
        <span className="absolute right-24 top-4 text-white/5 text-3xl font-bold select-none pointer-events-none">$</span>

        <div className="mx-auto max-w-5xl px-4 py-4 flex flex-wrap items-center justify-between gap-4 relative z-10">
          <div className="flex items-center gap-4">
            <img src="/lewisco-logo.png" alt="Lewisco Holdings" className="h-10 w-auto" />
            <div>
              <h1 className="text-lg font-bold tracking-tight leading-none">
                Buyer Deal Generator
              </h1>
              <p className="text-xs text-slate-400 mt-0.5">Lewisco Holdings · Internal</p>
            </div>
          </div>

          <div className="flex items-center gap-3">
            <label className="text-sm font-medium text-slate-400">Buyer Manager</label>
            <select value={buyerId} onChange={(e) => setBuyerId(e.target.value)}
              className="rounded-md border border-slate-500 bg-slate-700 text-white px-3 py-1.5 text-sm focus:outline-none focus:ring-2 focus:ring-lewisco-400">
              {DEFAULT_BUYERS.map((b) => (
                <option key={b.id} value={b.id}>{b.name}</option>
              ))}
            </select>
            <span className="live-badge text-xs font-bold text-white rounded px-2.5 py-1 inline-block tracking-wide">LIVE</span>
          </div>
        </div>

        <div className="bg-black/20 border-t border-white/10 px-4 py-1.5 text-center text-xs text-slate-400">
          AI-generated leads via live web search. Review before acting. For questions or issues, please contact Melissa.
        </div>
      </header>

      <main className="mx-auto max-w-5xl px-4 py-6">
        {/* Buyer strip */}
        {/* Buyer card */}
        <div className={`mb-4 rounded-xl border-2 bg-white px-5 py-4 flex flex-wrap items-start gap-4 ${
          buyer.badge.color === 'amber' ? 'border-amber-200' : 'border-blue-200'
        }`}>
          {/* Avatar */}
          <div className={`flex-shrink-0 w-12 h-12 rounded-full flex items-center justify-center text-xl font-bold shadow-sm ${
            buyer.badge.color === 'amber'
              ? 'bg-gradient-to-br from-amber-300 to-amber-500 text-white'
              : 'bg-gradient-to-br from-blue-400 to-blue-600 text-white'
          }`}>
            {buyer.name[0]}
          </div>

          <div className="flex-1 min-w-0">
            <div className="flex flex-wrap items-center gap-2 mb-1">
              <span className="text-base font-bold text-slate-900">{buyer.name}</span>
              <span className={`inline-flex items-center gap-1 text-xs font-semibold px-2.5 py-0.5 rounded-full ${
                buyer.badge.color === 'amber'
                  ? 'bg-amber-100 text-amber-800'
                  : 'bg-blue-100 text-blue-800'
              }`}>
                {buyer.badge.emoji} {buyer.badge.label}
              </span>
            </div>
            <p className="text-sm text-slate-600">{buyer.bio}</p>
          </div>

          {generatedAt && (
            <span className="text-xs text-slate-400 self-center flex-shrink-0">
              Updated {new Date(generatedAt).toLocaleString()}
            </span>
          )}
        </div>

        {/* Error */}
        {status === 'error' && (
          <div className="mb-4 rounded-lg border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700">
            <strong>Generation failed:</strong> {errorMsg}
            <span className="ml-2 text-red-500 text-xs">Check that ANTHROPIC_API_KEY and OPENCLAW_GATEWAY_TOKEN are set in .env.local</span>
          </div>
        )}

        {/* Empty / loading / list */}
        {visibleLeads.length === 0 && !isLoading ? (
          <div className="flex flex-col items-center justify-center py-24 text-slate-400 gap-3">
            <span className="text-5xl">💰</span>
            <p className="text-base font-medium">No leads yet.</p>
            <p className="text-sm">Search the web for live closeout signals and score them for {buyer.name}.</p>
            <button onClick={handleGenerate} disabled={isLoading}
              className="mt-2 rounded-md bg-lewisco-500 hover:bg-lewisco-400 text-white font-semibold px-5 py-2.5 text-sm transition shadow">
              Generate Leads
            </button>
            <p className="text-xs text-slate-300">Takes ~20–40 seconds.</p>
          </div>
        ) : isLoading ? (
          <div className="flex flex-col items-center justify-center py-24 text-slate-400 gap-4">
            <div className="h-10 w-10 rounded-full border-4 border-lewisco-200 border-t-lewisco-600 animate-spin" />
            <div className="text-center">
              <p className="text-sm font-medium">
                {status === 'searching' ? 'Scanning the web for closeout signals...' : 'AI is scoring and ranking leads...'}
              </p>
              <p className="text-xs text-slate-300 mt-1">Usually 20–40 seconds total</p>
            </div>
          </div>
        ) : (
          <LeadList leads={visibleLeads} onUpdateStatus={handleUpdateStatus}
            onGenerate={handleGenerate} isLoading={isLoading} genLabel={STATUS_LABEL[status]} />
        )}
      </main>
    </div>
  );
}
