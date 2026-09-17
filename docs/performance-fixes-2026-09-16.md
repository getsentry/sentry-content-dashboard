# Performance fixes and verification

Implemented all five priorities from the audit:

1. Shared normalized source snapshots with per-worker in-flight deduplication and Redis snapshots/refresh leases when configured. First visits explicitly revalidate; tab returns and exports reuse recent snapshots. Conditional upstream requests reuse unchanged payloads. Cache read/write outages fall back to the worker cache without discarding healthy upstream results.
2. Progressive source delivery and rendering, including saved snapshots followed by updates within the same visit. Pending/failed sources are identified and partial content survives interrupted streams.
3. Stable blog/changelog IDs based on canonical URLs so unchanged cards retain their identity.
4. One NDJSON `/api/content` stream replaces the four browser requests. Independent server-side source I/O remains parallel. Export and individual APIs use the same source service.
5. Self-hosted font subsets and preload links remove the Google font CSS waterfall. Native Intl date formatting removes the client date-formatting dependency. Internal Sentry debug code is tree-shaken; Logs, tracing, and eagerly initialized unmasked Replay remain enabled.

Freshness policy: first visits/manual retries request revalidation; background refresh is throttled to 30 seconds. Recent source results can be reused for 30 seconds by background reads/exports. Docs is reread on each source refresh. Last-good snapshots expire after 24 hours; failures back off for 15 seconds per worker. Redis leases expire after 18 seconds and ownership is checked atomically before writes/unlock. A disconnected viewer stops consuming the stream without cancelling a refresh shared by other viewers.

## Validation

- 33 regression tests pass, including concurrent callers, two-worker coordination, lost lease protection, cache outages, conditional revalidation, stable IDs, early stream delivery, stale-to-fresh replacement, chunk boundaries, and truncated streams.
- ESLint and the production build (including TypeScript validation) pass.
- Local browser verified the 51-item dashboard, updating status clearing, self-hosted fonts, and a temporary new docs item appearing on a normal first visit while another source was still updating. Test data was restored exactly afterward.
- No deployment was performed. Redis lease tests use a Redis command mock, not a live deployed Redis instance.

## Local production-build measurements

These are individual observations, not production percentiles or a controlled before/after latency study. YouTube was unavailable because its API key is missing.

| Request | First useful source/snapshot delivery | Fully settled |
|---|---:|---:|
| Initial forced stream after startup | 112 ms (docs) | 314 ms |
| Forced refresh with existing snapshots | 21 ms | 121 ms |
| Cached background stream | 19 ms | 22 ms |
| Export reusing source results | — | 11 ms |

The first delivery values measure stream receipt, not browser paint. The cold stream delivered docs before the 311 ms blog completion. The warm stream delivered snapshots before refreshed results, and the browser showed updated content without another visit.

Unique initial page/layout JavaScript, measured by gzipping the emitted files: **223,686 → 217,089 bytes**, a reduction of 6,597 bytes (approximately 3%). Next's build summary reports first-load JS **222 → 215 kB**. Font subsets are served locally with the original fonts and licenses; the two Latin faces are preloaded and other subsets remain on-demand.

Sentry configuration retains errors, logs, spans, and unmasked Replay. New source refresh spans and first-content timing logs were added. A follow-up MCP query did not yet return `content.refresh` spans from the short local verification run; backend receipt of these new measurements remains to be verified under known sampling after deployment. Do not interpret these local results as a measured improvement in production Sentry percentiles.
