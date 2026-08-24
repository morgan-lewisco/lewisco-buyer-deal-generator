'use client';
import { useState } from 'react';
import { Lead, LeadStatus } from '@/lib/types';
import { BUYER_NAMES } from '@/lib/buyers';
import LeadCard from './LeadCard';

export type StatusFilter = 'all' | 'active' | 'contacted' | 'deals';
export type PersonFilter = 'all' | 'unassigned' | 'assigned' | string;

interface Props {
  leads: Lead[];
  statusFilter: StatusFilter;
  personFilter: PersonFilter;
  onPersonFilter: (p: PersonFilter) => void;
  onUpdateStatus: (id: string, status: LeadStatus) => void;
  onAssign: (id: string, name: string) => void;
  onDeal: (id: string, dealMade: boolean, dealNotes: string) => void;
  onGenerate: () => void;
  isLoading: boolean;
  genLabel: string;
}

export default function LeadList({
  leads, statusFilter, personFilter, onPersonFilter,
  onUpdateStatus, onAssign, onDeal, onGenerate, isLoading, genLabel,
}: Props) {
  const [showDismissed, setShowDismissed] = useState(true);

  function byPerson(pool: Lead[]): Lead[] {
    if (personFilter === 'all') return pool;
    if (personFilter === 'unassigned') return pool.filter((l) => !l.assignedTo);
    if (personFilter === 'assigned') return pool.filter((l) => !!l.assignedTo);
    return pool.filter((l) => l.assignedTo === personFilter);
  }

  function byStatus(pool: Lead[]): Lead[] {
    if (statusFilter === 'all') return pool;
    if (statusFilter === 'active') return pool.filter((l) => l.status !== 'contacted' && !l.dealMade);
    if (statusFilter === 'contacted') return pool.filter((l) => l.status === 'contacted' && !l.dealMade);
    if (statusFilter === 'deals') return pool.filter((l) => !!l.dealMade);
    return pool;
  }

  const personPool  = byPerson(leads);
  const visible     = byStatus(personPool).filter((l) => showDismissed || l.status !== 'dismissed');
  const hasDismissed = byStatus(personPool).some((l) => l.status === 'dismissed');

  const handleContact     = (id: string) => {
    const lead = leads.find((l) => l.id === id);
    if (!lead) return;
    onUpdateStatus(id, lead.status === 'contacted' ? 'new' : 'contacted');
  };
  const handleDismiss     = (id: string) => onUpdateStatus(id, 'dismissed');
  const handleUndoDismiss = (id: string) => onUpdateStatus(id, 'new');

  if (leads.length === 0) return null;

  return (
    <div className="space-y-3">
      {/* Person filter chips + generate button */}
      <div className="flex flex-wrap items-center justify-between gap-3 rounded-xl bg-white border border-slate-200 px-4 py-3 shadow-sm">
        <div className="flex flex-wrap items-center gap-1.5">
          {BUYER_NAMES.map((n) => ({
            key: n as PersonFilter,
            label: `${n.split(' ')[0]} (${leads.filter((l) => l.assignedTo === n).length})`,
          })).map(({ key, label }) => (
            <button key={key} onClick={() => onPersonFilter(personFilter === key ? 'all' : key)}
              className={`px-3 py-1 rounded-full text-xs font-semibold border transition-colors ${
                personFilter === key
                  ? 'bg-slate-800 text-white border-slate-800'
                  : 'bg-white text-slate-500 border-slate-200 hover:border-slate-400'
              }`}>
              {label}
            </button>
          ))}
        </div>

        <div className="flex items-center gap-3">
          {hasDismissed && (
            <label className="flex items-center gap-1.5 cursor-pointer select-none text-sm text-slate-500">
              <input type="checkbox" checked={showDismissed} onChange={(e) => setShowDismissed(e.target.checked)} className="accent-red-500" />
              Show dismissed
            </label>
          )}
          <button onClick={onGenerate} disabled={isLoading}
            className="rounded-md bg-red-600 hover:bg-red-500 disabled:bg-red-900 disabled:cursor-wait text-white font-semibold px-4 py-2 text-sm transition shadow flex items-center gap-2 whitespace-nowrap">
            {isLoading
              ? <><span className="h-3 w-3 rounded-full border-2 border-white/30 border-t-white animate-spin" />{genLabel}</>
              : genLabel}
          </button>
        </div>
      </div>

      {/* Lead cards */}
      {visible.length === 0 ? (
        <p className="py-12 text-center text-sm text-slate-400">No leads match this filter.</p>
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
