import * as Sentry from '@sentry/nextjs';
import { RefreshCoordinationError, RefreshDeferredError } from './cacheErrors';
import { normalizeContent, type ContentSource, type SourcePayload, type SourceSnapshot } from '../utils/content';

export const SOURCE_FRESHNESS_MS = 30000;
export const SNAPSHOT_MAX_AGE_MS = 86400000;
type Loader = (previous?: SourceSnapshot) => Promise<SourcePayload>;
export interface SnapshotStore {
  read(source: ContentSource): Promise<SourceSnapshot | undefined>;
  refresh(source: ContentSource, previous: SourceSnapshot | undefined, load: (observed?: SourceSnapshot) => Promise<SourceSnapshot>, minimumFetchedAt?: number): Promise<SourceSnapshot>;
}

// Shared by API reads, streamed dashboard loads, and exports in each worker.
export class SourceCache {
  private snapshots = new Map<ContentSource, SourceSnapshot>();
  private inFlight = new Map<ContentSource, { force: boolean; task: Promise<SourceSnapshot> }>();
  private storeUnavailableUntil = 0;
  private reads = new Map<ContentSource, Promise<SourceSnapshot | undefined>>();
  private failures = new Map<ContentSource, number>();
  constructor(private loaders: Record<ContentSource, Loader>, private store?: SnapshotStore) {}

  private remember(source: ContentSource, snapshot: SourceSnapshot) {
    const current = this.snapshots.get(source);
    if (!current || snapshot.fetchedAt >= current.fetchedAt) this.snapshots.set(source, snapshot);
    return this.snapshots.get(source)!;
  }

  async read(source: ContentSource) {
    if (this.store && Date.now() >= this.storeUnavailableUntil) {
      let read = this.reads.get(source);
      if (!read) {
        read = this.store.read(source).then(stored => {
          if (stored) this.remember(source, stored);
          return stored;
        }, () => {
          this.storeUnavailableUntil = Date.now() + 15000;
          Sentry.logger.warn('Content snapshot cache unavailable; using worker cache');
          return undefined;
        }).finally(() => this.reads.delete(source));
        this.reads.set(source, read);
      }
      let timer: ReturnType<typeof setTimeout> | undefined;
      try {
        // A soft display deadline is not a Redis outage. Late results warm the cache.
        await Promise.race([read, new Promise<void>(resolve => { timer = setTimeout(resolve, 400); })]);
      } finally { clearTimeout(timer); }
    }
    const snapshot = this.snapshots.get(source);
    return snapshot && Date.now() - snapshot.fetchedAt < SNAPSHOT_MAX_AGE_MS ? snapshot : undefined;
  }

  refresh(source: ContentSource, force = false): Promise<SourceSnapshot> {
    const pending = this.inFlight.get(source);
    if (pending && (!force || pending.force)) return pending.task;
    const requestedAt = Date.now();
    // Upgrade background reads without starting a competing upstream request.
    const work = pending ? pending.task.then(snapshot => {
      if (snapshot.fetchedAt >= requestedAt || snapshot.refreshBusy || snapshot.refreshDeferredUntil) return snapshot;
      return this.update(source, true, requestedAt);
    }) : this.update(source, force, requestedAt);
    const task = work.finally(() => {
      if (this.inFlight.get(source)?.task === task) this.inFlight.delete(source);
    });
    this.inFlight.set(source, { force, task });
    return task;
  }

  private async update(source: ContentSource, force: boolean, requestedAt: number) {
    if ((this.failures.get(source) || 0) > Date.now()) throw new Error(`${source} temporarily unavailable`);
    let previous = await this.read(source);
    const minimumFetchedAt = force || source === 'docs' ? requestedAt : requestedAt - SOURCE_FRESHNESS_MS;
    if (source !== 'docs' && !force && previous && Date.now() - previous.fetchedAt < SOURCE_FRESHNESS_MS) return previous;
    try {
      let loaded: SourceSnapshot | undefined;
      let upstreamFailed = false;
      const load = async (observed?: SourceSnapshot) => {
        // Shared coordination may see a snapshot after our soft read deadline.
        // Carry it into conditional requests and quota fallback, without extending its age.
        if (observed && Date.now() - observed.fetchedAt < SNAPSHOT_MAX_AGE_MS &&
            (!previous || observed.fetchedAt >= previous.fetchedAt)) previous = observed;
        try {
          const payload = await this.loaders[source](previous);
          // Persist source data only; response-only deferral/busy flags are never cached.
          loaded = { items: normalizeContent(payload.items, source), etag: payload.etag,
            lastModified: payload.lastModified, fetchedAt: Date.now() };
          return loaded;
        } catch (error) { upstreamFailed = true; throw error; }
      };
      let snapshot: SourceSnapshot;
      if (this.store && Date.now() >= this.storeUnavailableUntil) {
        try { snapshot = await this.store.refresh(source, previous, load, minimumFetchedAt); }
        catch (error) {
          if (upstreamFailed) throw error;
          if (error instanceof RefreshCoordinationError) {
            // Never bypass another owner's lease with an uncoordinated fetch.
            if (!loaded) throw error;
          } else {
            this.storeUnavailableUntil = Date.now() + 15000;
            Sentry.logger.warn('Content snapshot write unavailable; using worker cache');
          }
          snapshot = loaded ?? await load();
        }
      } else snapshot = await load();
      this.failures.delete(source);
      return this.remember(source, snapshot);
    } catch (error) {
      if (error instanceof RefreshCoordinationError) {
        // Busy is not an upstream failure: read the owner result and allow immediate retry.
        const latest = await this.read(source);
        if (latest && latest.fetchedAt >= minimumFetchedAt) return latest;
        if (latest || previous) return { ...(latest || previous)!, refreshBusy: true };
        throw error;
      }
      if (error instanceof RefreshDeferredError) {
        const saved = await this.read(source) || previous;
        if (saved) return { ...saved, refreshDeferredUntil: error.retryAt };
        throw error;
      }
      this.failures.set(source, Date.now() + 15000);
      throw error;
    }
  }
}
