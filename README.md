# Sentry Content Terminal 🎮

A retro 8-bit video game styled content aggregator that brings together the latest content from Sentry's blog, YouTube channel, and documentation.

## ✨ Features

- **🎥 YouTube Integration** - Real-time videos from Sentry's official channel
- **📝 Blog Aggregation** - Latest posts from blog.sentry.io
- **📚 Documentation Monitoring** - Track documentation changes with AI-powered summaries
- **🤖 AI Summaries** - ChatGPT generates user-friendly summaries of docs updates (optional)
- **📊 Analytics** - Vercel Analytics tracks visitor metrics and popular content
- **🎮 Retro Gaming UI** - 8-bit pixel art aesthetic with neon colors
- **🔍 Content Filtering** - Filter by source type (All, Blog, YouTube, Docs) and category (Gaming, Mobile, Web, Technical, Business)
- **📱 Responsive Design** - Works on all devices
- **⚡ Real-time Updates** - Fresh content every time you visit

## 🚀 Quick Start

### Prerequisites

- Node.js 18+ 
- npm or yarn
- YouTube Data API v3 key

### Installation

1. **Clone the repository**
   ```bash
   git clone <your-repo-url>
   cd sentry-content-aggregator
   ```

2. **Install dependencies**
   ```bash
   npm install
   ```

3. **Set up environment variables**
   ```bash
   cp config.example.ts config.ts
   # Edit config.ts with your YouTube API key
   ```

4. **Create .env.local**
   ```bash
   echo "YOUTUBE_API_KEY=your_actual_api_key_here" > .env.local
   # Optional: Add OPENAI_API_KEY for AI-powered doc summaries
   ```

5. **Seed the docs changelog**
   ```bash
   npm run seed-docs
   ```

6. **Run the development server**
   ```bash
   npm run dev
   ```

7. **Open your browser** to `http://localhost:3000`

## 🔧 Configuration

### YouTube API Setup

1. Go to [Google Cloud Console](https://console.cloud.google.com/)
2. Create a new project or select existing one
3. Enable YouTube Data API v3
4. Create credentials (API Key)
5. Add the API key to your `.env.local` file

### Content Sources

- **Blog**: Automatically fetches from `https://blog.sentry.io/feed.xml`
- **YouTube**: Uses your API key to fetch from Sentry's official channel
- **Documentation**: Tracks commit history from `getsentry/sentry-docs` with optional AI summaries

### AI-Powered Doc Summaries (Optional)

Enable ChatGPT to generate user-friendly summaries of documentation changes:

1. Get an OpenAI API key from [OpenAI Platform](https://platform.openai.com/api-keys)
2. Add to `.env.local`:
   ```bash
   OPENAI_API_KEY=sk-your-actual-api-key-here
   ```
3. Run `npm run seed-docs` to generate summaries

See [AI_SUMMARIES.md](./AI_SUMMARIES.md) for detailed setup instructions and examples.

## Sentry error monitoring

The Next.js SDK captures browser, Node.js, and Edge errors and traces. Caught API,
storage, and content-loading errors are reported explicitly. Traces are sampled at
100% in development and 10% in production. Structured Sentry logs record content-load
outcomes and documentation ingestion failures without forwarding raw console output.
Session Replay captures 100% of development sessions, 10% of production sessions,
and 100% of sessions with errors. Replay records public page text, input values, and attributes without masking,
and displays media. Network body capture remains disabled. This applies to new
recordings after deployment; existing masked recordings cannot be unmasked.

1. Copy `.env.example` to `.env.local` and fill in `NEXT_PUBLIC_SENTRY_DSN` from the
   intended Sentry project's **Settings → Client Keys (DSN)**. Server and Edge use
   that DSN too; `SENTRY_DSN` is an optional override.
2. Set `NEXT_PUBLIC_SENTRY_ENVIRONMENT` and `SENTRY_ENVIRONMENT` to the same value
   (`development`, `preview`, or `production`). Restart development after changing them.
3. For readable production stack traces, set `SENTRY_ORG`, `SENTRY_PROJECT`, and
   the secret `SENTRY_AUTH_TOKEN` in the build environment. Source map upload is
   disabled without that token. Never prefix the token with `NEXT_PUBLIC_`.
4. Add these variables to the appropriate Vercel environments **before rebuilding**:
   browser DSN/environment values are embedded at build time. The Sentry build plugin
   detects the release from the Git SHA; set `SENTRY_RELEASE` to an immutable build ID
   if Git metadata is unavailable.

Initialization lives in `src/instrumentation-client.ts`, `src/sentry.server.config.ts`,
and `src/sentry.edge.config.ts`, with shared sampling/privacy options in
`src/utils/sentryOptions.ts`. Missing DSNs disable event delivery. Request bodies,
headers, cookies, query values, AI input/output, local variables, and console
breadcrumbs are excluded from telemetry.

To verify a configured project, run the app and trigger a temporary deliberate error
through a route or a button handler (not the browser console). Confirm its unique
message and readable stack frames in Sentry, then remove the trigger. A passing
build or local transport check alone does not establish that Sentry received it.

See [Sentry's Next.js setup guide](https://docs.sentry.io/platforms/javascript/guides/nextjs/manual-setup/).

## 🏷️ Content Categories

The app automatically categorizes content into 5 main categories:

- **🎮 Gaming** - Unity, Godot, game development, and gaming SDKs
- **📱 Mobile** - iOS, Android, Flutter, React Native, and mobile development
- **🌐 Web** - JavaScript, React, Node.js, and web development
- **⚙️ Technical** - SDKs, APIs, tutorials, and development guides
- **💼 Business** - Product announcements, company news, and business updates

Content is automatically categorized using intelligent keyword matching and can appear in multiple categories for better discoverability.

## Documentation ingestion and monitoring

Run `npm run monitor-docs` to check the sitemap locally. The first successful run
records a baseline of URLs without presenting old pages as new. Later runs add
new pages; failed downloads stay pending for retry. Preserve `data/docs-pages.json`
between runs. This project does not include a deployed daily sitemap schedule.

For GitHub commit monitoring, copy **all** of `monitoring-repo/` into a dedicated
monitoring repository, including `poll-github.cjs` and the workflow. See its README
for secrets and write permissions. It runs every 15 minutes and persists its
checkpoint in Git. Local alternatives are `npm run poll-github` (continuous) and
`node scripts/cron-check.js` (one run); both share
`data/github-polling-state.json`. Run only one local poller at a time and preserve
that file. They require `GITHUB_WEBHOOK_SECRET` and `WEBHOOK_URL`; `GITHUB_TOKEN`
is recommended for GitHub API limits. First run ingests the newest ten commits,
then subsequent runs paginate back to the saved checkpoint. Bootstrap batches
are persisted before delivery, so a first-run failure is also retryable.

On upgrading from the old cron script, copy the SHA from `data/last-commit-sha.txt`
into `data/github-polling-state.json` as `{"lastProcessedSha":"<40-character SHA>"}`
before starting the new poller to retain its boundary. A missing checkpoint in
GitHub history fails explicitly; reconcile it after a force-push before retrying.

Set `GITHUB_TOKEN` and a nonempty `GITHUB_WEBHOOK_SECRET` on the application.
Unsigned webhooks are rejected. Manual ingestion uses a separate
`GITHUB_TRIGGER_SECRET` and requires `Authorization: Bearer <token>` on
`POST /api/github/trigger`; it processes the newest ten commits and reports results.
`npm run test-github` reads that token from the environment.

Production on Vercel requires `REDIS_URL`; writes atomically merge into the existing
`docs-changelog` JSON key. Local storage uses an exclusive directory lock and
atomic rename. Storage corruption/read failures are surfaced rather than treated
as empty history. If a local writer is killed, stop all app/ingestion processes,
back up `data/docs-changelog.json`, then remove the abandoned
`data/docs-changelog.json.lock` directory before restarting. Never remove a live
writer's lock. Failed deliveries retry safely; saved commit IDs are deduplicated.

Each dashboard visit uses one streaming `GET /api/content?refresh=1` request.
Available source snapshots appear immediately; independent sources refresh in
parallel and update the same page as each completes. A slow or unavailable source
does not hide the others, and the page identifies sources still updating or failed.
First visits and manual retries revalidate even recent snapshots, subject to the
shared YouTube quota policy below. Background tab
returns are throttled to once per 30 seconds and reuse snapshots younger than
30 seconds. Documentation is reread on each server refresh so ingestion changes
remain visible. Snapshots older than 24 hours are discarded.

Source refreshes are shared with individual source APIs and Markdown exports.
With `REDIS_URL`, normalized snapshots and 18-second refresh leases coordinate
workers; locally an in-memory worker cache coalesces simultaneous requests.
Redis snapshot reads have a 400 ms soft display deadline; late results still warm
the worker cache and a slow read does not disable shared coordination. Actual
transport failures back off for 15 seconds. Lease contention/loss does not disable
other sources. Workers wait up to 18 seconds for an existing owner but only acquire
a new lease in the first 2.5 seconds, leaving time for the 15-second upstream fetch.
Redis connection/command timeouts are 1.5 seconds/1 second. Docs storage still
requires working Redis on Vercel. Failed sources back off for 15 seconds per worker,
preserving their last successful snapshot with an explicit refresh warning.
Blog/changelog/YouTube revalidation sends ETag/Last-Modified when supplied by the
upstream, allowing unchanged bodies/parsing to be reused. Network cancellation
stops delivery to that viewer while an in-progress shared refresh can still finish.

YouTube requests have an independent shared admission policy immediately before
upstream fetches, including unsuccessful requests. Defaults allow at most one
attempt per 20 minutes and 90 attempts in any rolling 24 hours. Configure
`YOUTUBE_REFRESH_INTERVAL_MS` and `YOUTUBE_MAX_REFRESHES_PER_DAY` to fit the actual
project allocation and other consumers of the same API project. Google's
[quota documentation](https://developers.google.com/youtube/v3/determine_quota_cost)
currently lists a default separate allowance of 100 search requests per day.
All public entry points, including forced streams and exports, share the policy.
Production requires Redis admission; Redis outages never permit unrestricted
YouTube calls. Local development uses an in-process admission window.

A denied refresh preserves saved content and its original fetched timestamp.
The dashboard and export label deferred refreshes, and `/api/youtube` includes
`X-Content-Refresh: deferred` and `Retry-After` headers. Without a saved snapshot,
YouTube is reported unavailable while healthy sources continue loading.

RSS/Atom parsing uses a shared server-only XML/HTML parser. Each representation is
decoded once, React renders extracted content as text, and exports escape text at
the Markdown boundary. Literal code examples remain readable.

Run `npm test`, `npm run lint`, and `npm run build` before publication. The Validate
workflow runs these on PRs with an isolated Redis service. To include real-Redis
tests locally, set `REDIS_TEST_URL` to an **isolated test database**; those tests use
`content:v1:blog` keys and must never target application data. Without that variable,
the two Redis integration cases are explicitly skipped.

The initial page fonts are self-hosted under `public/fonts/`, with their licenses.
Replay remains eagerly initialized and unmasked; Logs and tracing stay enabled.
Only internal Sentry debug code is removed from the production bundle. Dates use
native Intl formatting instead of loading a browser date-formatting dependency.
Stable source IDs preserve existing cards across refreshes.

Dashboard and Markdown export retain healthy sources when another is unavailable
and identify missing sources. If every source fails and no usable snapshot exists,
the dashboard shows an error; an all-failed export returns HTTP 503.


## 🎨 Customization

### Retro Gaming Theme

The app uses a custom 8-bit video game aesthetic:

- **Fonts**: Press Start 2P (headings), VT323 (body text)
- **Colors**: Neon green, blue, red, cyan, and yellow
- **Effects**: Pixel borders, glowing text, scanning animations
- **Layout**: Card-based grid with hover effects

### Styling

All custom styles are in `src/app/globals.css`:

- `.pixel-border` - Pixel art borders
- `.retro-button` - Gaming-style buttons
- `.pixel-text` - Text with pixel shadows
- `.retro-scanner` - Loading animations

## 🚀 Deployment

### Vercel (Recommended)

1. **Push to GitHub**
2. **Connect to Vercel** at [vercel.com](https://vercel.com)
3. **Import your repository**
4. **Add environment variables**:
   - `YOUTUBE_API_KEY`: Your YouTube API key
5. **Deploy** - Vercel will auto-detect Next.js

### Environment Variables for Production

- `YOUTUBE_API_KEY`: Required for YouTube integration
- `NEXT_PUBLIC_APP_URL`: Your app's public URL

## 📁 Project Structure

```
sentry-content-aggregator/
├── src/
│   ├── app/
│   │   ├── api/
│   │   │   ├── blog/          # Blog RSS feed API
│   │   │   ├── youtube/       # YouTube API integration
│   │   │   └── docs/          # Documentation API
│   │   ├── globals.css        # Retro gaming styles
│   │   ├── layout.tsx         # App layout
│   │   └── page.tsx           # Main content page
│   └── ...
├── scripts/
│   └── monitor-docs.js        # Docs monitoring script
├── .github/
│   └── workflows/
│       └── (see monitoring-repo/ for the separate monitoring workflow)
├── data/
│   └── docs-pages.json        # Discovered docs storage
└── config.ts                  # App configuration
```

## 🔍 Content Filtering

The app provides powerful filtering capabilities:

### Source Filtering
- **All Content** - View everything from all sources
- **Blog Posts** - Only blog articles from Sentry
- **YouTube Videos** - Only video content
- **Documentation** - Only technical docs
- **Changelog** - Only product updates

### Category Filtering
- **All Categories** - View content from any category
- **Gaming** - Game development and gaming SDK content
- **Mobile** - Mobile app development content
- **Web** - Web development and frontend content
- **Technical** - SDKs, APIs, and development guides
- **Business** - Product announcements and company news

### Combined Filtering
You can combine source and category filters to find exactly what you're looking for. For example, show only technical blog posts or gaming-related videos.

## 🔍 API Endpoints

- `GET /api/blog` - Blog posts from RSS feed
- `GET /api/youtube` - YouTube videos from Sentry channel
- `GET /api/docs` - Documentation pages discovered by monitoring

## 🤝 Contributing

1. Fork the repository
2. Create a feature branch
3. Make your changes
4. Test thoroughly
5. Submit a pull request

## 📝 License

This project is open source and available under the [MIT License](LICENSE).

## 🙏 Acknowledgments

- **Sentry** for the amazing monitoring platform and content
- **Next.js** for the powerful React framework
- **Tailwind CSS** for the utility-first styling
- **Google** for the YouTube Data API

---

**Ready to monitor Sentry content like it's 1989! 🕹️✨**
