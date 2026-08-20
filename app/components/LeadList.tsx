'use client';
import { useState } from 'react';
import { Lead, LeadStatus } from '@/lib/types';
import { BUYER_NAMES } from '@/lib/buyers';
import LeadCard from './LeadCard';

type StatusFilter = 'all' | 'active' | 'contacted' | 'deals';
type PersonFilter = 'all' | 'unassigned' | string;

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
  const [statusFilter, setStatusFilter] = useState<StatusFilter>('all');
  const [personFilter, setPersonFilter] = useState<PersonFilter>('all');
  const [showDismissed, setShowDismissed] = useState(true);

  // Apply person filter
  function byPerson(pool: Lead[]): Lead[] {
    if (personFilter === 'all') return pool;
    if (personFilter === 'unassigned') return pool.filter((l) => !l.assignedTo);
    return pool.filter((l) => l.assignedTo === personFilter);
  }

  // Apply status filter on top of person filter
  function byStatus(pool: Lead[]): Lead[] {
    if (statusFilter === 'all') return pool;
    if (statusFilter === 'active') return pool.filter((l) => l.status !== 'contacted' && !l.dealMade);
    if (statusFilter === 'contacted') return pool.filter((l) => l.status === 'contacted');
    if (statusFilter === 'deals') return pool.filter((l) => !!l.dealMade);
    return pool;
  }

  const personPool  = byPerson(leads);
  const visible     = byStatus(personPool).filter((l) => showDismissed || l.status !== 'dismissed');
  const hasDismissed = byStatus(personPool).some((l) => l.status === 'dismissed');

  // Counts for status tabs (always within current person filter)
  const counts = {
    all:       personPool.length,
    active:    personPool.filter((l) => l.status !== 'contacted' && !l.dealMade).length,
    contacted: personPool.filter((l) => l.status === 'contacted').length,
    deals:     personPool.filter((l) => !!l.dealMade).length,
  };

  function selectPerson(p: PersonFilter) {
    setPersonFilter(p);
    setStatusFilter('all'); // reset to show all when switching person
  }

  const handleContact     = (id: string) => {
    const lead = leads.find((l) => l.id === id);
    if (!lead) return;
    onUpdateStatus(id, lead.status === 'contacted' ? 'new' : 'contacted');
  };
  const handleDismiss     = (id: string) => onUpdateStatus(id, 'dismissed');
  const handleUndoDismiss = (id: string) => onUpdateStatus(id, 'new');

  if (leads.length === 0) return null;

  const STATUS_TABS: { key: StatusFilter; label: string; activeClass: string; inactiveClass: string }[] = [
    {
      key: 'all',
      label: `All Leads`,
      activeClass:   'bg-slate-800 text-white border-slate-800 shadow-sm',
      inactiveClass: 'bg-white text-slate-600 border-slate-300 hover:bg-slate-50 hover:border-slate-500',
    },
    {
      key: 'active',
      label: `Active`,
      activeClass:   'bg-lewisco-600 text-white border-lewisco-600 shadow-sm',
      inactiveClass: 'bg-white text-slate-600 border-slate-300 hover:bg-lewisco-50 hover:border-lewisco-400 hover:text-lewisco-700',
    },
    {
      key: 'contacted',
      label: `Contacted`,
      activeClass:   'bg-emerald-600 text-white border-emerald-600 shadow-sm',
      inactiveClass: 'bg-white text-slate-600 border-slate-300 hover:bg-emerald-50 hover:border-emerald-400 hover:text-emerald-700',
    },
    {
      key: 'deals',
      label: `🏆 Deals Made`,
      activeClass:   'bg-yellow-500 text-white border-yellow-500 shadow-sm',
      inactiveClass: 'bg-white text-slate-600 border-slate-300 hover:bg-yellow-50 hover:border-yellow-400 hover:text-yellow-700',
    },
  ];

  return (
    <div className="space-y-3">
      {/* Row 1: Status tabs + generate button */}
      <div className="flex flex-wrap items-center justify-between gap-3 rounded-xl bg-white border border-slate-200 px-4 py-3 shadow-sm">
        <div className="flex items-center gap-2 flex-wrap">
          {STATUS_TABS.map(({ key, label, activeClass, inactiveClass }) => (
            <button key={key} onClick={() => setStatusFilter(key)}
              className={`px-4 py-2 text-sm font-semibold rounded-lg border transition-all ${statusFilter === key ? activeClass : inactiveClass}`}>
              {label}
              <span className={`ml-1.5 text-xs rounded-full px-1.5 py-0.5 ${statusFilter === key ? 'bg-white/25' : 'bg-slate-100 text-slate-500'}`}>
                {counts[key]}
              </span>
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
            className="rounded-md bg-red-600 hover:bg-red-500 disabled:bg-red-900 disabled:cursor-wait text-white font-semibold px-4 py-2 text-sm transition shadow flex items-center gap-2">
            {isLoading
              ? <><span className="h-3 w-3 rounded-full border-2 border-white/30 border-t-white animate-spin" />{genLabel}</>
              : genLabel}
          </button>
        </div>
      </div>

      {/* Row 2: Person filter chips */}
      <div className="flex flex-wrap items-center gap-1.5">
        {([
          { key: 'all' as PersonFilter,        label: 'Everyone' },
          { key: 'unassigned' as PersonFilter, label: `Unassigned (${leads.filter((l) => !l.assignedTo).length})` },
          ...BUYER_NAMES.map((n) => ({
            key: n as PersonFilter,
            label: `${n.split(' ')[0]} (${leads.filter((l) => l.assignedTo === n).length})`,
          })),
        ]).map(({ key, label }) => (
          <button key={key} onClick={() => selectPerson(key)}
            className={`px-3 py-1 rounded-full text-xs font-semibold border transition-colors ${
              personFilter === key
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
          No leads match this filter.
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
