import { NextResponse } from 'next/server';
import Anthropic from '@anthropic-ai/sdk';
import { Lead } from '@/lib/types';
import { fetchTopContact, getAccessToken } from '@/lib/generation/zoominfo-enrich';

const anthropic = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });

const LEAD_TOOL: Anthropic.Tool = {
  name: 'record_lead',
  description: 'Record a single scored lead extracted from the article.',
  input_schema: {
    type: 'object' as const,
    properties: {
      company:      { type: 'string' },
      website:      { type: 'string' },
      category:     { type: 'string' },
      fitScore:     { type: 'number', description: '0–50' },
      signalScore:  { type: 'number', description: '0–50' },
      blendedScore: { type: 'number' },
      whyNow:       { type: 'string', description: 'One sentence: what event + why it frees inventory' },
      signalType:   { type: 'string', enum: ['merger_acquisition','plant_closure','layoffs','divestiture','facility_relocation','lookalike'] },
      signalDate:   { type: 'string', description: 'ISO date of the event' },
      revenueRange: { type: 'string' },
      employeeSize: { type: 'string' },
      location:     { type: 'string' },
      leadType:     { type: 'string', enum: ['both','signal','lookalike'] },
      parentCompany:{ type: 'string' },
    },
    required: ['company','category','fitScore','signalScore','blendedScore','whyNow','signalType','signalDate','leadType'],
  },
};

async function fetchArticleText(url: string): Promise<string> {
  try {
    const res = await fetch(url, {
      headers: { 'User-Agent': 'Mozilla/5.0 (compatible; LeadBot/1.0)' },
      signal: AbortSignal.timeout(10000),
    });
    const html = await res.text();
    // Strip tags, collapse whitespace, take first 4000 chars
    const text = html
      .replace(/<script[\s\S]*?<\/script>/gi, '')
      .replace(/<style[\s\S]*?<\/style>/gi, '')
      .replace(/<[^>]+>/g, ' ')
      .replace(/\s+/g, ' ')
      .trim()
      .slice(0, 4000);
    return text;
  } catch {
    return '';
  }
}

export async function POST(req: Request) {
  try {
    const { company, sourceUrl } = await req.json();
    if (!company) return NextResponse.json({ error: 'company is required' }, { status: 400 });

    const articleText = sourceUrl ? await fetchArticleText(sourceUrl) : '';

    const userPrompt = articleText
      ? `Company: ${company}\nSource URL: ${sourceUrl}\n\nArticle content:\n${articleText}\n\nExtract a lead for this company based on the article.`
      : `Company: ${company}\nSource URL: ${sourceUrl ?? ''}\n\nExtract a lead for this company based on your knowledge. Use signalType "lookalike" if no specific event is known.`;

    const response = await anthropic.messages.create({
      model: 'claude-sonnet-4-6',
      max_tokens: 2000,
      system: `You are a lead-generation engine for Lewisco Holdings, a closeout buyer specializing in branded CPG food & beverage, frozen/refrigerated, dry grocery, snacks, candy, pet food, health & beauty, and household products.

Score leads as follows:
fitScore (0–50): how well the company fits Lewisco's buying lanes.
signalScore (0–50): urgency of closeout opportunity (50=plant closure, 40=acquisition, 30=divestiture, 8=lookalike).
blendedScore = fitScore + signalScore.

Extract exactly one lead for the provided company.`,
      tools: [LEAD_TOOL],
      tool_choice: { type: 'any' },
      messages: [{ role: 'user', content: userPrompt }],
    });

    const toolUse = response.content.find((b): b is Anthropic.ToolUseBlock => b.type === 'tool_use');
    if (!toolUse) return NextResponse.json({ error: 'AI could not extract lead data' }, { status: 500 });

    const raw = toolUse.input as {
      company: string; website?: string; category: string;
      fitScore: number; signalScore: number; blendedScore: number;
      whyNow: string; signalType: string; signalDate: string;
      revenueRange?: string; employeeSize?: string; location?: string;
      leadType: 'both' | 'signal' | 'lookalike'; parentCompany?: string;
    };

    const lead: Lead = {
      id: `manual-${Date.now()}`,
      company: raw.company || company,
      website: raw.website ?? company.toLowerCase().replace(/[^a-z0-9]/g, '') + '.com',
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
      sourceUrl: sourceUrl ?? undefined,
      leadType: raw.leadType,
      parentCompany: raw.parentCompany || undefined,
      source: 'web-search',
      status: 'new',
    };

    // Enrich with ZoomInfo
    try {
      const token = await getAccessToken();
      if (token) {
        const contact = await fetchTopContact(token, lead.company, lead.website);
        if (contact) {
          lead.contactName  = contact.name;
          lead.contactTitle = contact.title;
          lead.zoomInfoId   = contact.ziId;
        }
      }
    } catch {
      // ZoomInfo enrichment is best-effort
    }

    return NextResponse.json({ lead });
  } catch (err) {
    console.error('[add-lead]', err);
    return NextResponse.json({ error: 'Failed to add lead' }, { status: 500 });
  }
}
