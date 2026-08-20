import { BuyerProfile, GenerateOptions, Lead } from '../types';
import { runSignalSearches } from './web-search';
import { extractAndScoreLeads } from './claude-scorer';
import { getZohoVendorData } from './zoho-dedup';
import { enrichLeadsWithZoomInfo } from './zoominfo-enrich';

export interface GenerationResult {
  leads: Lead[];
  generatedAt: string;
  searchesRun: number;
  rawSignalsFound: number;
  zohoDeduped: boolean;
  excludedCount: number;
}

export async function generateLeads(
  profile: BuyerProfile,
  options: GenerateOptions,
): Promise<GenerationResult> {
  // 1. Fetch Zoho vendors — used both for dedup and as lookalike seeds
  const { normalized: existingNames, originals: zohoVendors } = await getZohoVendorData();
  const zohoDeduped = existingNames.size > 0;

  // 2. Web searches — signal queries + lookalike using profile seeds AND Zoho vendors
  const { results, queriesRun } = await runSignalSearches(profile, options.windowDays, zohoVendors);

  // 3. Claude: extract + score
  let leads = await extractAndScoreLeads(profile, results);

  // 4. Sort best-first
  leads.sort((a, b) => b.blendedScore - a.blendedScore);

  // 5. ZoomInfo enrichment — all leads
  leads = await enrichLeadsWithZoomInfo(leads);

  // 6. Remove companies already in Zoho vendor DB
  const beforeDedup = leads.length;
  leads = leads.filter((lead) => !existingNames.has(lead.company.toLowerCase().trim()));

  console.log(`[engine] ${beforeDedup} raw leads → ${leads.length} after Zoho dedup (${beforeDedup - leads.length} removed)`);

  return {
    leads,
    generatedAt: new Date().toISOString(),
    searchesRun: queriesRun,
    rawSignalsFound: results.length,
    zohoDeduped,
    excludedCount: beforeDedup - leads.length,
  };
}
