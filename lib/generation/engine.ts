/**
 * Main generation engine.
 * Orchestrates: web search → Claude scoring → Zoho dedup → ranked leads.
 */
import { BuyerProfile, GenerateOptions, Lead } from '../types';
import { runSignalSearches } from './web-search';
import { extractAndScoreLeads } from './claude-scorer';
import { getExistingVendorNames } from './zoho-dedup';
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
  existingStatusOverrides: Record<string, string> = {}
): Promise<GenerationResult> {
  // 1. Run web searches (signal + lookalike, tuned to this buyer's profile)
  const { results, queriesRun } = await runSignalSearches(profile, options.windowDays);

  // 2. Claude: extract + score
  let leads = await extractAndScoreLeads(profile, results);

  // 3. Sort best-first
  leads.sort((a, b) => b.blendedScore - a.blendedScore);

  // 3.5 ZoomInfo enrichment — top 15 leads only to stay within time budget
  const toEnrich  = leads.slice(0, 15);
  const remainder = leads.slice(15);
  const enriched  = await enrichLeadsWithZoomInfo(toEnrich);
  leads = [...enriched, ...remainder];

  // 4. Zoho dedup (graceful — won't throw)
  const existingNames = await getExistingVendorNames(profile.zohoOwnerName);
  const zohoDeduped = existingNames.size > 0;
  const beforeDedup = leads.length;

  leads = leads.filter((lead) => {
    const key = lead.company.toLowerCase().trim();
    return !existingNames.has(key);
  });

  const excludedByZoho = beforeDedup - leads.length;

  // 5. Exclude contacted/dismissed from this session if toggles are on
  const excluded = new Set(
    Object.entries(existingStatusOverrides)
      .filter(([, status]) => {
        if (options.excludeContacted && status === 'contacted') return true;
        if (options.excludeDismissed && status === 'dismissed') return true;
        return false;
      })
      .map(([key]) => key.toLowerCase())
  );

  const beforeSessionFilter = leads.length;
  leads = leads.filter((lead) => {
    const key = (lead.zoomInfoId ?? lead.company).toLowerCase();
    return !excluded.has(key);
  });

  const excludedBySession = beforeSessionFilter - leads.length;

  return {
    leads,
    generatedAt: new Date().toISOString(),
    searchesRun: queriesRun,
    rawSignalsFound: results.length,
    zohoDeduped,
    excludedCount: excludedByZoho + excludedBySession,
  };
}
