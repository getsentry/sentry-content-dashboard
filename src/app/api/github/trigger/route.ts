import * as Sentry from '@sentry/nextjs';
import { NextRequest, NextResponse } from 'next/server';
import { Octokit } from '@octokit/rest';
import { verifyTriggerToken } from '../../../../utils/githubAuth';
import { processDocsChanges } from '../../../../utils/githubProcessor';

export async function POST(request: NextRequest) {
  const secret = process.env.GITHUB_TRIGGER_SECRET;
  if (!secret) return NextResponse.json({ error: 'Manual trigger not configured' }, { status: 503 });
  if (!verifyTriggerToken(request.headers.get('authorization'), secret)) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }
  if (!process.env.GITHUB_TOKEN) return NextResponse.json({ error: 'GitHub token not configured' }, { status: 503 });
  try {
    const octokit = new Octokit({ auth: process.env.GITHUB_TOKEN });
    const { data: commits } = await octokit.rest.repos.listCommits({
      owner: 'getsentry', repo: 'sentry-docs', sha: 'master', per_page: 10,
    });
    const results = [];
    for (const commit of [...commits].reverse()) {
      const processed = await processDocsChanges({ id: commit.sha });
      results.push({ sha: commit.sha, processed });
    }
    return NextResponse.json({ message: 'Manual trigger completed', commitsProcessed: results.filter(r => r.processed).length, results });
  } catch (error) {
    Sentry.captureException(error);
    return NextResponse.json({ error: 'Failed to process commits; retry the trigger' }, { status: 500 });
  }
}

export async function GET() {
  return NextResponse.json({ message: 'GitHub trigger endpoint is active', usage: 'POST with Authorization: Bearer <GITHUB_TRIGGER_SECRET> to ingest recent commits' });
}
