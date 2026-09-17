import * as Sentry from '@sentry/nextjs';
import { NextResponse } from 'next/server';
import { refreshSource } from '../../../server/contentService';

export const dynamic = 'force-dynamic';

export async function GET() {
  try {
    return NextResponse.json((await refreshSource('docs')).items);
  } catch (error) {
    Sentry.captureException(error);
    return NextResponse.json({ error: 'Failed to fetch docs content' }, { status: 503 });
  }
}
