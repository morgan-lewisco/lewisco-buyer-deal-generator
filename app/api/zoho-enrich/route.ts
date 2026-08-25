import { NextRequest, NextResponse } from 'next/server';

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
    method: 'POST',
    signal: AbortSignal.timeout(10_000),
  });
  const data = await res.json();
  if (!data.access_token) throw new Error(`Token exchange failed: ${JSON.stringify(data)}`);
  _cachedToken = { token: data.access_token, expiresAt: Date.now() + (data.expires_in ?? 3600) * 1000 };
  return _cachedToken.token;
}

function pickStr(v: unknown): string {
  if (!v) return '';
  if (typeof v === 'string') return v.trim();
  if (typeof v === 'object' && v !== null && 'name' in v)
    return String((v as Record<string, unknown>).name).trim();
  return '';
}

// Words stripped when building core tokens for comparison and search
const STOP_WORDS = new Set([
  // articles / prepositions (causes "The Simply Good Foods" to not match "Simply Good Foods")
  'the', 'a', 'an', 'of', 'and',
  // corporate suffixes
  'inc', 'co', 'corp', 'llc', 'ltd', 'lp', 'plc',
  'company', 'corporation', 'incorporated', 'limited',
  'foods', 'food', 'baking', 'brands', 'brand', 'group',
  'international', 'industries', 'industry', 'products',
  'enterprises', 'holdings', 'solutions', 'services',
  'farms', 'distribution', 'distributing', 'wholesale',
  'natural', 'nutrition', 'health', 'wellness',
]);

function rawTokens(name: string): string[] {
  return name
    .toLowerCase()
    .replace(/['''''`´]s\b/g, '')   // strip possessive 's as a unit: "Schwebel's" → "Schwebel"
    .replace(/['''''`´]/g, '')      // strip any remaining apostrophes
    .replace(/[^a-z0-9\s]/g, ' ')
    .split(/\s+/)
    .filter((t) => t.length > 0);
}

/** First non-suffix token — used as the Zoho search term */
/** Core tokens: strip all stop words (articles + corp suffixes) */
function coreTokens(name: string): string[] {
  const tokens = rawTokens(name).filter((t) => !STOP_WORDS.has(t));
  return tokens.length > 0 ? tokens : rawTokens(name);
}

/** First meaningful token — used as the Zoho search term */
function searchToken(name: string): string {
  return coreTokens(name)[0] ?? '';
}

/** Score how well a Zoho vendor name matches the lead company name (higher = better) */
function matchScore(lead: string, zohoName: string): number {
  // Exact raw token match
  if (rawTokens(lead).join(' ') === rawTokens(zohoName).join(' ')) return 100;

  // Same core tokens after stripping stop words
  // "The Simply Good Foods Company" ↔ "Simply Good Foods" → both → "simply good" → score 90
  // "Tyson Foods" ↔ "Tyson" → both → "tyson" → score 90
  const lc = coreTokens(lead);
  const zc = coreTokens(zohoName);
  if (lc.length && zc.length && lc.join(' ') === zc.join(' ')) return 90;

  // One core is a prefix of the other
  const ls = lc.join(' ');
  const zs = zc.join(' ');
  if (ls && zs && (ls.startsWith(zs + ' ') || zs.startsWith(ls + ' '))) return 85;

  return 0;
}

export interface ZohoMatch {
  found: boolean;
  boughtManager: string;
  vendorOriginatorByName: string;
}

// Search Zoho for a single company; returns null if not found
async function searchVendor(
  token: string,
  company: string,
): Promise<{ boughtManager: string; vendorOriginatorByName: string } | null> {
  const term = searchToken(company);
  if (!term || term.length < 2) return null;

  // Build URL manually — URLSearchParams encodes ( ) : which Zoho requires as raw chars
  const url = `https://www.zohoapis.com/crm/v3/Vendors/search` +
    `?criteria=(Vendor_Name:contains:${encodeURIComponent(term)})` +
    `&fields=Vendor_Name,Vendor_DBA,Vendor_manager,Vendor_Originator_By_Name` +
    `&per_page=10`;

  const res = await fetch(url, {
    headers: { Authorization: `Zoho-oauthtoken ${token}` },
    signal: AbortSignal.timeout(8_000),
  });

  if (res.status === 204) return null; // no results
  if (!res.ok) {
    const body = await res.text();
    console.warn('[zoho-enrich] search failed for', company, '| term:', term, '| status:', res.status, '| body:', body);
    return null;
  }

  const data = await res.json();
  const candidates: Array<Record<string, unknown>> = data.data ?? [];
  if (!candidates.length) return null;

  // Score each candidate against the lead company name
  // Also split on "/" (DBA entries) to check all name variants
  let best: { score: number; record: Record<string, unknown> } | null = null;

  for (const record of candidates) {
    const vendorName = String(record['Vendor_Name'] ?? '');
    const vendorDBA  = String(record['Vendor_DBA']  ?? '');

    // All name variants this record represents
    const nameVariants = [vendorName, vendorDBA]
      .flatMap((n) => n.split('/').map((s) => s.trim()))
      .filter(Boolean);

    const score = Math.max(...nameVariants.map((n) => matchScore(company, n)));

    if (score > 0 && (!best || score > best.score)) {
      best = { score, record };
    }
  }

  if (!best || best.score < 80) return null;

  return {
    boughtManager:          pickStr(best.record['Vendor_manager'])             || 'None',
    vendorOriginatorByName: pickStr(best.record['Vendor_Originator_By_Name'])  || 'None',
  };
}

// Run at most `limit` promises concurrently
async function pMap<T, R>(
  items: T[],
  fn: (item: T) => Promise<R>,
  limit: number,
): Promise<R[]> {
  const results: R[] = new Array(items.length);
  let idx = 0;
  async function worker() {
    while (idx < items.length) {
      const i = idx++;
      results[i] = await fn(items[i]);
    }
  }
  await Promise.all(Array.from({ length: Math.min(limit, items.length) }, worker));
  return results;
}

export async function POST(req: NextRequest) {
  try {
    const { companies }: { companies: string[] } = await req.json();
    if (!companies?.length) return NextResponse.json({});

    const token = await getToken();
    const unique = [...new Set(companies)];

    // Search Zoho for each company, up to 8 concurrent requests
    const matches = await pMap(unique, (company) => searchVendor(token, company), 8);

    const result: Record<string, ZohoMatch> = {};
    unique.forEach((company, i) => {
      const m = matches[i];
      result[company] = m
        ? { found: true, ...m }
        : { found: false, boughtManager: '', vendorOriginatorByName: '' };
    });

    console.log(`[zoho-enrich] ${unique.length} companies → ${matches.filter(Boolean).length} matched`);
    return NextResponse.json(result);
  } catch (err) {
    console.error('[zoho-enrich]', err);
    return NextResponse.json({ error: String(err) }, { status: 500 });
  }
}
