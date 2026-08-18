/**
 * Web search via Google News RSS — free, no API key required.
 * All queries are built from the buyer's profile, so each buyer
 * (Dewey, Igor, Ed, …) gets searches tuned to their specific lane and seeds.
 */
import { BuyerProfile } from '../types';

export interface SearchResult {
  title: string;
  url: string;
  description: string;
  stream: 'signal' | 'lookalike';
}

/** Parse Google News RSS XML and extract article entries. */
function parseRss(xml: string, stream: 'signal' | 'lookalike', maxResults = 15): SearchResult[] {
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

/** Fetch one Google News RSS query. */
async function fetchRss(query: string, stream: 'signal' | 'lookalike'): Promise<SearchResult[]> {
  const url = `https://news.google.com/rss/search?q=${encodeURIComponent(query)}&hl=en-US&gl=US&ceid=US:en`;
  const res = await fetch(url, {
    headers: { 'User-Agent': 'Mozilla/5.0 (compatible; LewiscoBot/1.0)' },
    signal: AbortSignal.timeout(15_000),
  });
  if (!res.ok) throw new Error(`Google News RSS error: ${res.status}`);
  return parseRss(await res.text(), stream);
}

/**
 * Build signal-stream queries — one focused query per category so Google News
 * can actually match them. Concatenating all categories into one query returns
 * almost nothing.
 */
function buildSignalQueries(profile: BuyerProfile): string[] {
  const year = new Date().getFullYear();
  const cats = profile.categories.slice(0, 5);
  const queries: string[] = [];

  for (const cat of cats) {
    queries.push(`${cat} manufacturer plant closure layoffs ${year}`);
    queries.push(`${cat} brand acquisition merger inventory ${year}`);
  }

  // Broad liquidation sweep
  queries.push(`food beverage manufacturer excess inventory liquidation closeout ${year}`);
  queries.push(`CPG brand private equity acquisition SKU rationalization ${year}`);

  return queries;
}

/**
 * Build lookalike-stream queries from the buyer's seed vendors.
 */
function buildLookalikeQueries(profile: BuyerProfile): string[] {
  const year = new Date().getFullYear();
  const seeds = profile.seedVendors.slice(0, 6);
  const queries: string[] = [];

  for (const seed of seeds) {
    queries.push(`${seed} competitor brand closeout inventory ${year}`);
  }

  // Lane-level sweeps
  for (const lane of profile.lanes.slice(0, 2)) {
    queries.push(`${lane} brand closeout distributor buyout ${year}`);
  }

  return queries;
}

/**
 * Run all signal + lookalike searches in parallel for a specific buyer.
 * Returns deduped results tagged with their stream type.
 */
export async function runSignalSearches(
  profile: BuyerProfile,
  _windowDays = 90
): Promise<{ results: SearchResult[]; queriesRun: number }> {
  const signalQueries   = buildSignalQueries(profile);
  const lookalikeQueries = buildLookalikeQueries(profile);

  const allQueries: Array<{ q: string; stream: 'signal' | 'lookalike' }> = [
    ...signalQueries.map((q) => ({ q, stream: 'signal' as const })),
    ...lookalikeQueries.map((q) => ({ q, stream: 'lookalike' as const })),
  ];

  const settled = await Promise.allSettled(
    allQueries.map(({ q, stream }) => fetchRss(q, stream))
  );

  const results: SearchResult[] = [];
  for (const outcome of settled) {
    if (outcome.status === 'fulfilled') results.push(...outcome.value);
  }

  // Deduplicate by URL, preserving stream from first occurrence
  const seen = new Set<string>();
  const deduped = results.filter((r) => {
    if (seen.has(r.url)) return false;
    seen.add(r.url);
    return true;
  });

  return { results: deduped, queriesRun: allQueries.length };
}
