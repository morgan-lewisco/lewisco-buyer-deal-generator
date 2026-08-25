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
  if (typeof v === 'object' && v !== null && 'name' in v) return String((v as Record<string, unknown>).name).trim();
  return '';
}

// Corporate suffixes stripped before first-word comparison
const CORP_SUFFIXES = new Set([
  'inc', 'co', 'corp', 'llc', 'ltd', 'lp', 'plc',
  'company', 'corporation', 'incorporated', 'limited',
  'foods', 'food', 'baking', 'brands', 'brand', 'group',
  'international', 'industries', 'industry', 'products',
  'enterprises', 'holdings', 'solutions', 'services',
]);

/**
 * Normalize a vendor name for matching:
 *  - strip possessives ("Schwebel's" → "schwbels" ugh — actually strip the 's)
 *  - lowercase, remove punctuation
 *  - drop common corporate suffixes
 *  - return tokens
 */
function tokenize(name: string): string[] {
  return name
    .toLowerCase()
    // strip possessives: "Schwebel's" → "Schwebels", "Tyson's" → "Tysons"
    .replace(/['''‘’]s\b/g, '')
    // strip trailing possessive apostrophe without s: "Kelloggs'" → "Kelloggs"
    .replace(/['''‘’]$/g, '')
    // keep only letters, numbers, spaces
    .replace(/[^a-z0-9\s]/g, ' ')
    .split(/\s+/)
    .filter((t) => t.length > 0 && !CORP_SUFFIXES.has(t));
}

function firstToken(name: string): string {
  return tokenize(name)[0] ?? '';
}

export interface ZohoMatch {
  found: boolean;
  boughtManager: string;
  vendorOriginatorByName: string;
  matchType?: 'exact' | 'first-word'; // for debugging
}

export async function POST(req: NextRequest) {
  try {
    const { companies }: { companies: string[] } = await req.json();
    if (!companies?.length) return NextResponse.json({});

    const token = await getToken();

    type VendorRow = { boughtManager: string; vendorOriginatorByName: string };

    // Two indexes built while paginating:
    //  exactMap  — normalized full name → data
    //  firstWordMap — first meaningful token → data (first writer wins; prefer longer names)
    const exactMap     = new Map<string, VendorRow>();
    const firstWordMap = new Map<string, VendorRow>();

    for (let page = 1; page <= 10; page++) {
      const params = new URLSearchParams({
        fields: 'Vendor_Name,Bought_Manager,Vendor_Originator_By_Name',
        per_page: '200',
        page: String(page),
      });
      const res = await fetch(`https://www.zohoapis.com/crm/v3/Vendors?${params}`, {
        headers: { Authorization: `Zoho-oauthtoken ${token}` },
        signal: AbortSignal.timeout(15_000),
      });
      if (!res.ok) {
        console.warn('[zoho-enrich] Vendors query failed:', res.status, await res.text());
        break;
      }
      const data = await res.json();
      const vendors: Array<Record<string, unknown>> = data.data ?? [];

      for (const v of vendors) {
        const raw = String(v.Vendor_Name ?? '').trim();
        if (!raw) continue;

        const row: VendorRow = {
          boughtManager:          pickStr(v.Bought_Manager),
          vendorOriginatorByName: pickStr(v.Vendor_Originator_By_Name),
        };

        // Exact key: lowercased raw name
        exactMap.set(raw.toLowerCase(), row);

        // First-word key: first meaningful token (min 4 chars to avoid false positives)
        const fw = firstToken(raw);
        if (fw.length >= 4 && !firstWordMap.has(fw)) {
          firstWordMap.set(fw, row);
        }
      }

      if (vendors.length < 200) break;
    }

    console.log(`[zoho-enrich] ${exactMap.size} vendors indexed (${firstWordMap.size} first-word keys)`);

    const result: Record<string, ZohoMatch> = {};

    for (const company of companies) {
      // Pass 1 — exact match
      let match = exactMap.get(company.trim().toLowerCase());
      let matchType: 'exact' | 'first-word' | undefined = match ? 'exact' : undefined;

      // Pass 2 — first-word fallback (min 4 chars)
      if (!match) {
        const fw = firstToken(company);
        if (fw.length >= 4) {
          match = firstWordMap.get(fw);
          if (match) matchType = 'first-word';
        }
      }

      if (match) {
        result[company] = {
          found: true,
          boughtManager:          match.boughtManager          || 'None',
          vendorOriginatorByName: match.vendorOriginatorByName || 'None',
          matchType,
        };
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
