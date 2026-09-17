import * as Sentry from '@sentry/nextjs';
import { NextResponse } from 'next/server';
import { refreshSource } from '../../../server/contentService';

export const dynamic = 'force-dynamic';

export async function GET() {
  try {
    const snapshot = await refreshSource('changelog');
    return NextResponse.json(snapshot.items, { headers: snapshot.refreshBusy ? { 'X-Content-Refresh': 'busy' } : {} });
  } catch (error) {
    Sentry.captureException(error);
    return NextResponse.json({ error: 'Failed to fetch changelog content' }, { status: 503 });
  }
}
