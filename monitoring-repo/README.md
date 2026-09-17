# Sentry Docs Monitor

Copy this directory's contents (including `.github/` and `poll-github.cjs`) into
a dedicated GitHub repository. The workflow runs every 15 minutes against
`getsentry/sentry-docs` on `master`.

Set repository Actions secrets `WEBHOOK_URL` (the application's
`/api/github/webhook` URL) and `WEBHOOK_SECRET` (matching the app's
`GITHUB_WEBHOOK_SECRET`). The app also needs `GITHUB_TOKEN` to retrieve commit
contents. Enable Actions and allow the workflow's `contents: write` permission;
repository rules must permit its checkpoint commits on the default branch.

The first run persists a batch of the latest ten commits, then delivers oldest
first. Subsequent runs paginate until the saved checkpoint. The app checks each
commit for documentation changes and persists relevant entries. On any failure,
processing stops; only successful progress is recorded. The workflow commits
`last-processed-sha.json` even when a later delivery fails. Failed checkpoint pushes
fail visibly and may replay deliveries on the next run; the app deduplicates IDs.
Workflow concurrency prevents overlapping runs.

When upgrading, migrate any existing `last-processed-sha.txt` into JSON:
`{"lastProcessedSha":"<40-character SHA>"}`. Preserve this file across runs.
If the SHA is no longer in upstream history, reconcile the boundary manually;
the monitor refuses to silently skip missing history. Inspect failed runs in
Actions, correct the upstream/storage/authentication problem, and rerun.
