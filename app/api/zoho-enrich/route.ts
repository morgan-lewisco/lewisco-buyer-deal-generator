import { NextRequest, NextResponse } from 'next/server';
import {
  getZohoToken, getVendorIndex, matchScore, fetchVendorFields, pMap, getOverrides,
} from '@/lib/zoho-utils';
import type { ZohoMatch } from '@/lib/types';

export async function POST(req: NextRequest) {
  try {
    const { companies }: { companies: string[] } = await req.json();
    if (!companies?.length) return NextResponse.json({});

    const token = await getZohoToken();
    const [stubs, overrides] = await Promise.all([getVendorIndex(token), getOverrides()]);

    type Entry = { id: string; name: string; variants: string[] };
    const entries: Entry[] = stubs.map(({ id, name }) => ({
      id,
      name,
      variants: name.split(/\s*\/\s*|\bDBA\b/i).map((s) => s.trim()).filter(Boolean),
    }));

    const matchedIds = new Map<string, { id: string; overridden: boolean }>();

    // Manual overrides take priority
    for (const company of companies) {
      if (overrides[company]) {
        matchedIds.set(company, { id: overrides[company], overridden: true });
        console.log(`[zoho-enrich] OVERRIDE "${company}" → ${overrides[company]}`);
      }
    }

    // Fuzzy match remaining companies
    for (const company of companies) {
      if (matchedIds.has(company)) continue;
      let best = { score: 0, id: '', name: '' };
      for (const { id, variants, name: zohoName } of entries) {
        const score = Math.max(...variants.map((v) => matchScore(company, v)));
        if (score > best.score) best = { score, id, name: zohoName };
      }
      if (best.score >= 70) {
        matchedIds.set(company, { id: best.id, overridden: false });
        console.log(`[zoho-enrich] MATCH  "${company}" → "${best.name}" (score ${best.score})`);
      } else {
        console.log(`[zoho-enrich] MISS   "${company}" — best score ${best.score} vs "${best.name}"`);
      }
    }

    console.log(`[zoho-enrich] ${companies.length} companies → ${matchedIds.size} matched`);

    const uniqueIds = [...new Set([...matchedIds.values()].map((v) => v.id))];
    const fieldResults = await pMap(uniqueIds, (id) => fetchVendorFields(token, id), 8);
    const fieldMap = new Map(uniqueIds.map((id, i) => [id, fieldResults[i]]));

    const result: Record<string, ZohoMatch> = {};
    for (const company of companies) {
      const match = matchedIds.get(company);
      if (match) {
        const fields = fieldMap.get(match.id)!;
        result[company] = { found: true, ...fields, overridden: match.overridden };
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
