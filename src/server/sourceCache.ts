import * as Sentry from '@sentry/nextjs';
import { normalizeContent, type ContentSource, type SourcePayload, type SourceSnapshot } from '../utils/content';

export const SOURCE_FRESHNESS_MS = 30000;
export const SNAPSHOT_MAX_AGE_MS = 86400000;
type Loader = (previous?: SourceSnapshot) => Promise<SourcePayload>;
export interface SnapshotStore {
  read(source: ContentSource): Promise<SourceSnapshot | undefined>;
  refresh(source: ContentSource, previous: SourceSnapshot | undefined, load: () => Promise<SourceSnapshot>): Promise<SourceSnapshot>;
}

// Shared by API reads, streamed dashboard loads, and exports in each worker.
export class SourceCache {
  private snapshots = new Map<ContentSource, SourceSnapshot>();
  private inFlight = new Map<ContentSource, Promise<SourceSnapshot>>();
  private storeUnavailableUntil = 0;
  private failures = new Map<ContentSource, number>();
  constructor(private loaders: Record<ContentSource, Loader>, private store?: SnapshotStore) {}

  async read(source: ContentSource) {
    let snapshot = this.snapshots.get(source);
    if (this.store && Date.now() >= this.storeUnavailableUntil) {
      let timer: ReturnType<typeof setTimeout> | undefined;
      try {
        const stored = await Promise.race([
          this.store.read(source),
          new Promise<never>((_, reject) => { timer = setTimeout(() => reject(new Error('Snapshot cache timed out')), 400); }),
        ]);
        if (stored) { snapshot = stored; this.snapshots.set(source, stored); }
      } catch {
        // An optional snapshot cache must not take healthy external feeds offline.
        this.storeUnavailableUntil = Date.now() + 15000;
        Sentry.logger.warn('Content snapshot cache unavailable; using worker cache');
      } finally { clearTimeout(timer); }
    }
    return snapshot && Date.now() - snapshot.fetchedAt < SNAPSHOT_MAX_AGE_MS ? snapshot : undefined;
  }

  refresh(source: ContentSource, force = false): Promise<SourceSnapshot> {
    const pending = this.inFlight.get(source);
    if (pending) return pending;
    const task = this.update(source, force).finally(() => this.inFlight.delete(source));
    this.inFlight.set(source, task);
    return task;
  }

  private async update(source: ContentSource, force: boolean) {
    if ((this.failures.get(source) || 0) > Date.now()) throw new Error(`${source} temporarily unavailable`);
    const previous = await this.read(source);
    if (source !== 'docs' && !force && previous && Date.now() - previous.fetchedAt < SOURCE_FRESHNESS_MS) return previous;
    try {
      let loaded: SourceSnapshot | undefined;
      let upstreamFailed = false;
      const load = async () => {
        try {
          const payload = await this.loaders[source](previous);
          loaded = { ...payload, items: normalizeContent(payload.items, source), fetchedAt: Date.now() };
          return loaded;
        } catch (error) { upstreamFailed = true; throw error; }
      };
      let snapshot: SourceSnapshot;
      if (this.store && Date.now() >= this.storeUnavailableUntil) {
        try { snapshot = await this.store.refresh(source, previous, load); }
        catch (error) {
          if (upstreamFailed) throw error;
          this.storeUnavailableUntil = Date.now() + 15000;
          Sentry.logger.warn('Content snapshot write unavailable; using worker cache');
          snapshot = loaded ?? await load();
        }
      } else snapshot = await load();
      this.snapshots.set(source, snapshot);
      this.failures.delete(source);
      return snapshot;
    } catch (error) {
      this.failures.set(source, Date.now() + 15000);
      throw error;
    }
  }
}
