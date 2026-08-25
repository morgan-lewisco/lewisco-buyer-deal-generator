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

const CORP_SUFFIXES = new Set([
  'inc', 'co', 'corp', 'llc', 'ltd', 'lp', 'plc',
  'company', 'corporation', 'incorporated', 'limited',
  'foods', 'food', 'baking', 'brands', 'brand', 'group',
  'international', 'industries', 'industry', 'products',
  'enterprises', 'holdings', 'solutions', 'services',
  'farms', 'distribution', 'distributing', 'wholesale',
]);

/** Lowercase + strip ALL apostrophes + strip non-alphanumeric → plain word tokens */
function rawTokens(name: string): string[] {
  return name
    .toLowerCase()
    .replace(/['''‘’`´]/g, '')   // strip all apostrophe variants entirely
    .replace(/[^a-z0-9\s]/g, ' ')
    .split(/\s+/)
    .filter((t) => t.length > 0);
}

/** Tokens with corp suffixes removed */
function coreTokens(name: string): string[] {
  const tokens = rawTokens(name).filter((t) => !CORP_SUFFIXES.has(t));
  return tokens.length > 0 ? tokens : rawTokens(name); // fallback: keep all if everything stripped
}

/** First meaningful (non-suffix) token, min length check done at call site */
function firstToken(name: string): string {
  return coreTokens(name)[0] ?? '';
}

/** Core key: strip corp suffixes from both ends, join remaining tokens */
function coreKey(name: string): string {
  const tokens = rawTokens(name);
  // strip from end
  while (tokens.length > 1 && CORP_SUFFIXES.has(tokens[tokens.length - 1])) tokens.pop();
  // strip from start
  while (tokens.length > 1 && CORP_SUFFIXES.has(tokens[0])) tokens.shift();
  return tokens.join(' ');
}

export interface ZohoMatch {
  found: boolean;
  boughtManager: string;
  vendorOriginatorByName: string;
  matchType?: 'exact' | 'core' | 'first-word';
}

export async function POST(req: NextRequest) {
  try {
    const { companies }: { companies: string[] } = await req.json();
    if (!companies?.length) return NextResponse.json({});

    const token = await getToken();

    type VendorRow = { boughtManager: string; vendorOriginatorByName: string };

    const exactMap    = new Map<string, VendorRow>(); // normalized exact name
    const coreMap     = new Map<string, VendorRow>(); // suffix-stripped core name
    const firstWordMap = new Map<string, VendorRow>(); // first meaningful token

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

        // Split on "/" and "DBA" to index each name variant separately
        const variants = raw
          .split(/\s*\/\s*|\bDBA\b/i)
          .map((s) => s.trim())
          .filter(Boolean);

        for (const variant of variants) {
          // Pass 1 index — exact normalized
          exactMap.set(rawTokens(variant).join(' '), row);

          // Pass 2 index — core (suffixes stripped from both ends)
          const ck = coreKey(variant);
          if (ck && !coreMap.has(ck)) coreMap.set(ck, row);

          // Pass 3 index — first meaningful token (min 4 chars, first writer wins)
          const fw = firstToken(variant);
          if (fw.length >= 4 && !firstWordMap.has(fw)) firstWordMap.set(fw, row);
        }
      }

      if (vendors.length < 200) break;
    }

    console.log(`[zoho-enrich] ${exactMap.size} exact / ${coreMap.size} core / ${firstWordMap.size} first-word keys`);

    const result: Record<string, ZohoMatch> = {};

    for (const company of companies) {
      let match: VendorRow | undefined;
      let matchType: ZohoMatch['matchType'];

      // Pass 1 — exact
      match = exactMap.get(rawTokens(company).join(' '));
      if (match) matchType = 'exact';

      // Pass 2 — core name (handles "Tyson Foods" ↔ "Tyson", "Franklin Foods" ↔ "Franklin Foods Co")
      if (!match) {
        const ck = coreKey(company);
        match = coreMap.get(ck);
        if (match) matchType = 'core';
      }

      // Pass 3 — first meaningful token (handles possessive/shorthand variants)
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
