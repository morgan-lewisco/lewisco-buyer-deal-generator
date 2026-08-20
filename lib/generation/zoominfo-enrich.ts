/**
 * ZoomInfo enrichment — GTM API, Client Credentials OAuth.
 * Pulls top contact name + title per lead. Email/phone require a ZoomInfo
 * Enrich add-on (not included in this API tier); the UI shows a direct
 * ZoomInfo search link so buyers can look up contact details themselves.
 *
 * Env vars (server-side only — never expose to the browser):
 *   ZOOMINFO_CLIENT_ID
 *   ZOOMINFO_CLIENT_SECRET
 */

import { Lead } from '../types';

const BASE       = 'https://api.zoominfo.com';
const USER_AGENT = 'LewiscoHoldings-BuyerDealGenerator/1.0';

// Token cache — reuse within the same server process (token lasts 24h)
let _cachedToken: string | null = null;
let _tokenExpiresAt = 0;

export async function getAccessToken(): Promise<string | null> {
  if (_cachedToken && Date.now() < _tokenExpiresAt) return _cachedToken;

  const clientId     = process.env.ZOOMINFO_CLIENT_ID;
  const clientSecret = process.env.ZOOMINFO_CLIENT_SECRET;
  if (!clientId || !clientSecret) {
    console.warn('[zoominfo] ZOOMINFO_CLIENT_ID / ZOOMINFO_CLIENT_SECRET not set — skipping enrichment');
    return null;
  }

  try {
    const res = await fetch(`${BASE}/gtm/oauth/v1/token`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/x-www-form-urlencoded',
        'User-Agent': USER_AGENT,
      },
      body: new URLSearchParams({
        grant_type:    'client_credentials',
        client_id:     clientId,
        client_secret: clientSecret,
      }).toString(),
    });

    if (!res.ok) {
      console.warn(`[zoominfo] Auth failed: ${res.status} ${await res.text()}`);
      return null;
    }

    const data = await res.json();
    _cachedToken    = data.access_token ?? null;
    // Token valid for 24h — cache for 23h to be safe
    _tokenExpiresAt = Date.now() + 23 * 60 * 60 * 1000;
    return _cachedToken;
  } catch (err) {
    console.warn('[zoominfo] Auth error:', err);
    return null;
  }
}

// Role relevance — ranked lowest to highest priority (last match wins).
const ROLE_PRIORITY = [
  // ── Finance (last resort)
  'controller', 'vp of finance', 'director of financial planning', 'cfo', 'chief financial',

  // ── Executive / owner (good for small brands)
  'managing partner', 'partner', 'principal', 'general manager',
  'managing director', 'co-founder', 'founder', 'owner',
  'president', 'ceo', 'chief executive',

  // ── Supply chain / inventory (influencers who flag what needs to move)
  'warehouse', 'distribution manager', 'logistics manager',
  'materials manager', 'commodity manager', 'supply manager', 'vendor manager', 'supplier manager',
  'demand planning', 's&op', 'inventory control', 'inventory manager',
  'director of operations', 'supply chain manager',
  'vp of supply chain', 'director of supply chain',

  // ── Retail / CPG buying & merchandising
  'assistant buyer', 'merchandise planner', 'merchandising manager',
  'category buyer', 'senior buyer', 'buyer',
  'divisional merchandise manager', 'dmm', 'general merchandise manager', 'gmm',
  'vp of merchandising', 'director of merchandising',
  'category manager', 'director of category management',

  // ── Procurement / purchasing
  'purchasing agent', 'purchasing manager', 'procurement manager',
  'sourcing manager', 'category sourcing', 'strategic sourcing',
  'director of purchasing', 'director of procurement',
  'vp of purchasing', 'vp of procurement',
  'chief procurement', 'cpo',

  // ── General sales
  'account executive', 'sales manager', 'sales operations manager',
  'regional sales manager', 'regional sales director',
  'key account manager', 'national account manager', 'director of national accounts',
  'channel manager', 'commercial director',
  'business development manager', 'business development director',
  'vp business development', 'head of trade', 'director of trade sales',
  'head of sales', 'director of sales', 'sales director',
  'national sales manager',
  'vp sales & marketing', 'vp of sales', 'vp sales', 'vice president of sales', 'vice president sales',
  'svp sales', 'svp of sales', 'evp sales', 'evp of sales',
  'chief sales', 'chief commercial', 'cco',
  'chief revenue', 'cro',

  // ── Closeout / excess-inventory specific — HIGHEST PRIORITY
  'salvage sales', 'overstock manager', 'deal manager', 'broker manager', 'special markets',
  'discount channel', 'value channel', 'liquidation specialist',
  'excess & obsolete', 'e&o inventory', 'inventory liquidation',
  'liquidation manager', 'alternative channel', 'secondary channel',
  'off-price sales', 'closeout sales', 'director of closeouts',
  'vp of closeouts', 'manager of closeouts',
];

// Seniority — tiebreaker when role bands are equal
const SENIORITY = [
  'agent', 'representative', 'associate', 'coordinator', 'analyst', 'specialist', 'planner',
  'assistant', 'executive',
  'manager', 'senior manager',
  'director', 'senior director',
  'vp', 'vice president', 'svp', 'senior vice president', 'evp', 'executive vice president',
  'chief', 'president', 'ceo', 'coo', 'cfo', 'cro', 'cco', 'cpo',
  'owner', 'founder', 'partner',
];

/**
 * ZoomInfo returns titles in "Role, Function" format (e.g. "Manager, Purchasing")
 * and uses "Vice President" not "VP". Expand titles to match both orderings and
 * abbreviations so our substring scoring works correctly.
 */
function expandTitle(title: string): string {
  const base = title.toLowerCase()
    // Fix ZoomInfo HTML entity artifacts ("& Amp;" → "&")
    .replace(/&\s*amp;/gi, '&')
    // Expand long forms to abbreviations
    .replace(/\bsenior vice president\b/g, 'svp')
    .replace(/\bexecutive vice president\b/g, 'evp')
    .replace(/\bvice president\b/g, 'vp');

  // Also generate comma-reversed form: "Manager, Purchasing" → "purchasing manager"
  const parts = base.split(/,\s*/);
  const reversed = parts.length === 2
    ? `${parts[1].trim()} ${parts[0].trim()}`
    : '';

  // Strip commas for flat matching ("vp, sales" → "vp sales")
  const flat = base.replace(/,/g, ' ').replace(/\s+/g, ' ').trim();

  return [flat, reversed].filter(Boolean).join(' | ');
}

function roleScore(title: string): number {
  const t = expandTitle(title);
  let best = -1;
  for (let i = 0; i < ROLE_PRIORITY.length; i++) {
    if (t.includes(ROLE_PRIORITY[i])) best = i;
  }
  return best;
}

function seniorityScore(title: string): number {
  const t = expandTitle(title);
  let best = -1;
  for (let i = 0; i < SENIORITY.length; i++) {
    if (t.includes(SENIORITY[i])) best = i;
  }
  return best;
}

function titleScore(title: string): number {
  // Role relevance is primary (×100), seniority breaks ties within the same band
  return roleScore(title) * 100 + seniorityScore(title);
}

interface ZIContact {
  id?: string | number;
  firstName?: string;
  lastName?: string;
  jobTitle?: string;
}

// Strip common legal/product suffixes to improve ZoomInfo match rate
const SUFFIX_RE = /\b(llc|inc|corp|co|ltd|foods|food|snacks|snack|company|brands|brand|group|international|enterprises|industries|products|product)\b\.?$/i;

function nameVariants(name: string): string[] {
  const clean = (s: string) => s.replace(/[,.\s]+$/, '').trim();
  const variants = [name];
  const stripped = clean(name.replace(SUFFIX_RE, ''));
  if (stripped && stripped !== name) variants.push(stripped);
  // Also try removing everything after a comma or parenthesis (e.g. "Acme Foods, Inc.")
  const beforeComma = clean(name.split(/[,(]/)[0]);
  if (beforeComma && beforeComma !== name && beforeComma !== stripped) variants.push(beforeComma);
  return [...new Set(variants)];
}

async function searchContacts(token: string, companyName: string): Promise<ZIContact[]> {
  const res = await fetch(`${BASE}/gtm/data/v1/contacts/search`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/vnd.api+json',
      'Accept':       'application/vnd.api+json',
      'Authorization': `Bearer ${token}`,
      'User-Agent':   USER_AGENT,
    },
    body: JSON.stringify({ data: { type: 'ContactSearch', attributes: { companyName } } }),
  });
  if (!res.ok) return [];
  const data = await res.json();
  return (data.data ?? []).map((item: { id?: string | number; attributes?: ZIContact }) => ({
    id:        item.id,
    firstName: item.attributes?.firstName,
    lastName:  item.attributes?.lastName,
    jobTitle:  item.attributes?.jobTitle,
  }));
}

async function searchContactsByWebsite(token: string, website: string): Promise<ZIContact[]> {
  // Strip protocol prefix if present
  const domain = website.replace(/^https?:\/\//i, '').split('/')[0];
  const res = await fetch(`${BASE}/gtm/data/v1/contacts/search`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/vnd.api+json',
      'Accept':       'application/vnd.api+json',
      'Authorization': `Bearer ${token}`,
      'User-Agent':   USER_AGENT,
    },
    body: JSON.stringify({ data: { type: 'ContactSearch', attributes: { companyWebsite: domain } } }),
  });
  if (!res.ok) return [];
  const data = await res.json();
  return (data.data ?? []).map((item: { id?: string | number; attributes?: ZIContact }) => ({
    id:        item.id,
    firstName: item.attributes?.firstName,
    lastName:  item.attributes?.lastName,
    jobTitle:  item.attributes?.jobTitle,
  }));
}

export async function fetchTopContact(token: string, companyName: string, website?: string): Promise<{ name?: string; title?: string; ziId?: string } | null> {
  try {
    // Try company name variants first, then fall back to website domain search
    let contacts: ZIContact[] = [];
    for (const variant of nameVariants(companyName)) {
      contacts = await searchContacts(token, variant);
      if (contacts.length > 0) break;
    }
    // Website fallback — ZoomInfo domain matching often more reliable than name
    if (contacts.length === 0 && website) {
      contacts = await searchContactsByWebsite(token, website);
    }

    if (contacts.length === 0) return null;

    const best = contacts
      .map((c) => ({ c, score: titleScore(c.jobTitle ?? '') }))
      .sort((a, b) => b.score - a.score)[0]?.c;

    if (!best) return null;

    return {
      name:  [best.firstName, best.lastName].filter(Boolean).join(' ') || undefined,
      title: best.jobTitle || undefined,
      ziId:  best.id ? String(best.id) : undefined,
    };
  } catch {
    return null;
  }
}

/**
 * Enrich leads with ZoomInfo contact name + title.
 * Graceful — any failure returns leads unchanged.
 * Rate-limited to 4 concurrent requests.
 */
export async function enrichLeadsWithZoomInfo(leads: Lead[]): Promise<Lead[]> {
  if (leads.length === 0) return leads;

  const token = await getAccessToken();
  if (!token) return leads;

  const CONCURRENCY = 4;
  const enriched    = [...leads];

  for (let i = 0; i < leads.length; i += CONCURRENCY) {
    const batch   = leads.slice(i, i + CONCURRENCY);
    const results = await Promise.all(batch.map((lead) => fetchTopContact(token, lead.company, lead.website)));

    results.forEach((patch, j) => {
      if (!patch) return;
      const lead = enriched[i + j];
      enriched[i + j] = {
        ...lead,
        contactName:  patch.name  ?? lead.contactName,
        contactTitle: patch.title ?? lead.contactTitle,
        zoomInfoId:   patch.ziId  ?? lead.zoomInfoId,
      };
    });
  }

  return enriched;
}
