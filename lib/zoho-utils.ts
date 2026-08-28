import { kv } from '@vercel/kv';

// ── Auth ─────────────────────────────────────────────────────────────────────

let _cachedToken: { token: string; expiresAt: number } | null = null;

export async function getZohoToken(): Promise<string> {
  if (_cachedToken && _cachedToken.expiresAt > Date.now() + 60_000) return _cachedToken.token;
  const { ZOHO_CLIENT_ID, ZOHO_CLIENT_SECRET, ZOHO_REFRESH_TOKEN } = process.env;
  if (!ZOHO_CLIENT_ID || !ZOHO_CLIENT_SECRET || !ZOHO_REFRESH_TOKEN) throw new Error('Zoho not configured');
  const params = new URLSearchParams({
    grant_type: 'refresh_token',
    client_id: ZOHO_CLIENT_ID,
    client_secret: ZOHO_CLIENT_SECRET,
    refresh_token: ZOHO_REFRESH_TOKEN,
  });
  const res = await fetch(`https://accounts.zoho.com/oauth/v2/token?${params}`, {
    method: 'POST', signal: AbortSignal.timeout(10_000),
  });
  const data = await res.json();
  if (!data.access_token) throw new Error(`Token failed: ${JSON.stringify(data)}`);
  _cachedToken = { token: data.access_token, expiresAt: Date.now() + (data.expires_in ?? 3600) * 1000 };
  return _cachedToken.token;
}

// ── Name normalisation ────────────────────────────────────────────────────────

export const STOP_WORDS = new Set([
  'the', 'a', 'an', 'of', 'and',
  'inc', 'co', 'corp', 'llc', 'ltd', 'lp', 'plc',
  'company', 'corporation', 'incorporated', 'limited',
  'foods', 'food', 'baking', 'brands', 'brand', 'group',
  'international', 'industries', 'industry', 'products',
  'enterprises', 'holdings', 'solutions', 'services',
  'farms', 'distribution', 'distributing', 'wholesale',
  // natural/nutrition/health/wellness intentionally excluded —
  // they appear in actual brand names and stripping them causes false negatives.
]);

export function rawTokens(name: string): string[] {
  return name
    .toLowerCase()
    .replace(/['''''`´]s\b/g, '')  // "Schwebel's" → "Schwebel"
    .replace(/['''''`´]/g, '')
    .replace(/[^a-z0-9\s]/g, ' ')
    .split(/\s+/)
    .filter(Boolean);
}

export function coreTokens(name: string): string[] {
  const t = rawTokens(name).filter((w) => !STOP_WORDS.has(w));
  return t.length ? t : rawTokens(name);
}

export function matchScore(lead: string, zohoName: string): number {
  if (rawTokens(lead).join(' ') === rawTokens(zohoName).join(' ')) return 100;
  const lTokens = coreTokens(lead);
  const zTokens = coreTokens(zohoName);
  const lc = lTokens.join(' ');
  const zc = zTokens.join(' ');
  if (lc && zc && lc === zc) return 90;
  if (lc && zc && (lc.startsWith(zc + ' ') || zc.startsWith(lc + ' '))) return 85;
  // Distinctive first-token match — only accept tokens ≥5 chars to avoid
  // false positives on short/generic words like "us", "big", "top"
  const lf = lTokens[0] ?? '';
  const zf = zTokens[0] ?? '';
  if (lf.length >= 5 && lf === zf) return 70;
  return 0;
}

// ── Vendor index (KV-cached) ──────────────────────────────────────────────────

export const VENDOR_CACHE_KEY = 'bdg:zoho-vendor-names-v8';
export const VENDOR_CACHE_TTL = 60 * 60 * 2; // 2 hours

export type VendorStub = { id: string; name: string };

function extractVendorName(v: Record<string, unknown>): string {
  // Try every key Zoho has ever returned for the vendor name field
  const raw = v.Vendor_Name ?? v['Vendor Name'] ?? v.Name ?? v.name;
  if (!raw) return '';
  if (typeof raw === 'string') return raw.trim();
  // Some lookup fields come back as { id, name }
  if (typeof raw === 'object' && raw !== null && 'name' in raw)
    return String((raw as Record<string, unknown>).name).trim();
  return String(raw).trim();
}

// Fetch one batch via COQL (bypasses the 2000-record page limit of the list endpoint)
export async function fetchOnePageCOQL(token: string, offset: number): Promise<{ stubs: VendorStub[]; more: boolean }> {
  const query = `select id, Vendor_Name from Vendors limit 200 offset ${offset}`;
  const res = await fetch(
    'https://www.zohoapis.com/crm/v3/coql',
    {
      method: 'POST',
      headers: { Authorization: `Zoho-oauthtoken ${token}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ select_query: query }),
      signal: AbortSignal.timeout(12_000),
    },
  );
  if (!res.ok) {
    const text = await res.text().catch(() => '');
    console.warn(`[zoho] COQL offset ${offset} failed: ${res.status} — ${text.slice(0, 200)}`);
    return { stubs: [], more: false };
  }
  const data = await res.json();
  if (offset === 0 && data.data?.[0]) {
    console.log(`[zoho] COQL sample keys: ${Object.keys(data.data[0]).join(', ')}`);
    console.log(`[zoho] COQL first record: ${JSON.stringify(data.data[0])}`);
  }
  const stubs = (data.data ?? []).map((v: Record<string, unknown>) => ({
    id:   String(v.id ?? ''),
    name: extractVendorName(v),
  })).filter((v: VendorStub) => v.id && v.name);
  const more: boolean = data.info?.more_records === true;
  return { stubs, more };
}

// Kept for the debug endpoint — plain list-API fetch, subject to the 2000-record cap
export async function fetchOnePage(token: string, page: number): Promise<VendorStub[]> {
  const res = await fetch(
    `https://www.zohoapis.com/crm/v3/Vendors?fields=id,Vendor_Name,Name&per_page=200&page=${page}`,
    { headers: { Authorization: `Zoho-oauthtoken ${token}` }, signal: AbortSignal.timeout(12_000) },
  );
  if (!res.ok) return [];
  const data = await res.json();
  return (data.data ?? []).map((v: Record<string, unknown>) => ({
    id:   String(v.id ?? ''),
    name: extractVendorName(v),
  })).filter((v: VendorStub) => v.id && v.name);
}

// Fetch all vendors starting with a given prefix via the search API.
// The search endpoint does NOT have the list API's 10-page/2000-record hard cap.
async function fetchByPrefix(token: string, prefix: string): Promise<VendorStub[]> {
  const all: VendorStub[] = [];
  // 2 pages × 200 = 400 vendors per prefix — more than enough per letter for any realistic vendor list.
  // Keeping this tight ensures the full 36-prefix rebuild completes well within Vercel's 60s timeout.
  for (let page = 1; page <= 2; page++) {
    const criteria = encodeURIComponent(`(Vendor_Name:starts_with:${prefix})`);
    const res = await fetch(
      `https://www.zohoapis.com/crm/v3/Vendors/search?criteria=${criteria}&fields=id,Vendor_Name&per_page=200&page=${page}`,
      { headers: { Authorization: `Zoho-oauthtoken ${token}` }, signal: AbortSignal.timeout(10_000) },
    );
    if (!res.ok) break;
    const data = await res.json();
    const records = (data.data ?? []).map((v: Record<string, unknown>) => ({
      id:   String(v.id ?? ''),
      name: extractVendorName(v),
    })).filter((v: VendorStub) => v.id && v.name);
    all.push(...records);
    if (!data.info?.more_records) break;
  }
  return all;
}

export async function getVendorIndex(token: string): Promise<VendorStub[]> {
  const cached = await kv.get<VendorStub[]>(VENDOR_CACHE_KEY);
  if (cached?.length) {
    console.log(`[zoho] vendor cache hit: ${cached.length} vendors`);
    return cached;
  }

  // Alphabetical prefix search — bypasses the 2000-record list-API cap.
  // Runs 36 prefix queries (0-9 + A-Z) in parallel batches of 6.
  console.log('[zoho] cache miss — rebuilding vendor index via alphabetical search');
  const prefixes = '0123456789ABCDEFGHIJKLMNOPQRSTUVWXYZ'.split('');
  const prefixResults = await pMap(prefixes, (p) => fetchByPrefix(token, p), 12);

  // Deduplicate by ID (a vendor starting with "Co" hits both prefix scans if names overlap)
  const byId = new Map<string, VendorStub>();
  for (const batch of prefixResults) {
    for (const stub of batch) byId.set(stub.id, stub);
  }
  const all = [...byId.values()];

  console.log(`[zoho] fetched ${all.length} vendors across ${prefixes.length} prefix queries — caching`);
  if (all.length > 0) {
    console.log(`[zoho] sample names: ${all.slice(0, 5).map((v) => `"${v.name}"`).join(', ')}`);
  }
  await kv.set(VENDOR_CACHE_KEY, all, { ex: VENDOR_CACHE_TTL });
  return all;
}

// ── Field extraction ──────────────────────────────────────────────────────────

export function pickStr(v: unknown): string {
  if (!v) return '';
  if (typeof v === 'string') return v.trim();
  if (typeof v === 'object' && v !== null && 'name' in v)
    return String((v as Record<string, unknown>).name).trim();
  return '';
}

export async function fetchVendorFields(
  token: string,
  id: string,
): Promise<{ boughtManager: string; vendorOriginatorByName: string }> {
  const res = await fetch(`https://www.zohoapis.com/crm/v3/Vendors/${id}`, {
    headers: { Authorization: `Zoho-oauthtoken ${token}` },
    signal: AbortSignal.timeout(8_000),
  });
  if (!res.ok) return { boughtManager: 'None', vendorOriginatorByName: 'None' };
  const data = await res.json();
  const r: Record<string, unknown> = data.data?.[0] ?? data;
  return {
    boughtManager:          pickStr(r['Vendor_manager'])            || 'None',
    vendorOriginatorByName: pickStr(r['Vendor_Originator_By_Name']) || 'None',
  };
}

// ── Concurrency helper ────────────────────────────────────────────────────────

export async function pMap<T, R>(items: T[], fn: (x: T) => Promise<R>, limit: number): Promise<R[]> {
  const results: R[] = new Array(items.length);
  let idx = 0;
  const worker = async () => { while (idx < items.length) { const i = idx++; results[i] = await fn(items[i]); } };
  await Promise.all(Array.from({ length: Math.min(limit, items.length) }, worker));
  return results;
}

// ── Direct Zoho search (bypasses local index) ─────────────────────────────────

export async function searchVendorDirect(
  token: string,
  company: string,
): Promise<VendorStub | null> {
  // 1. Exact Vendor_Name match via criteria search
  try {
    const criteria = encodeURIComponent(`(Vendor_Name:equals:${company})`);
    const res = await fetch(
      `https://www.zohoapis.com/crm/v3/Vendors/search?criteria=${criteria}&fields=id,Vendor_Name,Name`,
      { headers: { Authorization: `Zoho-oauthtoken ${token}` }, signal: AbortSignal.timeout(6_000) },
    );
    if (res.ok) {
      const data = await res.json();
      const r: Record<string, unknown> = data.data?.[0];
      if (r?.id) return { id: String(r.id), name: extractVendorName(r) || company };
    }
  } catch { /* timeout or network — continue */ }

  // 2. Word search fallback (partial name match)
  try {
    const word = encodeURIComponent(company);
    const res = await fetch(
      `https://www.zohoapis.com/crm/v3/Vendors/search?word=${word}&fields=id,Vendor_Name,Name`,
      { headers: { Authorization: `Zoho-oauthtoken ${token}` }, signal: AbortSignal.timeout(6_000) },
    );
    if (res.ok) {
      const data = await res.json();
      // Pick the first result that fuzzy-scores ≥60 to avoid false positives
      for (const raw of (data.data ?? []) as Record<string, unknown>[]) {
        if (!raw?.id) continue;
        const zohoName = extractVendorName(raw);
        if (matchScore(company, zohoName) >= 60) {
          return { id: String(raw.id), name: zohoName || company };
        }
      }
    }
  } catch { /* timeout or network */ }

  return null;
}

// ── Manual overrides (company → vendor ID) ────────────────────────────────────

export const OVERRIDES_KEY = 'bdg:zoho-overrides';

export async function getOverrides(): Promise<Record<string, string>> {
  return (await kv.get<Record<string, string>>(OVERRIDES_KEY)) ?? {};
}

export async function setOverride(company: string, vendorId: string): Promise<void> {
  const overrides = await getOverrides();
  overrides[company] = vendorId;
  await kv.set(OVERRIDES_KEY, overrides);
}

export async function removeOverride(company: string): Promise<void> {
  const overrides = await getOverrides();
  delete overrides[company];
  await kv.set(OVERRIDES_KEY, overrides);
}
