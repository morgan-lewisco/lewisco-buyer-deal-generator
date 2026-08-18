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

async function getAccessToken(): Promise<string | null> {
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

// Role relevance — higher index wins. Broad 'sales' is low so it doesn't
// override specific high-value titles.
const ROLE_PRIORITY = [
  // Last resort — any C-suite beats nothing
  'ceo', 'chief executive', 'coo', 'chief operating', 'cfo', 'chief financial',
  'president', 'owner', 'founder',
  // Ops / supply chain — secondary
  'supply chain', 'logistics', 'procurement', 'purchasing', 'inventory',
  // Broad sales — catch-all but overridden by specific titles below
  'sales',
  // Commercial
  'trade marketing', 'category management', 'channel', 'national accounts',
  'key accounts', 'account management', 'business development',
  // Sales leadership — top priority
  'sales operations', 'director of sales', 'sales director',
  'vp of sales', 'vp sales', 'vice president of sales', 'vice president sales',
  'svp of sales', 'svp sales', 'chief sales', 'chief revenue', 'cro',
  'head of sales', 'head of revenue', 'general manager sales',
];

// Seniority — tiebreaker when role priority is equal
const SENIORITY = [
  'representative', 'associate', 'coordinator', 'analyst', 'specialist',
  'manager', 'senior manager',
  'director', 'senior director',
  'vp', 'vice president', 'svp', 'senior vice president', 'evp', 'executive vice president',
  'chief', 'president', 'ceo', 'coo', 'cfo', 'cro', 'owner', 'founder',
];

function roleScore(title: string): number {
  const t = title.toLowerCase();
  let best = -1;
  for (let i = 0; i < ROLE_PRIORITY.length; i++) {
    if (t.includes(ROLE_PRIORITY[i])) best = i;
  }
  return best;
}

function seniorityScore(title: string): number {
  const t = title.toLowerCase();
  let best = -1;
  for (let i = 0; i < SENIORITY.length; i++) {
    if (t.includes(SENIORITY[i])) best = i;
  }
  return best;
}

function titleScore(title: string): number {
  // Composite: role relevance is primary (×100), seniority breaks ties
  return roleScore(title) * 100 + seniorityScore(title);
}

interface ZIContact {
  id?: string | number;
  firstName?: string;
  lastName?: string;
  jobTitle?: string;
}

async function fetchTopContact(token: string, companyName: string): Promise<{ name?: string; title?: string; ziId?: string } | null> {
  try {
    const res = await fetch(`${BASE}/gtm/data/v1/contacts/search`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/vnd.api+json',
        'Accept':       'application/vnd.api+json',
        'Authorization': `Bearer ${token}`,
        'User-Agent':   USER_AGENT,
      },
      body: JSON.stringify({
        data: {
          type: 'ContactSearch',
          attributes: { companyName },
        },
      }),
    });

    if (!res.ok) return null;

    const data = await res.json();
    const contacts: ZIContact[] = (data.data ?? []).map((item: { id?: string | number; attributes?: ZIContact }) => ({
      id:        item.id,
      firstName: item.attributes?.firstName,
      lastName:  item.attributes?.lastName,
      jobTitle:  item.attributes?.jobTitle,
    }));

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
    const results = await Promise.all(batch.map((lead) => fetchTopContact(token, lead.company)));

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
