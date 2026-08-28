import { NextRequest, NextResponse } from 'next/server';
import {
  getZohoToken, getVendorIndex, matchScore, rawTokens,
  fetchVendorFields, setOverride, removeOverride,
} from '@/lib/zoho-utils';
import type { ZohoMatch } from '@/lib/types';

// GET /api/zoho-link?q=Pearson — return up to 10 vendor names containing the query
export async function GET(req: NextRequest) {
  try {
    const q = req.nextUrl.searchParams.get('q') ?? '';
    if (q.length < 2) return NextResponse.json({ vendors: [] });
    const token = await getZohoToken();
    const stubs = await getVendorIndex(token);
    const qLower = q.toLowerCase();
    const vendors = stubs
      .filter(({ name }) => name.toLowerCase().includes(qLower))
      .slice(0, 10)
      .map(({ name }) => name);
    return NextResponse.json({ vendors });
  } catch (err) {
    return NextResponse.json({ error: String(err) }, { status: 500 });
  }
}

// POST { company, vendorName } — manually link a lead company to a Zoho vendor
export async function POST(req: NextRequest) {
  try {
    const { company, vendorName }: { company: string; vendorName: string } = await req.json();
    if (!company || !vendorName) {
      return NextResponse.json({ error: 'company and vendorName are required' }, { status: 400 });
    }

    const token  = await getZohoToken();
    const stubs  = await getVendorIndex(token);

    type Entry = { id: string; name: string; variants: string[] };
    const entries: Entry[] = stubs.map(({ id, name }) => ({
      id,
      name,
      variants: name.split(/\s*\/\s*|\bDBA\b/i).map((s) => s.trim()).filter(Boolean),
    }));

    // Fuzzy match with standard scoring PLUS a substring check for manual input
    let best = { score: 0, id: '', name: '' };
    const inputLower = rawTokens(vendorName).join(' ');

    for (const { id, variants, name: zohoName } of entries) {
      let score = Math.max(...variants.map((v) => matchScore(vendorName, v)));

      // Also accept if the typed name is a substring of any variant (or vice versa)
      const subHit = variants.some((v) => {
        const vl = rawTokens(v).join(' ');
        return vl.includes(inputLower) || inputLower.includes(vl);
      });
      if (subHit && score < 60) score = 60;

      if (score > best.score) best = { score, id, name: zohoName };
    }

    console.log(`[zoho-link] local best for "${vendorName}": "${best.name}" (score ${best.score})`);

    // If local cache didn't find it, try a direct Zoho search as authoritative fallback
    if (best.score < 60 || !best.id) {
      console.log(`[zoho-link] falling back to direct Zoho search for "${vendorName}"`);
      const encoded = encodeURIComponent(`(Vendor_Name:equals:${vendorName})`);
      const searchRes = await fetch(
        `https://www.zohoapis.com/crm/v3/Vendors/search?criteria=${encoded}&fields=id,Vendor_Name`,
        { headers: { Authorization: `Zoho-oauthtoken ${token}` }, signal: AbortSignal.timeout(8_000) },
      );
      if (searchRes.ok) {
        const searchData = await searchRes.json();
        const hit = searchData.data?.[0];
        if (hit?.id) {
          await setOverride(company, String(hit.id));
          const fields = await fetchVendorFields(token, String(hit.id));
          const resolvedName = String(hit.Vendor_Name ?? vendorName);
          console.log(`[zoho-link] direct search linked "${company}" → "${resolvedName}"`);
          return NextResponse.json({ match: { found: true, ...fields, overridden: true } as ZohoMatch, resolvedName });
        }
      }
      return NextResponse.json(
        { error: `"${vendorName}" not found in Zoho. Check the spelling matches your CRM exactly.` },
        { status: 404 },
      );
    }

    await setOverride(company, best.id);
    const fields = await fetchVendorFields(token, best.id);

    const match: ZohoMatch = { found: true, ...fields, overridden: true };
    console.log(`[zoho-link] Linked "${company}" → "${best.name}" (score ${best.score})`);
    return NextResponse.json({ match, resolvedName: best.name });
  } catch (err) {
    console.error('[zoho-link]', err);
    return NextResponse.json({ error: String(err) }, { status: 500 });
  }
}

// DELETE { company } — remove a manual override
export async function DELETE(req: NextRequest) {
  try {
    const { company }: { company: string } = await req.json();
    if (!company) return NextResponse.json({ error: 'company required' }, { status: 400 });
    await removeOverride(company);
    console.log(`[zoho-link] Removed override for "${company}"`);
    return NextResponse.json({ removed: true });
  } catch (err) {
    console.error('[zoho-link]', err);
    return NextResponse.json({ error: String(err) }, { status: 500 });
  }
}
