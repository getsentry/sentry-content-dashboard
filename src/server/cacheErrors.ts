// Coordination failures say nothing about the health of other Redis keys.
export class RefreshCoordinationError extends Error {}
export class RefreshDeferredError extends Error {
  constructor(public retryAt: number) { super('YouTube refresh deferred by quota policy'); }
}
export class YouTubeAdmissionUnavailableError extends RefreshDeferredError {}
