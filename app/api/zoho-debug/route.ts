import { NextResponse } from 'next/server';
import { getZohoToken, getVendorIndex, VENDOR_CACHE_KEY } from '@/lib/zoho-utils';
import { kv } from '@vercel/kv';

async function safeJson(res: Response) {
  try { return await res.json(); } catch { return { _raw: await res.text().catch(() => '(unreadable)'), _status: res.status }; }
}

export async function GET(req: Request) {
  const { searchParams } = new URL(req.url);
  const bust = searchParams.get('bust') === '1';
  const diagOnly = searchParams.get('diag') === '1';

  try {
    const token = await getZohoToken();

    if (diagOnly) {
      const searchTargets = [
        'The Coca-Cola Company',
        'Pearson Candy Company',
        'Bumble Bee Foods, LLC',
        'Kellogg Company',
        'Tyson Foods',
      ];
      const results = await Promise.all(
        searchTargets.map(async (name) => {
          const criteria = encodeURIComponent(`(Vendor_Name:equals:${name})`);
          const r = await fetch(
            `https://www.zohoapis.com/crm/v3/Vendors/search?criteria=${criteria}&fields=id,Vendor_Name`,
            { headers: { Authorization: `Zoho-oauthtoken ${token}` } },
          ).then(safeJson);
          const word = encodeURIComponent(name.split(' ').slice(0, 2).join(' '));
          const r2 = await fetch(
            `https://www.zohoapis.com/crm/v3/Vendors/search?word=${word}&fields=id,Vendor_Name`,
            { headers: { Authorization: `Zoho-oauthtoken ${token}` } },
          ).then(safeJson);
          return {
            searched: name,
            exactMatch: (r as Record<string, unknown[]>).data?.[0] ?? null,
            wordMatches: ((r2 as Record<string, unknown[]>).data ?? []).slice(0, 3)
              .map((v) => (v as Record<string, unknown>).Vendor_Name),
          };
        }),
      );
      const page11 = await fetch(
        'https://www.zohoapis.com/crm/v3/Vendors?fields=id,Vendor_Name&per_page=200&page=11',
        { headers: { Authorization: `Zoho-oauthtoken ${token}` } },
      ).then(safeJson);
      return NextResponse.json({
        vendorSearches: results,
        listApiPage11Count: (page11 as Record<string, unknown[]>).data?.length ?? 0,
        listApiPage11Info: (page11 as Record<string, unknown>).info,
      });
    }

    if (bust) await kv.del(VENDOR_CACHE_KEY);
    const vendors = await getVendorIndex(token);
    const names = vendors.map((v) => v.name).sort((a, b) => a.localeCompare(b));
    return NextResponse.json({ count: names.length, vendors: names });
  } catch (err) {
    return NextResponse.json({ error: String(err) }, { status: 500 });
  }
}
