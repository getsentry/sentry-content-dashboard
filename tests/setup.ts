import { vi } from 'vitest';
// Unit tests execute loaders directly; persistent caching is verified in Next.
vi.mock('next/cache', () => ({ unstable_cache: (fn: unknown) => fn }));
vi.mock('@sentry/nextjs', () => ({ captureException: vi.fn(), startSpan: vi.fn((_options, callback) => callback()), logger: { info: vi.fn(), error: vi.fn(), warn: vi.fn() } }));
