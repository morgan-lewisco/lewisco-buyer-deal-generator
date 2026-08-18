import { BuyerState, Lead, LeadStatus } from './types';

const storageKey = (buyerId: string) => `bdg-live:buyer:${buyerId}`;

// ── Cross-buyer claims ─────────────────────────────────────────────────────
// Shared key: { normalizedCompany → buyerId }
// Marking a lead contacted claims it; un-contacting releases it.
const CLAIMS_KEY = 'bdg-live:claims';
const normalize = (s: string) => s.toLowerCase().replace(/[^a-z0-9]/g, '');

function getClaims(): Record<string, string> {
  if (typeof window === 'undefined') return {};
  try { return JSON.parse(localStorage.getItem(CLAIMS_KEY) ?? '{}'); }
  catch { return {}; }
}

export function claimLead(buyerId: string, company: string): void {
  const claims = getClaims();
  claims[normalize(company)] = buyerId;
  localStorage.setItem(CLAIMS_KEY, JSON.stringify(claims));
}

export function releaseLead(company: string): void {
  const claims = getClaims();
  delete claims[normalize(company)];
  localStorage.setItem(CLAIMS_KEY, JSON.stringify(claims));
}

/** Filter out leads claimed by a different buyer. Claimer keeps their own. */
export function filterClaimedByOthers(buyerId: string, leads: Lead[]): Lead[] {
  const claims = getClaims();
  return leads.filter((l) => {
    const claimedBy = claims[normalize(l.zoomInfoId ?? l.company)];
    return !claimedBy || claimedBy === buyerId;
  });
}

export function loadBuyerState(buyerId: string): BuyerState {
  if (typeof window === 'undefined') return emptyState();
  try {
    const raw = localStorage.getItem(storageKey(buyerId));
    if (!raw) return emptyState();
    return JSON.parse(raw) as BuyerState;
  } catch {
    return emptyState();
  }
}

export function saveBuyerState(buyerId: string, state: BuyerState): void {
  if (typeof window === 'undefined') return;
  localStorage.setItem(storageKey(buyerId), JSON.stringify(state));
}

export function mergeLeads(fresh: Lead[], overrides: Record<string, LeadStatus>): Lead[] {
  return fresh.map((lead) => {
    const key = lead.zoomInfoId ?? lead.company;
    const saved = overrides[key];
    return saved ? { ...lead, status: saved } : lead;
  });
}

/**
 * Accumulate fresh leads into an existing list.
 * Existing leads are never removed. New companies are appended.
 * Statuses (contacted/dismissed) are preserved on both sides.
 * ZoomInfo enrichment fields (contactName, contactTitle, zoomInfoId) are
 * always updated from the fresh batch so contact data stays current.
 * Result is sorted best-score-first.
 */
export function accumulateLeads(
  existing: Lead[],
  fresh: Lead[],
  overrides: Record<string, LeadStatus>
): Lead[] {
  const norm = (s: string) => s.toLowerCase().replace(/[^a-z0-9]/g, '');

  // Build a lookup of fresh leads by normalized key
  const freshByKey = new Map<string, Lead>();
  for (const l of fresh) freshByKey.set(norm(l.zoomInfoId ?? l.company), l);

  // Update existing leads with fresh ZoomInfo enrichment
  const updated = existing.map((l) => {
    const freshLead = freshByKey.get(norm(l.zoomInfoId ?? l.company));
    if (!freshLead) return l;
    return {
      ...l,
      contactName:  freshLead.contactName  ?? l.contactName,
      contactTitle: freshLead.contactTitle ?? l.contactTitle,
      contactEmail: freshLead.contactEmail ?? l.contactEmail,
      contactPhone: freshLead.contactPhone ?? l.contactPhone,
      zoomInfoId:   freshLead.zoomInfoId   ?? l.zoomInfoId,
    };
  });

  // Append genuinely new companies
  const existingKeys = new Set(existing.map((l) => norm(l.zoomInfoId ?? l.company)));
  const newOnes = fresh
    .filter((l) => !existingKeys.has(norm(l.zoomInfoId ?? l.company)))
    .map((l) => {
      const saved = overrides[l.zoomInfoId ?? l.company];
      return saved ? { ...l, status: saved } : l;
    });

  return [...updated, ...newOnes].sort((a, b) => b.blendedScore - a.blendedScore);
}


export function buildOverrides(leads: Lead[]): Record<string, LeadStatus> {
  const out: Record<string, LeadStatus> = {};
  for (const lead of leads) {
    if (lead.status !== 'new') {
      out[lead.zoomInfoId ?? lead.company] = lead.status;
    }
  }
  return out;
}

function emptyState(): BuyerState {
  return { leads: [], generatedAt: null, statusOverrides: {} };
}
