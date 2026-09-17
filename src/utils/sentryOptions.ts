import type { init } from '@sentry/nextjs';

// Shared settings keep browser, Node.js, and Edge sampling/privacy consistent.
export const sentryOptions = {
  environment: process.env.NEXT_PUBLIC_SENTRY_ENVIRONMENT || process.env.NODE_ENV,
  tracesSampleRate: process.env.NODE_ENV === 'development' ? 1.0 : 0.1,
  enableLogs: true,
  dataCollection: {
    userInfo: false,
    cookies: false,
    httpHeaders: false,
    httpBodies: [],
    urlQueryParams: false,
    genAI: { inputs: false, outputs: false },
    databaseQueryData: false,
    stackFrameVariables: false,
  },
  // Existing console diagnostics include webhook payloads and credential fragments.
  // Keep them out of Sentry breadcrumbs while retaining navigation/HTTP context.
  beforeBreadcrumb(breadcrumb) {
    return breadcrumb.category === 'console' ? null : breadcrumb;
  },
} satisfies NonNullable<Parameters<typeof init>[0]>;
