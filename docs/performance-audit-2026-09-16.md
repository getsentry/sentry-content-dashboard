# Performance audit — September 16, 2026 (Pacific)

Audited the current working tree and Sentry project `sentry/sentry-content-dashboard` through its MCP. This is an audit; no application behavior or sampling settings were changed.

## Evidence and limits

The 30-day page-load search returned **two recorded page loads**, both `http://127.0.0.1:3100/`. The broader 7-day server-span search returned 11 individual spans, including the removed verification endpoint. There is no representative deployed-user dataset here. Both page loads have `environment=development` and the same release, `229b9eaae464708479c2c55cd3e976440a176d0b`, despite intervening uncommitted code/build changes. `.env.local` explicitly sets `NEXT_PUBLIC_SENTRY_ENVIRONMENT=development`; sampling separately uses NODE_ENV (100% development, 10% production builds). Therefore environment alone does not distinguish a dev server from a local production build.

Aggregate results report count=10 for the newer page load while the individual query returns one matching span. These are sample-weighted estimates, not ten independent observations. Do not use their p95 as a production baseline. [Sentry explains extrapolation](https://sentry.zendesk.com/hc/en-us/articles/40155771510299-Why-are-my-Trace-tab-counts-different-than-my-Stats-tab-counts).

[Page-load search in Sentry](https://sentry.sentry.io/explore/traces/?project=4512099443998720&query=span.op%3Apageload&statsPeriod=30d&table=span)

| Observation | Earlier local trace | Newer local production-build trace |
|---|---:|---:|
| Page-load span | 8,141 ms | 268 ms |
| LCP | 7,888 ms | 392 ms |
| TTFB | 4,290 ms | 2.1 ms |
| Dashboard load function | 3,231 ms | 221 ms |
| Browser → changelog API | 3,549 ms | 217 ms |
| Browser → blog API | 3,382 ms | 121 ms |
| Browser → docs API | 3,317 ms | 53 ms |
| Browser → YouTube API | 3,224 ms | 20 ms; configured source unavailable |

[Earlier trace](https://sentry.sentry.io/explore/traces/trace/91c8eb39211e45a9a4579ddeb1ebb782) · [Newer trace](https://sentry.sentry.io/explore/traces/trace/4facd3a39d704b739f4cce4a3f04983e)

These are different local runs/build states, not a controlled before/after benchmark. The earlier trace predates the fixes in this working tree.

## What explains the slow trace

The earlier `GET /` spends 4,292 ms in a span named `NextNodeServer.clientComponentLoading`. Its API server spans take 3.2–3.5 seconds, but their actual route-execution spans take only 18 ms (YouTube), 29 ms (docs), 252 ms (blog), and 359 ms (changelog). External feed spans take 239 ms and 338 ms. This places most of the delay before handler execution and is consistent with development cold compilation/module startup. The trace does not identify the precise compiler/CPU cause, so it is not proof of a production cold-start problem.

The newer trace's changelog handler takes 190 ms, including a 158 ms upstream request. Blog takes 118 ms, including 102 ms upstream. Feed I/O dominates these normal handler paths. Docs is 31 ms and YouTube fails quickly at 8 ms. There is no evidence that Redis or AI summaries explain these page-load delays.

The trace overview also includes downstream spans from the external Sentry website. A span is not necessarily another request initiated by this app. Browser request, server handler, framework child span, and external fetch can all describe parts of the same operation. Do not sum nested/overlapping spans as elapsed time or call each one a duplicate request.

## Parallel requests: keep the concurrency, remove unnecessary work

All four sources are independent and the default view displays all of them. Four parallel source requests are reasonable. The newer trace contains one browser request to each source, not duplicate copies. Its rough serialized request budget would be 217 + 121 + 53 + 20 = **411 ms**, versus the observed 221 ms dashboard load. This arithmetic is illustrative, not a measured serialization result.

A separate small, read-only local production-build comparison used six runs in order:

| Run | Mode | Total | Changelog request |
|---|---|---:|---:|
| 1 | Parallel, first after server startup | 1,080 ms | 1,057 ms |
| 2 | Sequential | 188 ms | 109 ms |
| 3 | Sequential | 181 ms | 112 ms |
| 4 | Parallel | 140 ms | 139 ms |
| 5 | Parallel | 124 ms | 123 ms |
| 6 | Sequential | 362 ms | 311 ms |

The first run shows startup/upstream variability; it must not be compared directly against warmed sequential runs. Warmed observations favor concurrency, but six local runs are not a statistical benchmark. All had an unavailable YouTube source. Payloads were small: blog 7,326 bytes, docs 8,356 bytes, changelog 8,897 bytes, YouTube error 110 bytes. Request bytes are not the principal concern in this sample.

## Ranked changes

### 1. Stop making every view fetch and parse the upstream feeds again

**Largest likely reduction in backend work and latency variability. High confidence in the code path; production savings unmeasured.**

`src/utils/loadDashboardContent.ts:6`, `src/app/api/blog/route.ts:33`, `src/app/api/changelog/route.ts:54`, and `src/app/api/youtube/route.ts:80` use no-store. `src/app/page.tsx:82` reloads all sources whenever the tab becomes visible, with only an in-flight guard, no freshness interval. Export independently invokes all loaders again (`src/app/api/export/markdown/route.ts:21`). The configured one-hour cache in `config.ts` is unused.

The preceding freshness fix deliberately bypassed caches but was broader than necessary. Preserve automatic freshness while avoiding duplicate work:

- Store normalized per-source snapshots with `fetchedAt`, version, and availability.
- Share an in-progress upstream refresh between requests; use distributed coordination if multiple server instances must share it.
- Show the latest snapshot immediately, revalidate automatically, and update the same visit when newer data arrives. Do not restore a cache policy that only refreshes for the next visitor.
- Use conditional upstream requests with ETag/Last-Modified where supported; still account for network latency on a 304.
- Refresh only stale sources on tab return, with a small explicit freshness interval and retry/backoff for unavailable sources. First visits can always revalidate.
- Share snapshots/loaders with export. A background ingestion design can ultimately remove external feed calls from the page's critical path, with its freshness budget visible and documented.

In the newer trace, removing an upstream refresh from the critical path could avoid the measured 158 ms changelog fetch; that is an opportunity, not a promised end-to-end saving. It also avoids every visitor independently repeating the same work.

### 2. Render each source when ready instead of waiting for every source

**Highest-confidence improvement to time until useful content, especially during upstream slowness.**

`src/utils/content.ts:42` waits for Promise.allSettled before returning any items. `src/app/page.tsx:168` displays only the loader until the whole batch completes. A source can wait up to the browser's 20-second deadline; upstream fetches have a 15-second timeout. Partial-failure handling prevents a total crash, but does not make partial content appear early.

Publish source results incrementally, with per-source loading/error state and stable sorting. In the newer trace, docs were ready at about 53 ms and blog at 121 ms, but the overall load lasted 221 ms. Earlier visibility could save roughly 168 ms for docs in that instance; a stalled source could make the difference seconds. Preserve a separate metric for fully refreshed content, rather than presenting partial completion as a faster full load.

### 3. Evaluate one streaming server read endpoint, not sequential browser requests

**Potential infrastructure simplification; do after the first two improvements.**

A shared `/api/content` endpoint could reduce four browser requests/serverless entrypoints to one while keeping independent upstream I/O concurrent. Stream source results or deliver a stored snapshot followed by revalidation. A plain aggregate JSON response that still waits for all feeds will retain the slowest-source bottleneck. Do not turn initial server rendering into a blocking dependency on every external service.

Browser script/CSS parallelism is also normal. Reducing the number of requests blindly would not address the pre-handler delays in the old development trace.

### 4. Fix unstable item keys before increasing refresh frequency

**Confirmed unnecessary rendering work; CPU impact not profiled.**

Blog and changelog generate IDs with Date.now()/Math.random() (`src/app/api/blog/route.ts:107` and both parsing branches of `src/app/api/changelog/route.ts`). Cards use `key={item.id}` at `src/app/page.tsx:585`. Identical feed data therefore replaces the cards on every refresh. Use stable feed GUIDs or source+canonical URL. Then memoize derived stats/cards if profiling shows a benefit. Do not prioritize virtualization for the observed 51-item dataset without evidence.

### 5. Reduce initial client work while retaining Sentry signals

**Measured asset size; runtime attribution remains a hypothesis.**

The current production build's unique initial page/layout JavaScript files total **223,686 bytes gzipped locally**. This is an artifact-size measurement, not actual network transfer on a cached browser. One shared chunk alone is 106,118 gzipped bytes; it contains Sentry code, but string inspection is not sufficient to attribute the entire chunk to Sentry or Replay.

The entire dashboard is a client component, so data fetches start after JavaScript initialization. Replay is installed eagerly (`src/instrumentation-client.ts:11`), fonts use a Google CSS @import (`src/app/globals.css:2`), and cards use blur/shadows. The earlier trace includes one 180 ms long-animation-frame span, but there are no CPU profiles establishing its cause.

Use a bundle analyzer and a mobile CPU/network capture before choosing changes. Consider self-hosted fonts, splitting heavier optional UI, and a small server-rendered shell/snapshot. Evaluate lazy Replay only with explicit coverage checks: deferring the recorder can lose initial-page/pre-error context, and logs/replays/spans remain a requirement. Keep error/tracing initialization early.

### 6. Avoid repeated requests to disabled YouTube

**Confirmed unnecessary request, modest latency benefit in this sample.**

The API key is absent; every page load still requests `/api/youtube` and gets 500. Make configured-source availability part of the server snapshot so the client can display “not configured” without repeatedly requesting it, or configure the key. Keep transient outages retryable. The current 20 ms failed browser request is not the dominant 221 ms critical path, and real YouTube latency remains untested.

### 7. Treat ingestion latency separately from page viewing

**Code-level risk, not an observed trace bottleneck.**

Manual/webhook ingestion awaits GitHub details, optional OpenAI summaries, and durable storage for each commit in sequence. This preserves order/checkpoint correctness, but could become slow with a backlog. If production ingestion traces confirm this, move processing into a durable queue, acknowledge only after enqueue, use bounded workers, and keep idempotency/checkpoint guarantees. Do not parallelize polling deliveries blindly. No matching DB/GenAI spans were returned by the 7-day query, and no production ingestion-latency conclusion is justified.

## Measurement work required for a production decision

- Separate localhost development, local production-build testing, preview, and deployed production using accurate environment/build tags. Use an identifiable build version for uncommitted local builds; the current shared release hides code changes.
- Record `content.first_visible`, `content.all_sources_settled`, per-source fetch/parse/storage spans, cache hit/miss, refresh reason, item count, and source availability. Distinguish unavailable/failed from successful results.
- Keep a temporary known sampling rate for controlled tests and account for extrapolation when reporting counts. The browser custom load span in the old failing trace was not equivalent to the newer all-settled implementation.
- Get production traces across cold/warm instances, real geography/devices, successful YouTube, and Redis before claiming p50/p95 improvements. Separate errors and timeouts from successful-response latency.
- The generic profiles search returned a schema error; a follow-up `get_profile` for `/` explicitly returned no profile data in 30 days. CPU attribution is unavailable, not proven negligible.
- Recheck freshness with an upstream change between visits, failure isolation with one stalled feed, request deduplication across simultaneous visitors, and logs/replays/spans after every optimization.

Recommended order: measurement labels → shared source refresh/snapshots + freshness policy → progressive rendering + stable IDs → optional streaming aggregate endpoint → measured bundle/font work. Keep concurrent independent reads.
