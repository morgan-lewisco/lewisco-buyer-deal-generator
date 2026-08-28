import { NextResponse } from 'next/server';
import { getZohoToken, getVendorIndex, VENDOR_CACHE_KEY } from '@/lib/zoho-utils';
import { kv } from '@vercel/kv';

export async function GET(req: Request) {
  const { searchParams } = new URL(req.url);
  const bust = searchParams.get('bust') === '1';

  try {
    if (bust) await kv.del(VENDOR_CACHE_KEY);
    const token = await getZohoToken();
    const vendors = await getVendorIndex(token);
    const names = vendors.map((v) => v.name).sort((a, b) => a.localeCompare(b));
    return NextResponse.json({ count: names.length, vendors: names });
  } catch (err) {
    return NextResponse.json({ error: String(err) }, { status: 500 });
  }
}
