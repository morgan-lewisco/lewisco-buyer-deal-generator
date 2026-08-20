/**
 * Uses the Anthropic API (tool_use / forced JSON) to extract, score, and
 * format raw search results into typed Lead objects.
 */
import Anthropic from '@anthropic-ai/sdk';
import { BuyerProfile, Lead } from '../types';
import { SearchResult } from './web-search';

const anthropic = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });

const LEAD_TOOL: Anthropic.Tool = {
  name: 'record_leads',
  description: 'Record the scored lead list extracted from search results.',
  input_schema: {
    type: 'object' as const,
    properties: {
      leads: {
        type: 'array',
        items: {
          type: 'object',
          properties: {
            company:      { type: 'string' },
            website:      { type: 'string' },
            category:     { type: 'string', description: 'e.g. Beverages, Snacks, Canned Seafood, Pantry, Candy, Pet Food' },
            fitScore:     { type: 'number', description: '0-50: how close to buyer lane/seeds' },
            signalScore:  { type: 'number', description: '0-50: urgency of closeout event' },
            blendedScore: { type: 'number', description: 'fitScore + signalScore' },
            whyNow:       { type: 'string', description: 'One plain-English sentence: what event + why it frees inventory' },
            signalType:   { type: 'string', enum: ['merger_acquisition','plant_closure','layoffs','divestiture','facility_relocation','lookalike'] },
            signalDate:   { type: 'string', description: 'ISO date of the event, e.g. 2026-07-15' },
            revenueRange: { type: 'string', description: 'e.g. $50M–$200M' },
            employeeSize: { type: 'string', description: 'e.g. 200–500' },
            location:     { type: 'string', description: 'City, State or region' },
            sourceUrl:    { type: 'string', description: 'URL of the source article/press release' },
            leadType:     { type: 'string', enum: ['both','signal','lookalike'] },
            parentCompany:{ type: 'string', description: 'Parent or holding company if this brand is a subsidiary, e.g. "PepsiCo" for Frito-Lay, "Kraft Heinz" for Oscar Mayer. Omit if independent or unknown.' },
          },
          required: ['company','category','fitScore','signalScore','blendedScore','whyNow','signalType','signalDate','leadType'],
        },
      },
    },
    required: ['leads'],
  },
};

function buildSystemPrompt(profile: BuyerProfile): string {
  return `You are a buy-side lead-generation engine for ${profile.name}, a closeout buyer at Lewisco Holdings.

BUYER PROFILE
Lane: ${profile.lanes.join(', ')}
Buying style: CLOSEOUT / OPPORTUNISTIC — buys excess, discontinued, and overstock inventory from established brands.
Seed vendors (strongest existing relationships): ${profile.seedVendors.join(', ')}
Revenue target: $${(profile.revenueBand.min / 1e6).toFixed(0)}M – $${(profile.revenueBand.max / 1e6).toFixed(0)}M
Geography: US

SCORING RULES
fitScore (0–50): How close is this company to the buyer's lane and seed vendors?
  50 = dead-center (e.g. another functional beverage or canned-seafood brand)
  30 = adjacent (e.g. bakery, deli)
  10 = stretch (e.g. pet, specialty ingredient)

signalScore (0–50): How urgent is the closeout opportunity?
  50 = plant closure / mass layoff (inventory MUST move, fixed date)
  40 = acquisition / PE buyout (SKU rationalization typically follows)
  30 = divestiture / facility move (high likelihood of excess)
  15 = leadership change / expansion (watch, lower urgency)
  8  = no active event (look-alike only)

blendedScore = fitScore + signalScore (max 100)

EXTRACTION RULES
- NO ALCOHOL: Lewisco does not deal in alcohol. SKIP any company primarily in wine, spirits, liquor, beer, hard seltzer, cider, or alcohol distribution — regardless of signal strength. Examples to skip: Pernod Ricard, Brown-Forman, Constellation Brands, Diageo, Anheuser-Busch, Molson Coors, E&J Gallo, Boston Beer Company, Mark Anthony Brands.
- UNITED STATES ONLY: Only extract companies that manufacture, distribute, or are headquartered in the United States. SKIP any company based in Canada, Mexico, Europe, Asia, Latin America, or any other non-US country. If the headline mentions a foreign facility, foreign workforce, or a company clearly operating outside the US — SKIP it. Examples of leads to SKIP: a Singapore brand cutting jobs at a Senoko facility, a UK company closing a plant in Manchester, a Mexican manufacturer relocating to Monterrey.
- Only extract MANUFACTURERS or BRANDS (not distributors, retailers, or pure service companies)
- Include all companies in the buyer's lane — even adjacent categories have sellable branded inventory
- Signal headlines: only include if the event ACTUALLY HAPPENED and credibly frees up sellable inventory (M&A, layoffs, plant closures, divestitures, facility relocations)
- CRITICAL: EXCLUDE any headline where the deal, merger, or event was CANCELLED, FAILED, ENDED WITH NO DEAL, REJECTED, WITHDRAWN, CALLED OFF, or FELL THROUGH — these produce no inventory. Examples of headlines to SKIP: "X and Y End Merger Talks", "X Rejects Acquisition Offer", "Deal Falls Through", "X Walks Away From Y Merger", "Talks Collapse". If the headline says talks ended, a deal was rejected, or no agreement was reached — SKIP the lead entirely.
- Lookalike headlines: include if the brand fits the buyer's lane even with no active event; set signalScore 5–15 and signalType "lookalike"
- ONE LEAD PER EVENT: if the same incident involves a parent company and a subsidiary (e.g. PepsiCo closing Frito-Lay plants), create exactly ONE lead — use the subsidiary/brand name (Frito-Lay), set parentCompany to the parent (PepsiCo), and do NOT create separate leads for both. Never create a combined "Parent / Child" company name with a slash.
- If the same company appears in multiple results, merge into one lead with the strongest signal
- Do NOT hallucinate companies — only extract what is explicitly mentioned in the headlines
- PARENT COMPANY: if the brand is a subsidiary, set parentCompany to the parent/holding company name (e.g. Frito-Lay → PepsiCo, Oscar Mayer → Kraft Heinz, Gatorade → PepsiCo, Tropicana → PAI Partners, Kool-Aid → Kraft Heinz). Use your knowledge of CPG corporate structure — this does not need to be in the headline.
- COMPANY NAME: always use the real legal or brand name (e.g. "Our Home", "Utz Quality Foods"). Never use generic descriptions like "Snack Company" or "Unnamed beverage brand" — if you cannot identify the real name, skip the lead entirely
- signalDate: use the article/press release date; if unknown use today's date
- RECENCY: all headlines should be from the last 90 days — if a headline clearly refers to an event older than 90 days, skip it
- leadType = "both" if strong fit AND active signal; "signal" if event-driven but weaker fit; "lookalike" if brand fits lane but no active event
- Omit any company already in the seed vendor list
- Extract EVERY credible manufacturer or brand across both streams — aim for 50–80+ leads; do not stop early
- Quality over quantity: skip any company you are not confident about, but do not self-limit the count`;
}

function buildUserPrompt(results: SearchResult[]): string {
  // Split by stream so Claude knows which headlines are signal-driven vs lookalike.
  const signals    = results.filter((r) => r.stream === 'signal').slice(0, 200);
  const lookalikes = results.filter((r) => r.stream === 'lookalike').slice(0, 100);

  const signalBlock = signals.length
    ? `SIGNAL HEADLINES (active M&A, closures, layoffs — these companies likely have excess inventory):\n` +
      signals.map((r, i) => `${i + 1}. ${r.title}`).join('\n')
    : '';

  const lookalikeBlock = lookalikes.length
    ? `\nLOOKALIKE HEADLINES (brands similar to existing vendor seeds — score fit, signal may be low):\n` +
      lookalikes.map((r, i) => `${signals.length + i + 1}. ${r.title}`).join('\n')
    : '';

  return `Extract and score leads from these news headlines. Call record_leads with your findings.\n\n${signalBlock}${lookalikeBlock}`;
}

export interface RawLead {
  company: string;
  website?: string;
  category: string;
  fitScore: number;
  signalScore: number;
  blendedScore: number;
  whyNow: string;
  signalType: string;
  signalDate: string;
  revenueRange?: string;
  employeeSize?: string;
  location?: string;
  sourceUrl?: string;
  leadType: 'both' | 'signal' | 'lookalike';
  parentCompany?: string;
}

export async function extractAndScoreLeads(
  profile: BuyerProfile,
  searchResults: SearchResult[]
): Promise<Lead[]> {
  if (searchResults.length === 0) return [];

  const response = await anthropic.messages.create({
    model: 'claude-sonnet-4-6',
    max_tokens: 16000,
    system: buildSystemPrompt(profile),
    tools: [LEAD_TOOL],
    tool_choice: { type: 'any' },
    messages: [{ role: 'user', content: buildUserPrompt(searchResults) }],
  });

  // Find the tool_use block
  const toolUse = response.content.find((b): b is Anthropic.ToolUseBlock => b.type === 'tool_use');
  if (!toolUse) return [];

  const { leads: rawLeads } = toolUse.input as { leads: RawLead[] };
  if (!Array.isArray(rawLeads)) return [];

  // Post-extraction dedup: remove parent-level duplicates when a subsidiary lead exists.
  // Also collapse slash-format names (e.g. "PepsiCo / Frito-Lay") to the child brand.
  const norm = (s: string) => s.toLowerCase().trim();

  // Resolve slash names → use the last token (most specific brand)
  const resolved = rawLeads.map((r) => {
    if (r.company.includes('/')) {
      const parts = r.company.split('/').map((p) => p.trim()).filter(Boolean);
      const child = parts[parts.length - 1];
      const parent = parts.length > 1 ? parts[0] : r.parentCompany;
      return { ...r, company: child, parentCompany: r.parentCompany || parent };
    }
    return r;
  });

  // Build set of subsidiary names so we can drop their parent if it appears separately
  const subsidiaryNames = new Set(
    resolved
      .filter((r) => r.parentCompany)
      .map((r) => norm(r.company))
  );
  const parentNames = new Set(
    resolved
      .filter((r) => r.parentCompany)
      .map((r) => norm(r.parentCompany!))
  );

  // Drop a lead if its company name is a known parent of another lead in this batch
  // (keeps the subsidiary, which is the more actionable contact)
  const dedupedRaw = resolved.filter((r) => {
    const isParentOfAnother = parentNames.has(norm(r.company)) && !subsidiaryNames.has(norm(r.company));
    return !isParentOfAnother;
  });

  // Deduplicate by normalized company name, keeping highest blendedScore
  const byCompany = new Map<string, typeof dedupedRaw[0]>();
  for (const r of dedupedRaw) {
    const key = norm(r.company);
    const existing = byCompany.get(key);
    if (!existing || r.blendedScore > existing.blendedScore) byCompany.set(key, r);
  }
  const finalRaw = [...byCompany.values()];

  // Hydrate into full Lead objects
  return finalRaw.map((raw, idx): Lead => ({
    id: `live-${Date.now()}-${idx}`,
    company: raw.company,
    website: raw.website ?? inferWebsite(raw.company),
    category: raw.category,
    fitScore: Math.round(Math.min(50, Math.max(0, raw.fitScore))),
    signalScore: Math.round(Math.min(50, Math.max(0, raw.signalScore))),
    blendedScore: Math.round(Math.min(100, Math.max(0, raw.blendedScore))),
    whyNow: raw.whyNow,
    signalType: raw.signalType,
    signalDate: raw.signalDate,
    revenueRange: raw.revenueRange ?? '',
    employeeSize: raw.employeeSize ?? '',
    location: raw.location ?? 'US',
    sourceUrl: raw.sourceUrl,
    leadType: raw.leadType,
    parentCompany: raw.parentCompany || undefined,
    source: 'web-search',
    status: 'new',
  }));
}

function inferWebsite(company: string): string {
  return company.toLowerCase().replace(/[^a-z0-9]/g, '') + '.com';
}
