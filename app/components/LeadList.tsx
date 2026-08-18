'use client';
import { useState } from 'react';
import { Lead, LeadStatus } from '@/lib/types';
import LeadCard from './LeadCard';

type Tab = 'pipeline' | 'contacted';

interface Props {
  leads: Lead[];
  onUpdateStatus: (id: string, status: LeadStatus) => void;
  onGenerate: () => void;
  isLoading: boolean;
  genLabel: string;
}

export default function LeadList({ leads, onUpdateStatus, onGenerate, isLoading, genLabel }: Props) {
  const [activeTab, setActiveTab]     = useState<Tab>('pipeline');
  const [showDismissed, setShowDismissed] = useState(true);

  const pipelineLeads  = leads.filter((l) => l.status !== 'contacted');
  const contactedLeads = leads.filter((l) => l.status === 'contacted');
  const dismissed      = pipelineLeads.filter((l) => l.status === 'dismissed').length;

  const pipelineVisible = pipelineLeads.filter((l) =>
    showDismissed ? true : l.status !== 'dismissed'
  );

  const handleContact = (id: string) => {
    const lead = leads.find((l) => l.id === id);
    if (!lead) return;
    onUpdateStatus(id, lead.status === 'contacted' ? 'new' : 'contacted');
  };
  const handleDismiss     = (id: string) => onUpdateStatus(id, 'dismissed');
  const handleUndoDismiss = (id: string) => onUpdateStatus(id, 'new');

  if (leads.length === 0) return null;

  return (
    <div>
      {/* Tab bar */}
      <div className="flex items-end gap-1 border-b border-slate-200 mb-4">
        <button
          onClick={() => setActiveTab('pipeline')}
          className={`relative px-5 py-2.5 text-sm font-semibold rounded-t-lg border border-b-0 transition-colors ${
            activeTab === 'pipeline'
              ? 'bg-white border-slate-200 text-lewisco-700 -mb-px z-10'
              : 'bg-slate-50 border-transparent text-slate-500 hover:text-slate-700'
          }`}
        >
          Find New Leads
          <span className={`ml-2 text-xs rounded-full px-1.5 py-0.5 font-medium ${
            activeTab === 'pipeline' ? 'bg-lewisco-100 text-lewisco-700' : 'bg-slate-200 text-slate-500'
          }`}>
            {pipelineLeads.length}
          </span>
        </button>
        <button
          onClick={() => setActiveTab('contacted')}
          className={`relative px-5 py-2.5 text-sm font-semibold rounded-t-lg border border-b-0 transition-colors ${
            activeTab === 'contacted'
              ? 'bg-white border-slate-200 text-emerald-700 -mb-px z-10'
              : 'bg-slate-50 border-transparent text-slate-500 hover:text-slate-700'
          }`}
        >
          Contacted
          {contactedLeads.length > 0 && (
            <span className={`ml-2 text-xs rounded-full px-1.5 py-0.5 font-medium ${
              activeTab === 'contacted' ? 'bg-emerald-100 text-emerald-700' : 'bg-slate-200 text-slate-500'
            }`}>
              {contactedLeads.length}
            </span>
          )}
        </button>
      </div>

      {/* Pipeline tab */}
      {activeTab === 'pipeline' && (
        <div className="space-y-3">
          <div className="flex flex-wrap items-center justify-between gap-3 rounded-lg bg-slate-50 border border-slate-200 px-4 py-2.5">
            <p className="text-sm text-slate-600 font-medium">
              {pipelineLeads.length} lead{pipelineLeads.length !== 1 ? 's' : ''}
              {dismissed > 0 && <span className="text-slate-400"> · {dismissed} dismissed</span>}
            </p>
            <div className="flex items-center gap-4 text-sm flex-wrap">
              {dismissed > 0 && (
                <label className="flex items-center gap-1.5 cursor-pointer select-none text-slate-600">
                  <input type="checkbox" checked={showDismissed} onChange={(e) => setShowDismissed(e.target.checked)} className="accent-red-500" />
                  Show dismissed
                </label>
              )}
              <button onClick={onGenerate} disabled={isLoading}
                className="rounded-md bg-red-600 hover:bg-red-500 disabled:bg-red-900 disabled:cursor-wait text-white font-semibold px-3 py-1.5 text-sm transition shadow flex items-center gap-2">
                {isLoading
                  ? <><span className="h-3 w-3 rounded-full border-2 border-white/30 border-t-white animate-spin" />{genLabel}</>
                  : genLabel}
              </button>
            </div>
          </div>

          {pipelineVisible.length === 0 ? (
            <p className="py-8 text-center text-sm text-slate-400">No leads in the pipeline.</p>
          ) : (
            pipelineVisible.map((lead, i) => (
              <LeadCard key={lead.id} lead={lead} rank={i + 1}
                onContact={handleContact} onDismiss={handleDismiss} onUndoDismiss={handleUndoDismiss} />
            ))
          )}
        </div>
      )}

      {/* Contacted tab */}
      {activeTab === 'contacted' && (
        <div className="space-y-3">
          <div className="flex items-center justify-between rounded-lg bg-slate-50 border border-slate-200 px-4 py-2.5">
            <p className="text-sm text-slate-600 font-medium">
              <span className="text-emerald-700 font-semibold">{contactedLeads.length}</span> lead{contactedLeads.length !== 1 ? 's' : ''} contacted, claimed exclusively for this buyer
            </p>
          </div>

          {contactedLeads.length === 0 ? (
            <p className="py-8 text-center text-sm text-slate-400">
              No contacted leads yet. Mark a lead as contacted and it will appear here and be removed from other buyers&apos; lists.
            </p>
          ) : (
            contactedLeads.map((lead, i) => (
              <LeadCard key={lead.id} lead={lead} rank={i + 1}
                onContact={handleContact} onDismiss={handleDismiss} onUndoDismiss={handleUndoDismiss} />
            ))
          )}
        </div>
      )}
    </div>
  );
}
