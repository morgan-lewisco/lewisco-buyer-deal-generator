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

export interface ZohoMatch {
  found: boolean;
  boughtManager: string;          // 'None' if field empty, '' if vendor not found
  vendorOriginatorByName: string; // same
}

export async function POST(req: NextRequest) {
  try {
    const { companies }: { companies: string[] } = await req.json();
    if (!companies?.length) return NextResponse.json({});

    const token = await getToken();

    // Fetch all vendors with both fields (up to 2000 records, 10 pages × 200)
    type VendorRow = { boughtManager: string; vendorOriginatorByName: string };
    const vendorMap = new Map<string, VendorRow>();

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
        const name = String(v.Vendor_Name ?? '').trim().toLowerCase();
        if (name) {
          vendorMap.set(name, {
            boughtManager:          pickStr(v.Bought_Manager),
            vendorOriginatorByName: pickStr(v.Vendor_Originator_By_Name),
          });
        }
      }
      if (vendors.length < 200) break;
    }

    console.log(`[zoho-enrich] ${vendorMap.size} vendors indexed`);

    // Match each requested company name
    const result: Record<string, ZohoMatch> = {};
    for (const company of companies) {
      const key = company.trim().toLowerCase();
      const match = vendorMap.get(key);
      if (match) {
        result[company] = {
          found: true,
          boughtManager:          match.boughtManager          || 'None',
          vendorOriginatorByName: match.vendorOriginatorByName || 'None',
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
