/**
 * Creates a limiter that tracks event timestamps per key (usually a
 * socket id or username) and rejects once more than `max` events have
 * happened within `windowMs`. Deliberately tiny and dependency-free -
 * this is meant to blunt basic flooding, not to be a distributed
 * rate limiter.
 */
export function createSocketRateLimiter({ windowMs, max }: { windowMs: number; max: number }) {
  const hits = new Map<string, number[]>();

  return function allow(key: string): boolean {
    const now = Date.now();
    const timestamps = (hits.get(key) || []).filter((t) => now - t < windowMs);
    if (timestamps.length >= max) {
      hits.set(key, timestamps);
      return false;
    }
    timestamps.push(now);
    hits.set(key, timestamps);
    return true;
  };
}
