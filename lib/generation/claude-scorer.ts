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
- Only extract MANUFACTURERS or BRANDS (not distributors, retailers, or pure service companies)
- Include all companies in the buyer's lane — even adjacent categories have sellable branded inventory
- Signal headlines: only include if the event credibly frees up sellable inventory (M&A, layoffs, plant closures, divestitures, facility relocations)
- Lookalike headlines: include if the brand fits the buyer's lane even with no active event; set signalScore 5–15 and signalType "lookalike"
- If the same company appears in multiple results, merge into one lead with the strongest signal
- Do NOT hallucinate companies — only extract what is explicitly mentioned in the headlines
- COMPANY NAME: always use the real legal or brand name (e.g. "Our Home", "Utz Quality Foods"). Never use generic descriptions like "Snack Company" or "Unnamed beverage brand" — if you cannot identify the real name, skip the lead entirely
- signalDate: use the article/press release date; if unknown use today's date
- leadType = "both" if strong fit AND active signal; "signal" if event-driven but weaker fit; "lookalike" if brand fits lane but no active event
- Omit any company already in the seed vendor list
- Aim for 20–35 leads total across both streams; extract every credible manufacturer or brand you can find`;
}

function buildUserPrompt(results: SearchResult[]): string {
  // Split by stream so Claude knows which headlines are signal-driven vs lookalike.
  const signals    = results.filter((r) => r.stream === 'signal').slice(0, 80);
  const lookalikes = results.filter((r) => r.stream === 'lookalike').slice(0, 40);

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
}

export async function extractAndScoreLeads(
  profile: BuyerProfile,
  searchResults: SearchResult[]
): Promise<Lead[]> {
  if (searchResults.length === 0) return [];

  const response = await anthropic.messages.create({
    model: 'claude-sonnet-4-6',
    max_tokens: 6000,
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

  // Hydrate into full Lead objects
  return rawLeads.map((raw, idx): Lead => ({
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
    revenueRange: raw.revenueRange ?? 'Unknown',
    employeeSize: raw.employeeSize ?? 'Unknown',
    location: raw.location ?? 'US',
    sourceUrl: raw.sourceUrl,
    leadType: raw.leadType,
    source: 'web-search',
    status: 'new',
  }));
}

function inferWebsite(company: string): string {
  return company.toLowerCase().replace(/[^a-z0-9]/g, '') + '.com';
}
