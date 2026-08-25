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

const CORP_SUFFIXES = new Set([
  'inc', 'co', 'corp', 'llc', 'ltd', 'lp', 'plc',
  'company', 'corporation', 'incorporated', 'limited',
  'foods', 'food', 'baking', 'brands', 'brand', 'group',
  'international', 'industries', 'industry', 'products',
  'enterprises', 'holdings', 'solutions', 'services',
  'farms', 'distribution', 'distributing', 'wholesale',
]);

function rawTokens(name: string): string[] {
  return name
    .toLowerCase()
    .replace(/['''''`´]/g, '')
    .replace(/[^a-z0-9\s]/g, ' ')
    .split(/\s+/)
    .filter((t) => t.length > 0);
}

function coreKey(name: string): string {
  const tokens = rawTokens(name);
  while (tokens.length > 1 && CORP_SUFFIXES.has(tokens[tokens.length - 1])) tokens.pop();
  while (tokens.length > 1 && CORP_SUFFIXES.has(tokens[0])) tokens.shift();
  return tokens.join(' ');
}

function firstToken(name: string): string {
  const tokens = rawTokens(name).filter((t) => !CORP_SUFFIXES.has(t));
  return (tokens.length > 0 ? tokens : rawTokens(name))[0] ?? '';
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

    // ── Phase 1: bulk-fetch vendor names + IDs only ──────────────────────────
    // We deliberately avoid custom field names here — Zoho returns a 400 if
    // an unknown field is requested, which would silently break pagination.
    type VendorStub = { id: string };
    const exactMap     = new Map<string, VendorStub>();
    const coreMap      = new Map<string, VendorStub>();
    const firstWordMap = new Map<string, VendorStub>();

    for (let page = 1; page <= 10; page++) {
      const params = new URLSearchParams({
        fields: 'Vendor_Name',
        per_page: '200',
        page: String(page),
      });
      const res = await fetch(`https://www.zohoapis.com/crm/v3/Vendors?${params}`, {
        headers: { Authorization: `Zoho-oauthtoken ${token}` },
        signal: AbortSignal.timeout(15_000),
      });
      if (!res.ok) {
        const body = await res.text();
        console.warn('[zoho-enrich] phase1 failed:', res.status, body);
        break;
      }
      const data = await res.json();
      const vendors: Array<Record<string, unknown>> = data.data ?? [];

      for (const v of vendors) {
        const raw = String(v.Vendor_Name ?? '').trim();
        const id  = String(v.id ?? '');
        if (!raw || !id) continue;

        // Split on "/" and "DBA" — index each variant
        const variants = raw.split(/\s*\/\s*|\bDBA\b/i).map((s) => s.trim()).filter(Boolean);

        for (const variant of variants) {
          const stub: VendorStub = { id };

          exactMap.set(rawTokens(variant).join(' '), stub);

          const ck = coreKey(variant);
          if (ck && !coreMap.has(ck)) coreMap.set(ck, stub);

          const fw = firstToken(variant);
          if (fw.length >= 4 && !firstWordMap.has(fw)) firstWordMap.set(fw, stub);
        }
      }

      console.log(`[zoho-enrich] page ${page}: ${vendors.length} vendors`);
      if (vendors.length < 200) break;
    }

    console.log(`[zoho-enrich] indexed: ${exactMap.size} exact / ${coreMap.size} core / ${firstWordMap.size} first-word`);

    // ── Phase 2: match each company, collect unique vendor IDs ───────────────
    type MatchInfo = { vendorId: string; matchType: ZohoMatch['matchType'] };
    const matchMap = new Map<string, MatchInfo>(); // company → match info

    for (const company of companies) {
      let stub: VendorStub | undefined;
      let matchType: ZohoMatch['matchType'];

      stub = exactMap.get(rawTokens(company).join(' '));
      if (stub) matchType = 'exact';

      if (!stub) {
        stub = coreMap.get(coreKey(company));
        if (stub) matchType = 'core';
      }

      if (!stub) {
        const fw = firstToken(company);
        if (fw.length >= 4) {
          stub = firstWordMap.get(fw);
          if (stub) matchType = 'first-word';
        }
      }

      if (stub) matchMap.set(company, { vendorId: stub.id, matchType });
    }

    // ── Phase 3: fetch full records for matched vendor IDs ───────────────────
    // Fetch without specifying fields so Zoho returns everything it has access
    // to, including custom fields — no guessing about API names required.
    const uniqueIds = [...new Set([...matchMap.values()].map((m) => m.vendorId))];
    const detailMap = new Map<string, Record<string, unknown>>(); // id → full record

    await Promise.all(
      uniqueIds.map(async (id) => {
        try {
          const res = await fetch(`https://www.zohoapis.com/crm/v3/Vendors/${id}`, {
            headers: { Authorization: `Zoho-oauthtoken ${token}` },
            signal: AbortSignal.timeout(10_000),
          });
          if (!res.ok) {
            console.warn('[zoho-enrich] detail fetch failed for', id, res.status);
            return;
          }
          const data = await res.json();
          const record = data.data?.[0] ?? data;
          detailMap.set(id, record);
          // Log all field keys once so we can confirm the right names
          console.log('[zoho-enrich] vendor fields:', Object.keys(record).join(', '));
        } catch (e) {
          console.warn('[zoho-enrich] detail fetch error for', id, e);
        }
      })
    );

    // ── Build result ─────────────────────────────────────────────────────────
    const result: Record<string, ZohoMatch> = {};

    for (const company of companies) {
      const info = matchMap.get(company);
      if (!info) {
        result[company] = { found: false, boughtManager: '', vendorOriginatorByName: '' };
        continue;
      }

      const record = detailMap.get(info.vendorId) ?? {};

      // Try likely API names for "Bought Manager" custom field
      const boughtManager = pickStr(
        record['Bought_Manager'] ??
        record['Bought_Manager1'] ??
        record['Bought Manager'] ??
        record['bought_manager'] ??
        null
      );

      // Try likely API names for "Vendor Originator By Name" custom field
      const vendorOriginatorByName = pickStr(
        record['Vendor_Originator_By_Name'] ??
        record['Vendor_Originator_By_Name1'] ??
        record['Vendor Originator By Name'] ??
        record['vendor_originator_by_name'] ??
        null
      );

      result[company] = {
        found: true,
        boughtManager:          boughtManager          || 'None',
        vendorOriginatorByName: vendorOriginatorByName || 'None',
        matchType: info.matchType,
      };
    }

    return NextResponse.json(result);
  } catch (err) {
    console.error('[zoho-enrich]', err);
    return NextResponse.json({ error: String(err) }, { status: 500 });
  }
}
