'use client';
import { useState } from 'react';
import { Lead, LeadStatus, ZohoMatch } from '@/lib/types';
import { BUYER_NAMES } from '@/lib/buyers';

interface Props {
  lead: Lead;
  rank: number;
  onContact: (id: string) => void;
  onDismiss: (id: string) => void;
  onUndoDismiss: (id: string) => void;
  onAssign: (id: string, name: string) => void;
  onDeal: (id: string, dealMade: boolean, dealNotes: string) => void;
  zohoData?: ZohoMatch;
  onZohoLink?: (company: string, match: ZohoMatch | null) => void;
}

const SIGNAL_CONFIG: Record<string, { label: string; className: string }> = {
  plant_closure:       { label: 'Plant Closure',       className: 'bg-red-100 text-red-800 border-red-200' },
  layoffs:             { label: 'Layoffs',              className: 'bg-orange-100 text-orange-800 border-orange-200' },
  merger_acquisition:  { label: 'Mergers & Acquisitions', className: 'bg-amber-100 text-amber-800 border-amber-200' },
  divestiture:         { label: 'Divestiture',         className: 'bg-purple-100 text-purple-800 border-purple-200' },
  facility_relocation: { label: 'Facility Relocation', className: 'bg-blue-100 text-blue-800 border-blue-200' },
  lookalike:           { label: 'Comparable Zoho Accounts', className: 'bg-lewisco-100 text-lewisco-800 border-lewisco-200' },
};

const CATEGORY_CONFIG: Record<string, string> = {
  beverages:         'bg-blue-100 text-blue-800',
  beverage:          'bg-blue-100 text-blue-800',
  snacks:            'bg-orange-100 text-orange-800',
  candy:             'bg-pink-100 text-pink-800',
  'sports nutrition':'bg-purple-100 text-purple-800',
  'canned grocery':  'bg-teal-100 text-teal-800',
  'canned seafood':  'bg-cyan-100 text-cyan-800',
  dairy:             'bg-sky-100 text-sky-800',
  condiments:        'bg-amber-100 text-amber-800',
  pantry:            'bg-amber-100 text-amber-800',
  'international foods': 'bg-indigo-100 text-indigo-800',
  'hispanic/specialty':  'bg-indigo-100 text-indigo-800',
  sweeteners:        'bg-yellow-100 text-yellow-800',
  'pet food':        'bg-violet-100 text-violet-800',
};

function categoryClass(cat: string): string {
  return CATEGORY_CONFIG[cat.toLowerCase()] ?? 'bg-slate-100 text-slate-600';
}

// Filter out placeholder values that should display as blank
function val(s?: string): string {
  if (!s) return '';
  const t = s.trim();
  if (/^<.*>$/.test(t)) return '';           // <UNKNOWN>, <N/A>, etc.
  if (/^unknown$/i.test(t)) return '';        // Unknown, UNKNOWN
  if (/^n\/?a$/i.test(t)) return '';          // N/A, NA
  if (t === '-' || t === '—') return '';
  return t;
}


export default function LeadCard({ lead, rank, onContact, onDismiss, onUndoDismiss, onAssign, onDeal, zohoData, onZohoLink }: Props) {
  const isContacted = lead.status === 'contacted';
  const isDismissed = lead.status === 'dismissed';
  const [showDealForm, setShowDealForm]   = useState(false);
  const [draftNotes, setDraftNotes]       = useState(lead.dealNotes ?? '');
  const [showLinkForm, setShowLinkForm]   = useState(false);
  const [linkInput, setLinkInput]         = useState('');
  const [linkLoading, setLinkLoading]     = useState(false);
  const [linkError, setLinkError]         = useState('');
  const [suggestions, setSuggestions]     = useState<string[]>([]);
  const suggestTimer                      = useState<ReturnType<typeof setTimeout> | null>(null);

  async function fetchSuggestions(q: string) {
    if (q.length < 2) { setSuggestions([]); return; }
    try {
      const res = await fetch(`/api/zoho-link?q=${encodeURIComponent(q)}`);
      const data = await res.json();
      setSuggestions(data.vendors ?? []);
    } catch { /* ignore */ }
  }

  function onLinkInputChange(val: string) {
    setLinkInput(val);
    setLinkError('');
    if (suggestTimer[0]) clearTimeout(suggestTimer[0]);
    suggestTimer[0] = setTimeout(() => fetchSuggestions(val), 250);
  }

  function pickSuggestion(name: string) {
    setLinkInput(name);
    setSuggestions([]);
    submitLink(name);
  }

  async function submitLink(vendorName: string) {
    if (!vendorName.trim()) return;
    setLinkLoading(true);
    setLinkError('');
    setSuggestions([]);
    try {
      const res = await fetch('/api/zoho-link', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ company: lead.company, vendorName: vendorName.trim() }),
      });
      const data = await res.json();
      if (!res.ok) {
        setLinkError(data.error ?? 'Not found — pick from the suggestions.');
      } else {
        onZohoLink?.(lead.company, data.match);
        setShowLinkForm(false);
        setLinkInput('');
      }
    } catch {
      setLinkError('Request failed — check your connection.');
    } finally {
      setLinkLoading(false);
    }
  }

  async function handleLink(e: React.FormEvent) {
    e.preventDefault();
    submitLink(linkInput);
  }

  async function handleUnlink() {
    await fetch('/api/zoho-link', {
      method: 'DELETE',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ company: lead.company }),
    });
    onZohoLink?.(lead.company, null);
  }

  const cardClass = [
    'rounded-lg border p-4 transition-all',
    lead.dealMade ? 'border-yellow-400 bg-yellow-100' : '',
    !lead.dealMade && isContacted  ? 'border-emerald-200 bg-emerald-50/40' : '',
    !lead.dealMade && isDismissed  ? 'border-red-200 bg-red-50/30 opacity-70' : '',
    !lead.dealMade && !isContacted && !isDismissed ? 'border-slate-200 bg-white' : '',
  ].join(' ');

  const titleClass = [
    'font-semibold text-base',
    isContacted  ? 'text-emerald-800' : '',
    isDismissed  ? 'line-through text-red-700' : '',
    !isContacted && !isDismissed ? 'text-slate-900' : '',
  ].join(' ');

  return (
    <div className={cardClass}>
      <div className="flex items-start justify-between gap-3">
        <div className="flex items-start gap-3 min-w-0">
          <span className="mt-0.5 flex-shrink-0 w-6 text-center text-xs font-bold text-slate-400">#{rank}</span>

          <div className="min-w-0">
            <div className="flex items-center gap-2 flex-wrap">
              {lead.sourceUrl ? (
                <a href={lead.sourceUrl} target="_blank" rel="noopener noreferrer"
                   className={`${titleClass} hover:underline`}>
                  {lead.company}
                </a>
              ) : (
                <span className={titleClass}>{lead.company}</span>
              )}
              {lead.dealMade && (
                <span className="text-xs font-medium text-yellow-800 bg-yellow-200 rounded-full px-2 py-0.5">🤝 Deal Made</span>
              )}
              {isContacted && !lead.dealMade && (
                <span className="text-xs font-medium text-emerald-700 bg-emerald-100 rounded-full px-2 py-0.5">✓ Engaged</span>
              )}
              {isDismissed && (
                <span className="text-xs font-medium text-red-700 bg-red-100 rounded-full px-2 py-0.5">Dismissed</span>
              )}
            </div>

            {lead.parentCompany && (
              <p className="text-xs text-slate-400 mt-0.5">
                a <span className="font-medium text-slate-500">{lead.parentCompany}</span> brand
              </p>
            )}

            <div className="flex flex-wrap gap-1.5 mt-1.5">
              <span className={`inline-flex items-center rounded px-2 py-0.5 text-xs font-medium ${categoryClass(lead.category)}`}>
                {lead.category}
              </span>
              {SIGNAL_CONFIG[lead.signalType] && (
                <span className={`inline-flex items-center rounded px-2 py-0.5 text-xs font-medium border ${SIGNAL_CONFIG[lead.signalType].className}`}>
                  {SIGNAL_CONFIG[lead.signalType].label}
                </span>
              )}
            </div>

            {/* Why now + Google search */}
            <div className="mt-2 flex items-start gap-2">
              <p className="text-sm text-slate-700 leading-snug italic flex-1">&ldquo;{lead.whyNow}&rdquo;</p>
              <a
                href={`https://www.google.com/search?q=${encodeURIComponent(lead.whyNow)}`}
                target="_blank"
                rel="noopener noreferrer"
                title="Search this on Google"
                className="flex-shrink-0 mt-0.5"
              >
                <svg viewBox="0 0 24 24" className="w-4 h-4 hover:opacity-70 transition-opacity" xmlns="http://www.w3.org/2000/svg">
                  <path d="M22.56 12.25c0-.78-.07-1.53-.2-2.25H12v4.26h5.92c-.26 1.37-1.04 2.53-2.21 3.31v2.77h3.57c2.08-1.92 3.28-4.74 3.28-8.09z" fill="#4285F4"/>
                  <path d="M12 23c2.97 0 5.46-.98 7.28-2.66l-3.57-2.77c-.98.66-2.23 1.06-3.71 1.06-2.86 0-5.29-1.93-6.16-4.53H2.18v2.84C3.99 20.53 7.7 23 12 23z" fill="#34A853"/>
                  <path d="M5.84 14.09c-.22-.66-.35-1.36-.35-2.09s.13-1.43.35-2.09V7.07H2.18C1.43 8.55 1 10.22 1 12s.43 3.45 1.18 4.93l3.66-2.84z" fill="#FBBC05"/>
                  <path d="M12 5.38c1.62 0 3.06.56 4.21 1.64l3.15-3.15C17.45 2.09 14.97 1 12 1 7.7 1 3.99 3.47 2.18 7.07l3.66 2.84c.87-2.6 3.3-4.53 6.16-4.53z" fill="#EA4335"/>
                </svg>
              </a>
            </div>

            {/* Meta */}
            <div className="mt-2 flex flex-wrap gap-x-4 gap-y-0.5 text-xs text-slate-500">
              {val(lead.revenueRange) && <span>{val(lead.revenueRange)}</span>}
              {val(lead.employeeSize) && <span>{val(lead.employeeSize)} employees</span>}
              {val(lead.location) && <span>{val(lead.location)}</span>}
              {val(lead.website) && (
                <a href={`https://${val(lead.website)}`} target="_blank" rel="noopener noreferrer"
                   className="text-lewisco-600 hover:underline">{val(lead.website)}</a>
              )}
            </div>


            {/* Deal notes */}
            {lead.dealMade && lead.dealNotes && (
              <p className="mt-2 text-xs text-yellow-800 bg-yellow-100 border border-yellow-200 rounded px-2 py-1.5">
                <span className="font-semibold">Deal: </span>{lead.dealNotes}
              </p>
            )}

            {/* Deal notes form */}
            {showDealForm && (
              <div className="mt-2 space-y-1.5">
                <textarea
                  value={draftNotes}
                  onChange={(e) => setDraftNotes(e.target.value)}
                  placeholder="Brief description of the deal (product, quantity, price, etc.)"
                  rows={2}
                  autoFocus
                  className="w-full rounded border border-yellow-300 bg-white px-2 py-1.5 text-xs focus:outline-none focus:ring-1 focus:ring-yellow-400 resize-none"
                />
                <div className="flex gap-2">
                  <button
                    onClick={() => { onDeal(lead.id, true, draftNotes); setShowDealForm(false); }}
                    className="rounded px-3 py-1 text-xs font-semibold bg-yellow-400 hover:bg-yellow-300 text-yellow-900 transition">
                    Save Deal
                  </button>
                  <button
                    onClick={() => setShowDealForm(false)}
                    className="rounded px-3 py-1 text-xs font-medium text-slate-500 hover:text-slate-700 transition">
                    Cancel
                  </button>
                  {lead.dealMade && (
                    <button
                      onClick={() => { onDeal(lead.id, false, ''); setShowDealForm(false); }}
                      className="ml-auto rounded px-3 py-1 text-xs font-medium text-red-500 hover:text-red-700 transition">
                      Remove Deal
                    </button>
                  )}
                </div>
              </div>
            )}

            {/* ZoomInfo contact row */}
            <div className="mt-1.5 flex flex-wrap items-center gap-x-3 gap-y-1 text-xs">
              {lead.contactName && (
                <span className="text-slate-700">
                  👤 <span className="font-medium">{lead.contactName}</span>
                  {lead.contactTitle && <span className="text-slate-500"> · {lead.contactTitle}</span>}
                </span>
              )}
              {lead.contactEmail && <span className="text-slate-600">✉ {lead.contactEmail}</span>}
              {lead.contactPhone && <span className="text-slate-600">📞 {lead.contactPhone}</span>}
              <a
                href={
                  lead.zoomInfoId
                    ? `https://app.zoominfo.com/#/apps/profile/person/${lead.zoomInfoId}/overview`
                    : `https://app.zoominfo.com/#/apps/home-page?employerName=${encodeURIComponent(lead.company)}${lead.website ? `&companyWebsite=${encodeURIComponent(lead.website)}` : ''}`
                }
                target="_blank"
                rel="noopener noreferrer"
                className="inline-flex items-center gap-1 rounded px-2 py-0.5 text-xs font-semibold bg-blue-50 text-blue-700 border border-blue-200 hover:bg-blue-100 transition"
                title="Search contacts in ZoomInfo"
              >
                <svg viewBox="0 0 24 24" className="w-3 h-3" fill="currentColor"><path d="M12 12c2.7 0 4.8-2.1 4.8-4.8S14.7 2.4 12 2.4 7.2 4.5 7.2 7.2 9.3 12 12 12zm0 2.4c-3.2 0-9.6 1.6-9.6 4.8v2.4h19.2v-2.4c0-3.2-6.4-4.8-9.6-4.8z"/></svg>
                ZoomInfo
              </a>
              <a
                href={`https://www.linkedin.com/search/results/people/?keywords=${encodeURIComponent(lead.company)}&origin=GLOBAL_SEARCH_HEADER`}
                target="_blank"
                rel="noopener noreferrer"
                className="inline-flex items-center gap-1 rounded px-2 py-0.5 text-xs font-semibold bg-sky-50 text-sky-700 border border-sky-200 hover:bg-sky-100 transition"
                title="Search contacts on LinkedIn"
              >
                <svg viewBox="0 0 24 24" className="w-3 h-3" fill="currentColor"><path d="M20.447 20.452h-3.554v-5.569c0-1.328-.027-3.037-1.852-3.037-1.853 0-2.136 1.445-2.136 2.939v5.667H9.351V9h3.414v1.561h.046c.477-.9 1.637-1.85 3.37-1.85 3.601 0 4.267 2.37 4.267 5.455v6.286zM5.337 7.433a2.062 2.062 0 0 1-2.063-2.065 2.064 2.064 0 1 1 2.063 2.065zm1.782 13.019H3.555V9h3.564v11.452zM22.225 0H1.771C.792 0 0 .774 0 1.729v20.542C0 23.227.792 24 1.771 24h20.451C23.2 24 24 23.227 24 22.271V1.729C24 .774 23.2 0 22.222 0h.003z"/></svg>
                LinkedIn
              </a>
            </div>
          </div>
        </div>

        {/* Controls */}
        <div className="flex flex-shrink-0 flex-col items-end gap-2">
          {/* Zoho CRM info */}
          {zohoData !== undefined && (
            <div className="text-right text-xs leading-snug max-w-[200px]">
              {zohoData.found ? (
                <div className="space-y-0.5">
                  {zohoData.overridden && (
                    <div className="flex items-center justify-end gap-1 mb-0.5">
                      <span className="text-indigo-500 italic text-[10px]">linked override</span>
                      <button onClick={handleUnlink} title="Remove override"
                        className="text-[10px] text-slate-400 hover:text-red-500 transition">✕</button>
                    </div>
                  )}
                  <div className="text-slate-500">
                    <span className="font-medium text-slate-600">Bought Manager:</span>{' '}
                    <span className={zohoData.boughtManager === 'None' ? 'text-slate-400 italic' : 'text-slate-700'}>{zohoData.boughtManager}</span>
                  </div>
                  <div className="text-slate-500">
                    <span className="font-medium text-slate-600">Originated By:</span>{' '}
                    <span className={zohoData.vendorOriginatorByName === 'None' ? 'text-slate-400 italic' : 'text-slate-700'}>{zohoData.vendorOriginatorByName}</span>
                  </div>
                </div>
              ) : showLinkForm ? (
                <form onSubmit={handleLink} className="space-y-1 text-left">
                  <div className="relative">
                    <input
                      autoFocus
                      value={linkInput}
                      onChange={(e) => onLinkInputChange(e.target.value)}
                      placeholder="Type to search Zoho vendors…"
                      className="w-full rounded border border-indigo-300 px-2 py-1 text-xs focus:outline-none focus:ring-1 focus:ring-indigo-400"
                    />
                    {suggestions.length > 0 && (
                      <ul className="absolute right-0 top-full z-20 mt-0.5 w-56 rounded border border-slate-200 bg-white shadow-lg text-[11px]">
                        {suggestions.map((s) => (
                          <li key={s}>
                            <button type="button" onMouseDown={() => pickSuggestion(s)}
                              className="w-full text-left px-2 py-1.5 hover:bg-indigo-50 hover:text-indigo-700 truncate">
                              {s}
                            </button>
                          </li>
                        ))}
                      </ul>
                    )}
                  </div>
                  {linkError && <p className="text-red-500 text-[10px] leading-tight">{linkError}</p>}
                  <div className="flex gap-1">
                    <button type="submit" disabled={linkLoading}
                      className="rounded px-2 py-0.5 text-[10px] font-semibold bg-indigo-600 hover:bg-indigo-500 disabled:opacity-60 text-white transition">
                      {linkLoading ? '…' : 'Link'}
                    </button>
                    <button type="button" onClick={() => { setShowLinkForm(false); setLinkError(''); setLinkInput(''); setSuggestions([]); }}
                      className="rounded px-2 py-0.5 text-[10px] text-slate-500 hover:text-slate-700 transition">
                      Cancel
                    </button>
                  </div>
                </form>
              ) : (
                <div className="flex items-center justify-end gap-1.5">
                  <span className="text-slate-400 italic">Vendor not in Zoho</span>
                  <button onClick={() => setShowLinkForm(true)}
                    className="text-[10px] font-semibold text-indigo-500 hover:text-indigo-700 border border-indigo-200 hover:border-indigo-400 rounded px-1.5 py-0.5 transition whitespace-nowrap">
                    Link
                  </button>
                </div>
              )}
            </div>
          )}

          {/* Assignment dropdown */}
          <select
            value={lead.assignedTo ?? ''}
            onChange={(e) => onAssign(lead.id, e.target.value)}
            className={`rounded border px-2 py-1 text-xs font-medium focus:outline-none focus:ring-1 focus:ring-lewisco-400 ${
              lead.assignedTo
                ? 'border-lewisco-300 bg-lewisco-50 text-lewisco-800'
                : 'border-slate-200 bg-white text-slate-400'
            }`}
          >
            <option value="">Unassigned</option>
            {BUYER_NAMES.map((name) => (
              <option key={name} value={name}>{name}</option>
            ))}
          </select>

          <div className="flex items-center gap-2">
            <button
              onClick={() => { setDraftNotes(lead.dealNotes ?? ''); setShowDealForm((v) => !v); }}
              className={`rounded px-2 py-1 text-xs font-semibold border transition ${
                lead.dealMade
                  ? 'bg-yellow-200 text-yellow-800 border-yellow-300 hover:bg-yellow-100'
                  : 'bg-white text-slate-500 border-slate-200 hover:border-yellow-400 hover:text-yellow-700'
              }`}
              title="Mark as deal made">
              🤝 Deal
            </button>
            <label className="flex items-center gap-1.5 cursor-pointer select-none" title="Mark contacted">
              <input type="checkbox" checked={isContacted}
                onChange={() => onContact(lead.id)}
                className="w-4 h-4 accent-emerald-600 cursor-pointer" />
              <span className="text-xs text-slate-500 hidden sm:inline">Engaged</span>
            </label>

            {isDismissed ? (
              <button onClick={() => onUndoDismiss(lead.id)}
                className="rounded px-2 py-1 text-xs font-medium text-red-600 border border-red-300 hover:bg-red-50 transition">
                Undo
              </button>
            ) : (
              <button onClick={() => onDismiss(lead.id)}
                className="rounded px-2 py-1 text-xs font-medium text-slate-400 border border-slate-200 hover:border-red-300 hover:text-red-500 transition"
                title="Dismiss">
                ✕
              </button>
            )}

            <a
              href="https://crm.zoho.com/crm/org695870911/tab/Vendors"
              target="_blank"
              rel="noopener noreferrer"
              className="rounded px-2 py-1 text-xs font-medium text-blue-600 border border-blue-300 hover:bg-blue-50 transition">
              + Zoho
            </a>
          </div>
        </div>
      </div>
    </div>
  );
}
