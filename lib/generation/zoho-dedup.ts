/**
 * Optional Zoho CRM deduplication layer.
 * Pulls Dewey's existing vendor list and returns normalised company names.
 * Fails gracefully — if Zoho is unreachable the engine continues without dedup.
 *
 * TODO: configure ZOHO_CLIENT_ID, ZOHO_CLIENT_SECRET, ZOHO_REFRESH_TOKEN in .env.local
 * to enable this layer. Until then it returns an empty set (no dedup).
 */

let _cachedToken: { token: string; expiresAt: number } | null = null;

async function getAccessToken(): Promise<string> {
  if (_cachedToken && _cachedToken.expiresAt > Date.now() + 60_000) {
    return _cachedToken.token;
  }

  const { ZOHO_CLIENT_ID, ZOHO_CLIENT_SECRET, ZOHO_REFRESH_TOKEN } = process.env;
  if (!ZOHO_CLIENT_ID || !ZOHO_CLIENT_SECRET || !ZOHO_REFRESH_TOKEN) {
    throw new Error('Zoho credentials not configured');
  }

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
  if (!data.access_token) throw new Error('Zoho token exchange failed');

  _cachedToken = { token: data.access_token, expiresAt: Date.now() + (data.expires_in ?? 3600) * 1000 };
  return _cachedToken.token;
}

/**
 * Returns a Set of lowercased company names already in the buyer's Zoho vendor book.
 * Returns an empty Set on any error so the engine continues gracefully.
 */
export interface ZohoVendorData {
  normalized: Set<string>;  // lowercase, for dedup comparison
  originals:  string[];     // original-case names, for lookalike search seeds
}

/**
 * Returns all vendors in Zoho — normalized set for dedup and original names
 * for use as lookalike search seeds.
 * Returns empty data on any error so the engine continues gracefully.
 */
export async function getZohoVendorData(_zohoOwnerName?: string): Promise<ZohoVendorData> {
  try {
    const token = await getAccessToken();

    const normalized = new Set<string>();
    const originals: string[] = [];

    for (let page = 1; page <= 5; page++) {
      const params = new URLSearchParams({
        fields: 'Vendor_Name',
        per_page: '200',
        page: String(page),
      });

      const res = await fetch(`https://www.zohoapis.com/crm/v3/Vendors?${params}`, {
        headers: { Authorization: `Zoho-oauthtoken ${token}` },
        signal: AbortSignal.timeout(10_000),
      });

      if (!res.ok) {
        console.warn('[zoho-dedup] Vendors query failed:', res.status);
        break;
      }

      const data = await res.json();
      const vendors: Array<{ Vendor_Name?: string }> = data.data ?? [];
      for (const v of vendors) {
        const name = (v.Vendor_Name ?? '').trim();
        if (name) {
          normalized.add(name.toLowerCase());
          originals.push(name);
        }
      }

      if (vendors.length < 200) break;
    }

    console.log(`[zoho-dedup] ${normalized.size} total vendors found in Zoho`);
    return { normalized, originals };
  } catch {
    console.warn('[zoho-dedup] Skipping dedup — Zoho unavailable or not configured');
    return { normalized: new Set(), originals: [] };
  }
}

// Backward-compat wrapper
export async function getExistingVendorNames(_zohoOwnerName?: string): Promise<Set<string>> {
  const { normalized } = await getZohoVendorData(_zohoOwnerName);
  return normalized;
}
