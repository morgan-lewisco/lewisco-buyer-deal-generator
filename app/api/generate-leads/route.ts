import { NextResponse } from 'next/server';
import { GLOBAL_PROFILE } from '@/lib/buyers';
import { generateLeads } from '@/lib/generation/engine';
import { GenerateOptions } from '@/lib/types';

export const maxDuration = 300;

export async function POST(req: Request) {
  try {
    const body = await req.json();
    const { options } = body as { options: GenerateOptions };

    const result = await generateLeads(GLOBAL_PROFILE, options ?? { excludeContacted: false, excludeDismissed: false, windowDays: 90 });
    return NextResponse.json(result);
  } catch (err) {
    const message = err instanceof Error ? err.message : 'Unknown error';
    console.error('[generate-leads]', message);
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
