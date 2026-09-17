import * as Sentry from '@sentry/nextjs';
import { NextResponse } from 'next/server';
import { refreshSource } from '../../../server/contentService';

export const dynamic = 'force-dynamic';

export async function GET() {
  try {
    const snapshot = await refreshSource('youtube');
    return NextResponse.json(snapshot.items, { headers: snapshot.refreshDeferredUntil
      ? { 'X-Content-Refresh': 'deferred', 'Retry-After': String(Math.max(1, Math.ceil((snapshot.refreshDeferredUntil - Date.now()) / 1000))) }
      : {} });
  } catch (error) {
    Sentry.captureException(error);
    return NextResponse.json({ error: 'Failed to fetch youtube content' }, { status: 503 });
  }
}
