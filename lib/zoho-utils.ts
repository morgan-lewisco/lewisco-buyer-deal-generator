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

export const VENDOR_CACHE_KEY = 'bdg:zoho-vendor-names-v4';
export const VENDOR_CACHE_TTL = 60 * 60 * 2; // 2 hours

export type VendorStub = { id: string; name: string };

export async function fetchOnePage(token: string, page: number): Promise<VendorStub[]> {
  const res = await fetch(
    `https://www.zohoapis.com/crm/v3/Vendors?fields=Vendor_Name&per_page=200&page=${page}`,
    { headers: { Authorization: `Zoho-oauthtoken ${token}` }, signal: AbortSignal.timeout(12_000) },
  );
  if (!res.ok) {
    console.warn(`[zoho] page ${page} failed: ${res.status}`);
    return [];
  }
  const data = await res.json();
  if (page === 1 && data.data?.[0]) {
    console.log(`[zoho] page 1 sample keys: ${Object.keys(data.data[0]).join(', ')}`);
  }
  // Zoho may return the vendor name under Vendor_Name or Name depending on context
  return (data.data ?? []).map((v: Record<string, unknown>) => ({
    id:   String(v.id ?? ''),
    name: String(v.Vendor_Name ?? v['Vendor Name'] ?? v.Name ?? v.name ?? '').trim(),
  })).filter((v: VendorStub) => v.id && v.name);
}

export async function getVendorIndex(token: string): Promise<VendorStub[]> {
  const cached = await kv.get<VendorStub[]>(VENDOR_CACHE_KEY);
  if (cached?.length) {
    console.log(`[zoho] vendor cache hit: ${cached.length} vendors`);
    return cached;
  }
  console.log('[zoho] cache miss — fetching vendor index');
  const all: VendorStub[] = [];
  let page = 1;
  while (page <= 100) {
    const batch = await Promise.all(
      [0, 1, 2, 3, 4].map((i) => fetchOnePage(token, page + i)),
    );
    let done = false;
    for (const page_results of batch) {
      all.push(...page_results);
      if (page_results.length < 200) { done = true; break; }
    }
    page += 5;
    if (done) break;
  }
  console.log(`[zoho] fetched ${all.length} vendors — caching`);
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
