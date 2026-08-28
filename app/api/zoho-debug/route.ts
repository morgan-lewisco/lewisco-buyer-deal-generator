import { NextResponse } from 'next/server';
import { getZohoToken, getVendorIndex, VENDOR_CACHE_KEY } from '@/lib/zoho-utils';
import { kv } from '@vercel/kv';

export async function GET(req: Request) {
  const { searchParams } = new URL(req.url);
  const bust = searchParams.get('bust') === '1';
  const diagOnly = searchParams.get('diag') === '1';

  try {
    const token = await getZohoToken();

    if (diagOnly) {
      // Search for specific vendors to see if they exist at all in Zoho
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
          ).then((res) => res.json());
          // Also try word search
          const word = encodeURIComponent(name.split(' ').slice(0, 2).join(' '));
          const r2 = await fetch(
            `https://www.zohoapis.com/crm/v3/Vendors/search?word=${word}&fields=id,Vendor_Name`,
            { headers: { Authorization: `Zoho-oauthtoken ${token}` } },
          ).then((res) => res.json());
          return {
            searched: name,
            exactMatch: r.data?.[0] ?? null,
            wordMatches: (r2.data ?? []).slice(0, 3).map((v: Record<string, unknown>) => v.Vendor_Name),
          };
        }),
      );
      // Also spot-check page 11 (list API) to confirm cap
      const page11 = await fetch(
        'https://www.zohoapis.com/crm/v3/Vendors?fields=id,Vendor_Name&per_page=200&page=11',
        { headers: { Authorization: `Zoho-oauthtoken ${token}` } },
      ).then((r) => r.json());
      return NextResponse.json({
        vendorSearches: results,
        listApiPage11Count: page11.data?.length ?? 0,
        listApiPage11Info: page11.info,
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
