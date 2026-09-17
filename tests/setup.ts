import { vi } from 'vitest';
vi.mock('@sentry/nextjs', () => ({ captureException: vi.fn(), startSpan: vi.fn((_options, callback) => callback()), logger: { info: vi.fn(), error: vi.fn(), warn: vi.fn() } }));
