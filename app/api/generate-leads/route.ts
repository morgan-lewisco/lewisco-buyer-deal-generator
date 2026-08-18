import { NextRequest, NextResponse } from 'next/server';
import { DEFAULT_BUYERS } from '@/lib/buyers';
import { generateLeads } from '@/lib/generation/engine';
import { GenerateOptions } from '@/lib/types';

export const maxDuration = 60; // seconds — Vercel/Next edge limit

export async function POST(req: NextRequest) {
  try {
    const body = await req.json();
    const { buyerId, options, statusOverrides } = body as {
      buyerId: string;
      options: GenerateOptions;
      statusOverrides?: Record<string, string>;
    };

    const profile = DEFAULT_BUYERS.find((b) => b.id === buyerId);
    if (!profile) {
      return NextResponse.json({ error: `Unknown buyer: ${buyerId}` }, { status: 400 });
    }

    const result = await generateLeads(profile, options, statusOverrides ?? {});
    return NextResponse.json(result);
  } catch (err) {
    const message = err instanceof Error ? err.message : 'Unknown error';
    console.error('[generate-leads]', message);
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
