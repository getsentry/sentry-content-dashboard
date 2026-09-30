import type { NextConfig } from "next";
import { withSentryConfig } from "@sentry/nextjs/config";

const nextConfig: NextConfig = {
  async headers() {
    return ['content', 'blog', 'youtube', 'docs', 'changelog', 'customers', 'docs/feed', 'export/markdown'].map(route => ({
      source: `/api/${route}`,
      headers: [{ key: 'Cache-Control', value: 'no-store, no-transform, max-age=0' }],
    }));
  },
  images: {
    remotePatterns: [
      {
        protocol: 'https',
        hostname: 'i.ytimg.com',
        port: '',
        pathname: '/**',
      },
      {
        // Customer story card images
        protocol: 'https',
        hostname: 'sentry.io',
        port: '',
        pathname: '/**',
      },
      {
        // Video thumbnails on customer story cards
        protocol: 'https',
        hostname: 'i.vimeocdn.com',
        port: '',
        pathname: '/**',
      },
    ],
  },
};

export default withSentryConfig(nextConfig, {
  org: process.env.SENTRY_ORG,
  project: process.env.SENTRY_PROJECT,
  authToken: process.env.SENTRY_AUTH_TOKEN,
  silent: !process.env.CI,
  widenClientFileUpload: true,
  webpack: { treeshake: { removeDebugLogging: true } },
  sourcemaps: {
    disable: !process.env.SENTRY_AUTH_TOKEN,
    deleteSourcemapsAfterUpload: true,
  },
});
