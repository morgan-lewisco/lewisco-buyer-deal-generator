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
      // Run a COQL count to find total vendors in Zoho, and spot-check offset 2000
      const [countRes, offset2kRes] = await Promise.all([
        fetch('https://www.zohoapis.com/crm/v3/coql', {
          method: 'POST',
          headers: { Authorization: `Zoho-oauthtoken ${token}`, 'Content-Type': 'application/json' },
          body: JSON.stringify({ select_query: 'select count(id) from Vendors' }),
        }).then((r) => r.json()),
        fetch('https://www.zohoapis.com/crm/v3/coql', {
          method: 'POST',
          headers: { Authorization: `Zoho-oauthtoken ${token}`, 'Content-Type': 'application/json' },
          body: JSON.stringify({ select_query: 'select id, Vendor_Name from Vendors limit 5 offset 2000' }),
        }).then((r) => r.json()),
      ]);
      return NextResponse.json({
        coqlCount: countRes,
        offset2000Sample: offset2kRes,
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
