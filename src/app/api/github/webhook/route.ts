import * as Sentry from '@sentry/nextjs';
import { NextRequest, NextResponse } from 'next/server';
import { verifyWebhookSignature } from '../../../../utils/githubAuth';
import { processDocsChanges } from '../../../../utils/githubProcessor';

export async function POST(request: NextRequest) {
  const secret = process.env.GITHUB_WEBHOOK_SECRET;
  if (!secret) return NextResponse.json({ error: 'Webhook not configured' }, { status: 503 });
  const body = await request.text();
  if (!verifyWebhookSignature(body, request.headers.get('x-hub-signature-256'), secret)) {
    return NextResponse.json({ error: 'Invalid signature' }, { status: 401 });
  }
  let payload;
  try {
    payload = JSON.parse(body);
  } catch {
    return NextResponse.json({ error: 'Invalid JSON' }, { status: 400 });
  }
  if (request.headers.get('x-github-event') === 'ping') return NextResponse.json({ message: 'Pong' });
  if (!payload || typeof payload !== 'object' || !payload.repository || !Array.isArray(payload.commits)) {
    return NextResponse.json({ error: 'Invalid push payload' }, { status: 400 });
  }
  if (!['refs/heads/main', 'refs/heads/master'].includes(payload.ref) ||
      payload.repository.full_name !== 'getsentry/sentry-docs') {
    return NextResponse.json({ message: 'Ignored repository or branch' });
  }
  const ids = payload.commits.map((commit: { sha?: string; id?: string } | null) => commit?.sha || commit?.id);
  if (ids.some((id: unknown) => typeof id !== 'string' || !/^[a-f0-9]{40}$/i.test(id))) {
    return NextResponse.json({ error: 'Invalid commit ID' }, { status: 400 });
  }
  let processed = 0;
  try {
    for (const id of ids) {
      if (await processDocsChanges({ id })) processed++;
    }
    return NextResponse.json({ message: 'Webhook processed successfully', commitsProcessed: processed });
  } catch (error) {
    Sentry.captureException(error);
    return NextResponse.json({ error: 'Commit processing failed; retry delivery', commitsProcessed: processed }, { status: 500 });
  }
}

export async function GET() {
  return NextResponse.json({ message: 'GitHub webhook endpoint is active' });
}
