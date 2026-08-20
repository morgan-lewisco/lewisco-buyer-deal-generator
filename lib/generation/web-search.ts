import { BuyerProfile } from '../types';

export interface SearchResult {
  title: string;
  url: string;
  description: string;
  stream: 'signal' | 'lookalike';
}

function parseRss(xml: string, stream: 'signal' | 'lookalike', maxResults = 25): SearchResult[] {
  const items: SearchResult[] = [];
  for (const match of xml.matchAll(/<item>([\s\S]*?)<\/item>/g)) {
    const block = match[1];
    const titleMatch = block.match(/<title><!\[CDATA\[([\s\S]*?)\]\]><\/title>/) ??
                       block.match(/<title>([\s\S]*?)<\/title>/);
    const linkMatch  = block.match(/<link>([\s\S]*?)<\/link>/);
    const title = titleMatch?.[1]?.trim() ?? '';
    const url   = linkMatch?.[1]?.trim() ?? '';
    if (title && url) {
      items.push({ title, url, description: '', stream });
      if (items.length >= maxResults) break;
    }
  }
  return items;
}

async function fetchRss(query: string, stream: 'signal' | 'lookalike', afterDate: string): Promise<SearchResult[]> {
  // Append Google's date filter operator so only articles after the cutoff are returned
  const timedQuery = `${query} after:${afterDate}`;
  const url = `https://news.google.com/rss/search?q=${encodeURIComponent(timedQuery)}&hl=en-US&gl=US&ceid=US:en`;
  const res = await fetch(url, {
    headers: { 'User-Agent': 'Mozilla/5.0 (compatible; LewiscoBot/1.0)' },
    signal: AbortSignal.timeout(15_000),
  });
  if (!res.ok) throw new Error(`RSS error: ${res.status}`);
  return parseRss(await res.text(), stream);
}

function buildSignalQueries(profile: BuyerProfile): string[] {
  const year = new Date().getFullYear();
  const queries: string[] = [];

  // One pair of queries per category — ALL categories, not just first 5
  for (const cat of profile.categories) {
    queries.push(`${cat} manufacturer plant closure layoffs ${year}`);
    queries.push(`${cat} brand acquisition merger excess inventory ${year}`);
  }

  // Broad sweeps covering the full Lewisco universe
  queries.push(`food beverage manufacturer excess inventory liquidation closeout ${year}`);
  queries.push(`CPG brand acquisition SKU rationalization inventory buyout ${year}`);
  queries.push(`pet food health beauty household products manufacturer layoffs ${year}`);
  queries.push(`frozen refrigerated food manufacturer plant closure ${year}`);
  queries.push(`grocery brand divestiture overstock surplus inventory ${year}`);
  queries.push(`consumer goods brand bankruptcy inventory liquidation ${year}`);

  return queries;
}

/**
 * Build lookalike queries from profile seed vendors AND a sample of existing
 * Zoho vendors — finding companies similar to ones Lewisco already buys from.
 */
function buildLookalikeQueries(profile: BuyerProfile, zohoVendors: string[]): string[] {
  const year = new Date().getFullYear();
  const queries: string[] = [];

  // All profile seed vendors
  for (const seed of profile.seedVendors) {
    queries.push(`${seed} competitor brand closeout inventory ${year}`);
  }

  // Sample of Zoho vendors — pick every Nth to spread coverage across 700+
  // Target ~25 Zoho-based queries
  const step = Math.max(1, Math.floor(zohoVendors.length / 25));
  const zohoSample = zohoVendors.filter((_, i) => i % step === 0).slice(0, 25);
  for (const vendor of zohoSample) {
    queries.push(`${vendor} competitor brand closeout inventory ${year}`);
  }

  // Lane-level sweeps — all lanes
  for (const lane of profile.lanes) {
    queries.push(`${lane} brand closeout distributor buyout ${year}`);
  }

  return queries;
}

function toISODate(d: Date): string {
  return d.toISOString().slice(0, 10); // YYYY-MM-DD
}

export async function runSignalSearches(
  profile: BuyerProfile,
  windowDays = 90,
  zohoVendors: string[] = [],
): Promise<{ results: SearchResult[]; queriesRun: number }> {
  // Calculate cutoff date from windowDays
  const cutoff = new Date();
  cutoff.setDate(cutoff.getDate() - windowDays);
  const afterDate = toISODate(cutoff);
  console.log(`[web-search] Date filter: after:${afterDate} (${windowDays}-day window)`);

  const signalQueries    = buildSignalQueries(profile);
  const lookalikeQueries = buildLookalikeQueries(profile, zohoVendors);

  const allQueries: Array<{ q: string; stream: 'signal' | 'lookalike' }> = [
    ...signalQueries.map((q)    => ({ q, stream: 'signal'   as const })),
    ...lookalikeQueries.map((q) => ({ q, stream: 'lookalike' as const })),
  ];

  console.log(`[web-search] Running ${allQueries.length} queries (${signalQueries.length} signal, ${lookalikeQueries.length} lookalike)`);

  const settled = await Promise.allSettled(
    allQueries.map(({ q, stream }) => fetchRss(q, stream, afterDate))
  );

  const results: SearchResult[] = [];
  for (const outcome of settled) {
    if (outcome.status === 'fulfilled') results.push(...outcome.value);
  }

  // Deduplicate by URL
  const seen = new Set<string>();
  const deduped = results.filter((r) => {
    if (seen.has(r.url)) return false;
    seen.add(r.url);
    return true;
  });

  console.log(`[web-search] ${deduped.length} unique articles from ${allQueries.length} queries`);
  return { results: deduped, queriesRun: allQueries.length };
}
