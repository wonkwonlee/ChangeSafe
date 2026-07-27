/**
 * A per-client cap on live model calls.
 *
 * Replay is free — no key, no network, no cost — and stays unlimited, because
 * the demo's whole promise is that anyone can drive the full pipeline without
 * an account. A live call spends the deployer's API credit, and the endpoint
 * that makes one is unauthenticated by design, so without a cap a public
 * deployment with a key configured is someone else's budget on an open port.
 *
 * What this is: a fixed window per client, in this process's memory.
 *
 * What it is not: a defense. A serverless deployment runs several instances,
 * each with its own counter, and the client key comes from a forwarded header
 * that only a trusted proxy makes trustworthy. It is a speed bump that turns
 * "a loop empties the account" into "a loop is noticed" — anyone exposing
 * live mode to the internet still wants authentication or a proxy in front.
 */

export interface RateLimitPolicy {
  /** Calls allowed per window. Zero or less disables the cap entirely. */
  readonly limit: number;
  readonly windowSeconds: number;
}

export interface RateLimitVerdict {
  readonly allowed: boolean;
  /** Seconds until the window resets; meaningful only when refused. */
  readonly retryAfterSeconds: number;
  readonly remaining: number;
}

export const DEFAULT_LIVE_RATE_POLICY: RateLimitPolicy = {
  limit: 10,
  windowSeconds: 3600,
};

/**
 * Read the policy from the environment.
 *
 * An unreadable value falls back to the default rather than to "unlimited": a
 * typo in a deployment variable must not quietly remove the cap.
 */
export function livePolicyFromEnv(
  env: Record<string, string | undefined> = process.env,
): RateLimitPolicy {
  const read = (name: string, fallback: number): number => {
    const raw = env[name];
    if (raw === undefined || raw.trim() === "") return fallback;
    const value = Number(raw);
    return Number.isFinite(value) ? Math.trunc(value) : fallback;
  };

  return {
    limit: read("CHANGESAFE_LIVE_RATE_LIMIT", DEFAULT_LIVE_RATE_POLICY.limit),
    windowSeconds: Math.max(
      1,
      read("CHANGESAFE_LIVE_RATE_WINDOW_SECONDS", DEFAULT_LIVE_RATE_POLICY.windowSeconds),
    ),
  };
}

interface Window {
  count: number;
  resetAtMs: number;
}

/** Bounds memory: a key per client, and the map is swept once it grows. */
const MAX_TRACKED_CLIENTS = 10_000;

export class RateLimiter {
  readonly #windows = new Map<string, Window>();

  /** Count one call against `key` and say whether it may proceed. */
  check(key: string, policy: RateLimitPolicy, nowMs: number): RateLimitVerdict {
    if (policy.limit <= 0) {
      return { allowed: true, retryAfterSeconds: 0, remaining: Number.POSITIVE_INFINITY };
    }

    const existing = this.#windows.get(key);
    if (!existing || existing.resetAtMs <= nowMs) {
      this.#sweep(nowMs);
      this.#windows.set(key, { count: 1, resetAtMs: nowMs + policy.windowSeconds * 1000 });
      return { allowed: true, retryAfterSeconds: 0, remaining: policy.limit - 1 };
    }

    const retryAfterSeconds = Math.max(1, Math.ceil((existing.resetAtMs - nowMs) / 1000));
    if (existing.count >= policy.limit) {
      // Deliberately not extended on a refused call: a client that keeps
      // trying should get in when the window turns over, not be pushed back
      // for as long as it keeps knocking.
      return { allowed: false, retryAfterSeconds, remaining: 0 };
    }

    existing.count += 1;
    return { allowed: true, retryAfterSeconds: 0, remaining: policy.limit - existing.count };
  }

  /** Test seam; also what a deployment restart does for free. */
  reset(): void {
    this.#windows.clear();
  }

  #sweep(nowMs: number): void {
    if (this.#windows.size < MAX_TRACKED_CLIENTS) return;
    for (const [key, window] of this.#windows) {
      if (window.resetAtMs <= nowMs) this.#windows.delete(key);
    }
    // Still full of live windows: drop the oldest rather than grow without
    // bound. Losing a counter costs one extra allowed call, which is the
    // right way for a speed bump to fail.
    if (this.#windows.size >= MAX_TRACKED_CLIENTS) {
      const oldest = [...this.#windows.entries()]
        .sort((a, b) => a[1].resetAtMs - b[1].resetAtMs)
        .slice(0, Math.floor(MAX_TRACKED_CLIENTS / 2));
      for (const [key] of oldest) this.#windows.delete(key);
    }
  }
}

/**
 * Identify the caller.
 *
 * `x-forwarded-for` is only as honest as the proxy that set it — behind
 * Vercel or a reverse proxy it is the client address; on a directly exposed
 * port a caller can write whatever it likes. Callers that cannot be
 * distinguished share one window, which is the conservative direction.
 */
export function clientKey(headers: Headers): string {
  const forwarded = headers.get("x-forwarded-for");
  const first = forwarded?.split(",")[0]?.trim();
  if (first) return first;
  return headers.get("x-real-ip")?.trim() || "unidentified";
}

/** The process-wide limiter used by the live analysis route. */
export const liveRateLimiter = new RateLimiter();
