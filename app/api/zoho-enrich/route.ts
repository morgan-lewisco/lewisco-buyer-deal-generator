import { NextRequest, NextResponse } from 'next/server';
import { kv } from '@vercel/kv';

// ── Auth ─────────────────────────────────────────────────────────────────────

let _cachedToken: { token: string; expiresAt: number } | null = null;

async function getToken(): Promise<string> {
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

const STOP_WORDS = new Set([
  'the', 'a', 'an', 'of', 'and',
  'inc', 'co', 'corp', 'llc', 'ltd', 'lp', 'plc',
  'company', 'corporation', 'incorporated', 'limited',
  'foods', 'food', 'baking', 'brands', 'brand', 'group',
  'international', 'industries', 'industry', 'products',
  'enterprises', 'holdings', 'solutions', 'services',
  'farms', 'distribution', 'distributing', 'wholesale',
  // NOTE: natural/nutrition/health/wellness intentionally NOT here —
  // they appear in actual brand names (e.g. "Natural Balance") and stripping
  // them causes false negatives.
]);

function rawTokens(name: string): string[] {
  return name
    .toLowerCase()
    .replace(/['''''`´]s\b/g, '')  // "Schwebel's" → "Schwebel"
    .replace(/['''''`´]/g, '')
    .replace(/[^a-z0-9\s]/g, ' ')
    .split(/\s+/)
    .filter(Boolean);
}

function coreTokens(name: string): string[] {
  const t = rawTokens(name).filter((w) => !STOP_WORDS.has(w));
  return t.length ? t : rawTokens(name);
}

function matchScore(lead: string, zohoName: string): number {
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

// ── Vendor index (KV-cached, refreshed every 2 h) ────────────────────────────

const VENDOR_CACHE_KEY = 'bdg:zoho-vendor-names-v3';
const VENDOR_CACHE_TTL = 60 * 60 * 2; // 2 hours

type VendorStub = { id: string; name: string };

async function fetchOnePage(token: string, page: number): Promise<VendorStub[]> {
  const res = await fetch(
    `https://www.zohoapis.com/crm/v3/Vendors?fields=Vendor_Name&per_page=200&page=${page}`,
    { headers: { Authorization: `Zoho-oauthtoken ${token}` }, signal: AbortSignal.timeout(12_000) },
  );
  if (!res.ok) return [];
  const data = await res.json();
  return (data.data ?? []).map((v: Record<string, unknown>) => ({
    id:   String(v.id ?? ''),
    name: String(v.Vendor_Name ?? '').trim(),
  })).filter((v: VendorStub) => v.id && v.name);
}

async function getVendorIndex(token: string): Promise<VendorStub[]> {
  // Try cache first
  const cached = await kv.get<VendorStub[]>(VENDOR_CACHE_KEY);
  if (cached?.length) {
    console.log(`[zoho-enrich] vendor cache hit: ${cached.length} vendors`);
    return cached;
  }

  // Fetch all pages in parallel batches of 5 to stay well within timeout
  console.log('[zoho-enrich] cache miss — fetching vendor index');
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

  console.log(`[zoho-enrich] fetched ${all.length} vendors — caching`);
  await kv.set(VENDOR_CACHE_KEY, all, { ex: VENDOR_CACHE_TTL });
  return all;
}

// ── Field extraction ──────────────────────────────────────────────────────────

function pickStr(v: unknown): string {
  if (!v) return '';
  if (typeof v === 'string') return v.trim();
  if (typeof v === 'object' && v !== null && 'name' in v)
    return String((v as Record<string, unknown>).name).trim();
  return '';
}

async function fetchVendorFields(
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

async function pMap<T, R>(items: T[], fn: (x: T) => Promise<R>, limit: number): Promise<R[]> {
  const results: R[] = new Array(items.length);
  let idx = 0;
  const worker = async () => { while (idx < items.length) { const i = idx++; results[i] = await fn(items[i]); } };
  await Promise.all(Array.from({ length: Math.min(limit, items.length) }, worker));
  return results;
}

// ── Main handler ─────────────────────────────────────────────────────────────

export interface ZohoMatch {
  found: boolean;
  boughtManager: string;
  vendorOriginatorByName: string;
}

export async function POST(req: NextRequest) {
  try {
    const { companies }: { companies: string[] } = await req.json();
    if (!companies?.length) return NextResponse.json({});

    const token  = await getToken();
    const stubs  = await getVendorIndex(token);

    // Build index — each Zoho name may have "/" variants
    type Entry = { id: string; name: string; variants: string[] };
    const entries: Entry[] = stubs.map(({ id, name }) => ({
      id,
      name,
      variants: name.split(/\s*\/\s*|\bDBA\b/i).map((s) => s.trim()).filter(Boolean),
    }));

    // Match each company
    const matchedIds = new Map<string, string>(); // company → vendor id
    for (const company of companies) {
      let best = { score: 0, id: '', name: '' };
      for (const { id, variants, name: zohoName } of entries) {
        const score = Math.max(...variants.map((v) => matchScore(company, v)));
        if (score > best.score) best = { score, id, name: zohoName };
      }
      if (best.score >= 70) {
        matchedIds.set(company, best.id);
        console.log(`[zoho-enrich] MATCH  "${company}" → "${best.name}" (score ${best.score})`);
      } else {
        console.log(`[zoho-enrich] MISS   "${company}" — best score ${best.score} vs "${best.name}"`);
      }
    }

    console.log(`[zoho-enrich] ${companies.length} companies → ${matchedIds.size} matched`);

    // Fetch custom fields for unique matched IDs (parallel, limit 8)
    const uniqueIds = [...new Set(matchedIds.values())];
    const fieldResults = await pMap(uniqueIds, (id) => fetchVendorFields(token, id), 8);
    const fieldMap = new Map(uniqueIds.map((id, i) => [id, fieldResults[i]]));

    // Build response
    const result: Record<string, ZohoMatch> = {};
    for (const company of companies) {
      const id = matchedIds.get(company);
      if (id) {
        const fields = fieldMap.get(id)!;
        result[company] = { found: true, ...fields };
      } else {
        result[company] = { found: false, boughtManager: '', vendorOriginatorByName: '' };
      }
    }

    return NextResponse.json(result);
  } catch (err) {
    console.error('[zoho-enrich]', err);
    return NextResponse.json({ error: String(err) }, { status: 500 });
  }
}
