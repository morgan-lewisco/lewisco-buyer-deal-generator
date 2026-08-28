import { Lead, LeadStatus, PoolState } from './types';

const POOL_KEY = 'bdg-live:pool';

const norm = (s: string) => s.toLowerCase().trim();

/**
 * Remove parent-company duplicates from a lead list.
 * If a subsidiary lead exists (has parentCompany set), drop any standalone lead
 * whose company name matches that parent.
 * Also collapse "Parent / Child" slash names to the child brand.
 * Finally, deduplicate by normalized company name keeping highest blendedScore.
 */
export function deduplicateLeads(leads: Lead[]): Lead[] {
  // Step 1: resolve slash-format company names → use rightmost token as brand
  const resolved = leads.map((l) => {
    if (l.company.includes('/')) {
      const parts = l.company.split('/').map((p) => p.trim()).filter(Boolean);
      const child  = parts[parts.length - 1];
      const parent = parts.length > 1 ? parts[0] : l.parentCompany;
      return { ...l, company: child, parentCompany: l.parentCompany || parent };
    }
    return l;
  });

  // Step 2: collect parent names referenced by subsidiary leads
  const parentNames = new Set(
    resolved.filter((l) => l.parentCompany).map((l) => norm(l.parentCompany!))
  );
  const subsidiaryNames = new Set(
    resolved.filter((l) => l.parentCompany).map((l) => norm(l.company))
  );

  // Step 3: drop a lead if its company is a known parent of another lead in the pool
  const withoutParents = resolved.filter((l) => {
    const isParentOfAnother = parentNames.has(norm(l.company)) && !subsidiaryNames.has(norm(l.company));
    return !isParentOfAnother;
  });

  // Step 4: deduplicate by normalized company name, keep highest blendedScore
  const byCompany = new Map<string, Lead>();
  for (const l of withoutParents) {
    const key = norm(l.company);
    const existing = byCompany.get(key);
    if (!existing || l.blendedScore > existing.blendedScore) byCompany.set(key, l);
  }

  return [...byCompany.values()].sort((a, b) => b.blendedScore - a.blendedScore);
}

export function loadPoolState(): PoolState {
  if (typeof window === 'undefined') return { leads: [], generatedAt: null };
  try {
    const raw = localStorage.getItem(POOL_KEY);
    if (!raw) return { leads: [], generatedAt: null };
    return JSON.parse(raw) as PoolState;
  } catch {
    return { leads: [], generatedAt: null };
  }
}

export function savePoolState(state: PoolState): void {
  if (typeof window === 'undefined') return;
  localStorage.setItem(POOL_KEY, JSON.stringify(state));
}

export function clearPoolState(): void {
  if (typeof window === 'undefined') return;
  localStorage.removeItem(POOL_KEY);
}

/**
 * Merge fresh leads into the existing pool.
 * - Existing leads keep their status, assignedTo, and ZoomInfo enrichment.
 * - Fresh runs update ZoomInfo contact fields on existing leads.
 * - New companies are appended.
 * - Result sorted best-score-first.
 */
export function accumulateLeads(existing: Lead[], fresh: Lead[]): Lead[] {
  const key = (l: Lead) => norm(l.zoomInfoId ?? l.company).replace(/[^a-z0-9]/g, '');

  const freshByKey = new Map<string, Lead>();
  for (const l of fresh) freshByKey.set(key(l), l);

  const updated = existing.map((l) => {
    const freshLead = freshByKey.get(key(l));
    if (!freshLead) return l;
    return {
      ...l,
      contactName:   freshLead.contactName   ?? l.contactName,
      contactTitle:  freshLead.contactTitle  ?? l.contactTitle,
      contactEmail:  freshLead.contactEmail  ?? l.contactEmail,
      contactPhone:  freshLead.contactPhone  ?? l.contactPhone,
      zoomInfoId:    freshLead.zoomInfoId    ?? l.zoomInfoId,
      parentCompany: freshLead.parentCompany ?? l.parentCompany,
    };
  });

  const existingKeys = new Set(existing.map(key));
  const newOnes = fresh.filter((l) => !existingKeys.has(key(l)));

  // Run parent/subsidiary dedup across the full combined pool
  return deduplicateLeads([...updated, ...newOnes]);
}

export function updateLeadStatus(leads: Lead[], id: string, status: LeadStatus): Lead[] {
  return leads.map((l) => (l.id === id ? { ...l, status } : l));
}

export function updateLeadAssignment(leads: Lead[], id: string, assignedTo: string): Lead[] {
  return leads.map((l) => (l.id === id ? { ...l, assignedTo: assignedTo || undefined } : l));
}

export function updateLeadDeal(leads: Lead[], id: string, dealMade: boolean, dealNotes: string): Lead[] {
  return leads.map((l) =>
    l.id === id ? { ...l, dealMade, dealNotes: dealNotes || undefined } : l
  );
}

export function updateLeadNotes(leads: Lead[], id: string, adminNotes: string): Lead[] {
  return leads.map((l) =>
    l.id === id ? { ...l, adminNotes: adminNotes || undefined } : l
  );
}
