'use client';
import { useState } from 'react';
import { Lead, LeadStatus } from '@/lib/types';
import { BUYER_NAMES } from '@/lib/buyers';
import LeadCard from './LeadCard';

type FilterTab = 'all' | 'unassigned' | string; // string = buyer name
type StatusTab = 'active' | 'contacted';

interface Props {
  leads: Lead[];
  onUpdateStatus: (id: string, status: LeadStatus) => void;
  onAssign: (id: string, name: string) => void;
  onDeal: (id: string, dealMade: boolean, dealNotes: string) => void;
  onGenerate: () => void;
  isLoading: boolean;
  genLabel: string;
}

export default function LeadList({ leads, onUpdateStatus, onAssign, onDeal, onGenerate, isLoading, genLabel }: Props) {
  const [filterTab, setFilterTab]     = useState<FilterTab>('all');
  const [statusTab, setStatusTab]     = useState<StatusTab>('active');
  const [showDismissed, setShowDismissed] = useState(true);

  const activeLeads    = leads.filter((l) => l.status !== 'contacted');
  const contactedLeads = leads.filter((l) => l.status === 'contacted');

  function applyFilter(pool: Lead[]): Lead[] {
    if (filterTab === 'all') return pool;
    if (filterTab === 'unassigned') return pool.filter((l) => !l.assignedTo);
    return pool.filter((l) => l.assignedTo === filterTab);
  }

  const basePool  = statusTab === 'active' ? activeLeads : contactedLeads;
  const filtered  = applyFilter(basePool);
  const dismissed = filtered.filter((l) => l.status === 'dismissed').length;
  const visible   = showDismissed ? filtered : filtered.filter((l) => l.status !== 'dismissed');

  const handleContact     = (id: string) => {
    const lead = leads.find((l) => l.id === id);
    if (!lead) return;
    onUpdateStatus(id, lead.status === 'contacted' ? 'new' : 'contacted');
  };
  const handleDismiss     = (id: string) => onUpdateStatus(id, 'dismissed');
  const handleUndoDismiss = (id: string) => onUpdateStatus(id, 'new');

  if (leads.length === 0) return null;

  return (
    <div className="space-y-4">
      {/* Status tabs + generate */}
      <div className="flex flex-wrap items-center justify-between gap-3 rounded-xl bg-white border border-slate-200 px-4 py-3 shadow-sm">
        <div className="flex items-center gap-2">
          <button onClick={() => setStatusTab('active')}
            className={`px-4 py-2 text-sm font-semibold rounded-lg border transition-all ${
              statusTab === 'active'
                ? 'bg-lewisco-600 text-white border-lewisco-600 shadow-sm'
                : 'bg-white text-slate-600 border-slate-300 hover:bg-lewisco-50 hover:border-lewisco-400 hover:text-lewisco-700'
            }`}>
            Active
            <span className={`ml-1.5 text-xs rounded-full px-1.5 py-0.5 ${statusTab === 'active' ? 'bg-white/25' : 'bg-slate-100 text-slate-500'}`}>
              {activeLeads.length}
            </span>
          </button>
          <button onClick={() => setStatusTab('contacted')}
            className={`px-4 py-2 text-sm font-semibold rounded-lg border transition-all ${
              statusTab === 'contacted'
                ? 'bg-emerald-600 text-white border-emerald-600 shadow-sm'
                : 'bg-white text-slate-600 border-slate-300 hover:bg-emerald-50 hover:border-emerald-400 hover:text-emerald-700'
            }`}>
            Contacted
            <span className={`ml-1.5 text-xs rounded-full px-1.5 py-0.5 ${statusTab === 'contacted' ? 'bg-white/25' : 'bg-slate-100 text-slate-500'}`}>
              {contactedLeads.length}
            </span>
          </button>
        </div>

        <div className="flex items-center gap-3">
          {dismissed > 0 && (
            <label className="flex items-center gap-1.5 cursor-pointer select-none text-sm text-slate-500">
              <input type="checkbox" checked={showDismissed} onChange={(e) => setShowDismissed(e.target.checked)} className="accent-red-500" />
              Show dismissed
            </label>
          )}
          <button onClick={onGenerate} disabled={isLoading}
            className="rounded-md bg-red-600 hover:bg-red-500 disabled:bg-red-900 disabled:cursor-wait text-white font-semibold px-4 py-2 text-sm transition shadow flex items-center gap-2">
            {isLoading
              ? <><span className="h-3 w-3 rounded-full border-2 border-white/30 border-t-white animate-spin" />{genLabel}</>
              : genLabel}
          </button>
        </div>
      </div>

      {/* Assignee filter */}
      <div className="flex flex-wrap items-center gap-1.5">
        {([
          { key: 'all',        label: `All Leads (${basePool.length})` },
          { key: 'unassigned', label: `Unassigned (${basePool.filter((l) => !l.assignedTo).length})` },
          ...BUYER_NAMES.map((n) => ({
            key: n,
            label: `${n.split(' ')[0]} (${basePool.filter((l) => l.assignedTo === n).length})`,
          })),
        ] as { key: FilterTab; label: string }[]).map(({ key, label }) => (
          <button key={key} onClick={() => setFilterTab(key)}
            className={`px-3 py-1 rounded-full text-xs font-semibold border transition-colors ${
              filterTab === key
                ? 'bg-slate-800 text-white border-slate-800'
                : 'bg-white text-slate-500 border-slate-200 hover:border-slate-400'
            }`}>
            {label}
          </button>
        ))}
      </div>

      {/* Lead cards */}
      {visible.length === 0 ? (
        <p className="py-12 text-center text-sm text-slate-400">
          {statusTab === 'contacted' ? 'No contacted leads yet.' : (
            filterTab !== 'all' && filterTab !== 'unassigned' &&
            contactedLeads.filter((l) => l.assignedTo === filterTab).length > 0
              ? `No active leads for ${filterTab.split(' ')[0]} — check the Contacted tab.`
              : 'No leads match this filter.'
          )}
        </p>
      ) : (
        <div className="space-y-3">
          {visible.map((lead, i) => (
            <LeadCard key={lead.id} lead={lead} rank={i + 1}
              onContact={handleContact} onDismiss={handleDismiss}
              onUndoDismiss={handleUndoDismiss} onAssign={onAssign} onDeal={onDeal} />
          ))}
        </div>
      )}
    </div>
  );
}
