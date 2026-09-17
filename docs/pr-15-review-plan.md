# PR #15 review and regression-prevention plan

Reviewed head: `400e5fc7c019349dfe73b9724e3969c9e73d3a38`.

Scope: all 11 inline review comments, all four review summaries, both conversation comments, and all 13 check results available at review time. No runtime code changes are part of this planning pass.

## Findings and disposition

| Feedback | Verified assessment | Planned work |
| --- | --- | --- |
| [Sentry: local lock cleanup](https://github.com/getsentry/sentry-content-dashboard/pull/15#discussion_r4032936478) | Real: temporary-file cleanup can throw before lock release is attempted. `force: true` does not suppress permission errors. | A |
| [Warden: forced-refresh quota exhaustion](https://github.com/getsentry/sentry-content-dashboard/pull/15#discussion_r4032910420) | Real: public `refresh=1` bypasses freshness. In-flight coalescing protects simultaneous calls only; successive calls still consume quota. | B |
| [Cursor: slow Redis connection](https://github.com/getsentry/sentry-content-dashboard/pull/15#discussion_r4032923912) | Partly real: the 400 ms snapshot deadline also covers connection establishment and disables coordination for 15 seconds. The claimed unhandled late rejection is false: `Promise.race` installs rejection handlers on its inputs; a local Node reproduction observed no unhandled rejection. | C; explain the false-positive portion with evidence. |
| [Sentry: lease loss disables all caching](https://github.com/getsentry/sentry-content-dashboard/pull/15#discussion_r4032936484) | Real: lease expiry and contention reach the same catch as Redis transport failures and set a global outage flag. | C |
| [CodeQL: blog tag removal](https://github.com/getsentry/sentry-content-dashboard/pull/15#discussion_r4032895686) | Regex tag removal is not an HTML sanitizer; replace it with explicit feed-to-text parsing. React text rendering currently escapes this output, so this does not establish dashboard script execution. | D |
| [CodeQL: blog entity decoding](https://github.com/getsentry/sentry-content-dashboard/pull/15#discussion_r4032895694) | Real parsing defect: ordered replacements decode `&amp;lt;` into `<` in one pass, potentially damaging literal code examples. | D |
| [CodeQL: changelog tag removal](https://github.com/getsentry/sentry-content-dashboard/pull/15#discussion_r4032895702) | Same unsafe stripping pattern, followed by entity decoding that can reintroduce markup characters. Include Markdown export as a downstream consumer. | D |
| [CodeQL: changelog entity decoding](https://github.com/getsentry/sentry-content-dashboard/pull/15#discussion_r4032895709) | Same repeated entity-decoding defect. | D |
| [CodeQL: mock URL match, line 19](https://github.com/getsentry/sentry-content-dashboard/pull/15#discussion_r4032895713) | Test-only routing, not production host validation. Exact origin matching is nevertheless a clearer mock contract. | E |
| [CodeQL: mock URL match, line 38](https://github.com/getsentry/sentry-content-dashboard/pull/15#discussion_r4032895717) | Same test-only issue. | E |
| [CodeQL: mock URL match, line 64](https://github.com/getsentry/sentry-content-dashboard/pull/15#discussion_r4032895721) | Same test-only issue. | E |

The feedback helper classified the lock comment as high; the comment itself labels it medium. Implementation priority below follows failure impact, rather than relying on that automated bucket.

## Implementation order and acceptance criteria

### A. Guarantee independent cleanup attempts

Change `src/utils/changelogStorage.ts` so lock removal runs even when temporary-file removal fails. Preserve the original write/rename error when cleanup also fails, and surface cleanup failures without falsely claiming the lock was released. Do not delete another writer's lock or change atomic rename behavior.

Regression coverage: inject temporary cleanup failure and assert lock removal is attempted; inject write/rename failure plus cleanup failure and assert the primary cause survives; verify the next writer succeeds when release succeeds. Keep concurrent merge, retry deduplication, corrupt-history, and inaccessible-storage tests passing.

### B. Bound public YouTube refreshes across every entry point

Treat browser `refresh=1` as a request for revalidation, not permission to bypass server quota policy. Enforce a source-wide minimum interval and an explicit quota budget immediately before quota-consuming YouTube calls, shared across workers through atomic Redis admission. Derive the configured budget from the actual project's allocation and endpoint costs; a generic per-IP limit or the existing 30-second freshness window is insufficient protection.

Apply the same policy to `/api/content`, `/api/youtube`, and Markdown export. Reserve allowance before requesting upstream, including failed calls. Keep cached YouTube data visible when admission is denied, report that refresh was deferred, and settle the source state rather than leaving an updating banner. Where no cached data exists, show YouTube as unavailable while other sources render. Use a local limiter for local development; if production shared admission is unavailable, do not bypass it with unrestricted YouTube requests.

Preserve first-visit revalidation for other sources and immediate ingestion visibility for docs. YouTube's bounded freshness must be documented and visible; the page must not claim a new upstream check when it served a cached response. This is a deliberate constraint on external revalidation, not a return to requiring hard refreshes.

Regression coverage: sequential forced requests, concurrent callers in one worker, two workers, cooldown boundary, quota exhaustion/reset, failed upstream requests, Redis outage, and all three entry points. Assert actual upstream call counts. Test that other sources remain available and normal first visits still discover newly ingested docs. Remove the adjacent existing API-key-prefix log in `config.ts`; verify configuration diagnostics use presence flags only.

### C. Separate latency, coordination, and transport failures

Introduce explicit outcomes for a slow snapshot read, lease contention, lost ownership, upstream failure, and Redis transport failure. Only actual store outages should trip the shared outage backoff. Lease contention must not start an uncoordinated duplicate upstream call; lease loss must never overwrite a newer owner's data or unlock its lease.

Keep the quick snapshot-delivery path, but distinguish its soft latency deadline from Redis connection health. Allow a late successful read to warm the cache without replacing a newer snapshot; recover shared coordination as soon as the connection is usable. Bound connection/command and lease-wait work. The combined wait plus upstream fetch must fit within the existing 25-second browser timeout and 30-second route budget; today an 18-second lease wait followed by a 15-second fetch can exceed both.

Preserve already-loaded upstream results when an optional cache write fails; never refetch solely because publication failed. Ensure unlock failures do not conceal the original upstream error. Keep the special YouTube admission policy from B effective during fallback.

Regression coverage: Redis connects after 400 ms; late success and late rejection; two cold workers; contention without duplicate loads; one source loses a lease while another still reads/writes Redis; real transport outage and recovery; write failure after successful fetch; newer snapshot ordering; bounded end-to-end completion. Retain the existing owner-token tests. Add an isolated real-Redis integration check for NX/PX expiry and Lua ownership semantics because command mocks do not establish actual Redis behavior.

### D. Replace feed stripping/decoding with explicit text extraction

Use a shared server-only parser helper, using the existing parser dependency where suitable. Parse the XML envelope and extract text according to its representation: XML text, CDATA-contained HTML, and Atom text/html/xhtml fields. Decode once per actual encoding layer; do not repeatedly decode until a string stops changing. Remove script/style nodes when extracting HTML text. Preserve literal angle brackets in code examples as text.

Keep the browser's escaped React text rendering. Handle Markdown output as its own format: escape feed-supplied text at export boundaries so literal HTML/Markdown cannot silently become active markup in downstream renderers. Preserve link targets and existing item IDs, dates, categories, author fields, RSS/Atom support, and conditional 304 behavior. Do not bundle the parser into the browser.

Regression coverage: multiline CDATA; named/numeric entities; double-encoded literal entities; malformed/nested tags; script/style content; RSS and Atom variants; literal code examples; escaped export output. Use representative feed fixtures and compare item count, stable IDs, dates, and categories before/after. Include a browser assertion that hostile-looking text is displayed without creating injected elements.

### E. Make mock routing exact

Replace all three `includes('api.github.com')` conditions with parsed exact HTTPS origin matching. Reject unexpected mock destinations instead of treating every other URL as the webhook.

Regression coverage: rerun all polling tests; verify deceptive domains, userinfo URLs, and path/query strings containing `api.github.com` cannot select the GitHub mock. Preserve pagination, oldest-first delivery, bootstrap recovery, and checkpoint behavior.

## Checks and deployment configuration

- CodeQL analysis completed successfully, but its alert gate failed on the seven findings listed above. Re-run the gate after D/E; do not suppress the queries to make it green.
- `Vercel – sentry-content-dashboard` passed and published a preview. `Vercel – sentry-content-aggregator` failed because a separate Vercel team's Protected Git Scope excludes `getsentry`. This is a deployment configuration issue, not a code/build failure. Confirm whether that second integration is intended; its owner must authorize the scope if needed or disconnect the obsolete project if not. Do not change organization permissions merely to clear the check.
- Secret Scan, dependency review, Warden workflow execution, and both Socket checks passed. Neutral review checks still contain actionable comments; neutral does not mean their findings are fixed.
- There is no repository-owned `.github/workflows` test/build workflow in this checkout, and the current 13 checks do not run the regression suite. Add a PR validation workflow with pinned Node major compatible with this app, `npm ci`, regression tests, lint, and production build without production secrets. Include the isolated Redis service for integration coverage.

## Regression gates and completion criteria

Baseline on this head: 33 tests and lint pass. The production build and local first-visit browser verification passed during the preceding implementation; rerun them on the final fixes rather than treating that older result as proof for new code.

1. Add a failing behavioral regression for each confirmed bug, then make the smallest targeted fix. Keep A, B/C, and D/E reviewable as separate logical changes, with B/C validated together because quota protection depends on fallback behavior.
2. Run focused tests after each group, then the complete suite, lint, type validation through the production build, and diff checks. Confirm no credentials, test data, or generated artifacts entered the diff.
3. Exercise a production build in a browser: ordinary first visit after adding content, slow source, failed source, quota deferral, stale snapshot replacement, tab return, back/forward restore, cancellation, export, filters/search, and self-hosted fonts. Verify all pending states settle and existing content stays visible on partial failure.
4. Recheck initial JavaScript size and request counts against the prior 217,089-byte gzip measurement and one browser content stream. Report measured changes; avoid claiming production speedups from local samples.
5. Preserve Sentry errors, logs, spans, and eagerly initialized unmasked Replay. Test instrumentation paths and separately verify receipt in the intended Sentry environment when deployed; mocked SDK tests do not prove delivery.
6. After pushing fixes, inspect checks and every review thread on the exact new head, reply with fix/test evidence or a precise false-positive explanation, and perform a final feedback fetch after checks settle. Re-run verification for any further changes. Resolve threads only when the underlying concern is addressed.
7. Report deployment permission gates separately if they remain. Do not describe the PR as fully green while that check is still failing.

No test suite can guarantee zero regressions. Completion requires the behavioral checks above, actual CI results for the final commit, and explicit disclosure of any unverified deployment behavior.

## Implementation results

The planned runtime fixes are implemented. Shared YouTube admission defaults to
one attempt per 20 minutes and 90 per rolling 24 hours; production admission fails
closed without working Redis. Deferrals retain original snapshot timestamps and
are labeled in the dashboard, source response headers, and exports. No private
credentials were added. Existing API-key-prefix diagnostics were removed.

Redis reads retain their soft display deadline without declaring an outage; late
results cannot replace newer snapshots. Lease contention/loss is separate from
transport failure. A worker can wait for an owner for 18 seconds, but cannot begin
a new upstream fetch after the first 2.5 seconds. Local file cleanup always attempts
lock release and retains the primary failure. Feed parsing and Markdown escaping
are shared helpers with representation-specific tests. All three mock origin
checks are exact, and a PR validation workflow now runs tests, lint, build, and
isolated Redis integration tests.

Local production browser checks showed all 51 existing items; a temporary 52nd docs
item appeared on an ordinary new visit, was searchable, and displayed HTML-looking
text literally. Markdown export escaped the same text and retained its partial-source
warning. The test fixture was restored byte-for-byte. The new JavaScript gzip size
is 217,201 bytes versus 217,089 before these fixes (+112 bytes). The production build
and lint pass. Live production Redis and post-deployment telemetry delivery remain
separate from this local evidence. Sentry SDK/replay configuration is unchanged.

### Follow-up automated review

Two additional cold-start/lease-wait findings were reproduced and fixed: forced
refreshes now use a request-start freshness boundary when the initial shared read
times out, and coordination-busy outcomes do not apply an upstream failure backoff.
Busy results preserve labeled content; immediate retries can read an owner's new
snapshot. A real-Redis regression includes a 650 ms initial read with old cached
content and verifies first-visit revalidation still occurs.

A further review suggested 304 results could retain deferral status. Deferral
results were already response-only, not stored; an added regression proves that.
Successful refresh snapshots now explicitly select data/validator fields, so even
a legacy input carrying response-only metadata cannot persist those flags on 304.

Final local validation after follow-up fixes: all 72 tests (including four real-Redis
integration cases), lint, and production build pass.

The final cold-cache matrix also verifies that background/export reads reuse
recent shared snapshots, while first visits revalidate. Coordination passes its
observed snapshot into loaders for conditional validators and quota fallback;
deferral also checks for a late-published snapshot. Partial stream timeout and
protocol errors now report their underlying exception to Sentry while retaining
delivered content. Intentional cancellation remains unreported.

The next review identified per-item feed failures. Relative links now resolve
against known feed URLs and Atom base URLs. Invalid links/dates are isolated and
reported, valid entries survive, and an entirely invalid feed still fails closed.
Two additional parsing regressions pass, including assertions for skip telemetry;
lint and the production build pass after this change.

Missing repository commit dates now fall back to GitHub's canonical Git commit
object, with SHA matching and valid-date checks. Historical dates are preserved;
non-documentation commits skip date recovery. Four new regressions cover nullable
metadata, committer fallback, corrupt/mismatched objects, and irrelevant commits.

Concurrent forced visits now upgrade pending background cache reads. They reuse
an actual fresh upstream result, but revalidate if the background request only
returned saved content. Forced callers share the upgrade promise; quota/busy
results remain explicit. Two regressions cover both orderings without duplicate
upstream requests.

Undated RSS/Atom entries are now reported and skipped, preserving historical
chronology. The suggestion to bypass a concurrent failed refresh is intentionally
not applied: force bypasses freshness, not failure backoff or quota protection.
A regression verifies one shared failure, backoff, and successful later retry.
