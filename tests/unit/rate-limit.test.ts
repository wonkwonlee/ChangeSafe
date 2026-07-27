import { describe, expect, it } from "vitest";

import {
  DEFAULT_LIVE_RATE_POLICY,
  RateLimiter,
  clientKey,
  livePolicyFromEnv,
} from "@/lib/rate-limit";

const POLICY = { limit: 3, windowSeconds: 60 };
const START = 1_800_000_000_000;

describe("live-call rate limiting", () => {
  it("allows a client up to the limit, then refuses with a wait", () => {
    const limiter = new RateLimiter();
    for (let call = 1; call <= POLICY.limit; call += 1) {
      expect(limiter.check("1.2.3.4", POLICY, START).allowed, `call ${call}`).toBe(true);
    }

    const refused = limiter.check("1.2.3.4", POLICY, START);
    expect(refused.allowed).toBe(false);
    expect(refused.retryAfterSeconds).toBeGreaterThan(0);
    expect(refused.retryAfterSeconds).toBeLessThanOrEqual(POLICY.windowSeconds);
  });

  it("counts clients separately", () => {
    const limiter = new RateLimiter();
    for (let call = 0; call < POLICY.limit; call += 1) limiter.check("1.2.3.4", POLICY, START);

    expect(limiter.check("1.2.3.4", POLICY, START).allowed).toBe(false);
    expect(limiter.check("5.6.7.8", POLICY, START).allowed).toBe(true);
  });

  it("lets a client back in when the window turns over", () => {
    const limiter = new RateLimiter();
    for (let call = 0; call < POLICY.limit; call += 1) limiter.check("1.2.3.4", POLICY, START);
    expect(limiter.check("1.2.3.4", POLICY, START).allowed).toBe(false);

    const afterWindow = START + POLICY.windowSeconds * 1000 + 1;
    expect(limiter.check("1.2.3.4", POLICY, afterWindow).allowed).toBe(true);
  });

  it("does not push a persistent caller further back for knocking", () => {
    const limiter = new RateLimiter();
    for (let call = 0; call < POLICY.limit; call += 1) limiter.check("1.2.3.4", POLICY, START);

    const first = limiter.check("1.2.3.4", POLICY, START);
    // Refused calls do not extend the window: the wait shrinks with time.
    const later = limiter.check("1.2.3.4", POLICY, START + 30_000);
    expect(first.allowed).toBe(false);
    expect(later.allowed).toBe(false);
    expect(later.retryAfterSeconds).toBeLessThan(first.retryAfterSeconds);
  });

  it("treats a limit of zero as no cap at all", () => {
    const limiter = new RateLimiter();
    const unlimited = { limit: 0, windowSeconds: 60 };
    for (let call = 0; call < 50; call += 1) {
      expect(limiter.check("1.2.3.4", unlimited, START).allowed).toBe(true);
    }
  });
});

describe("policy from the environment", () => {
  it("uses the documented defaults when unset", () => {
    expect(livePolicyFromEnv({})).toEqual(DEFAULT_LIVE_RATE_POLICY);
  });

  it("reads an explicit policy", () => {
    expect(
      livePolicyFromEnv({
        CHANGESAFE_LIVE_RATE_LIMIT: "25",
        CHANGESAFE_LIVE_RATE_WINDOW_SECONDS: "600",
      }),
    ).toEqual({ limit: 25, windowSeconds: 600 });
  });

  it("falls back to the default rather than to unlimited on a bad value", () => {
    // A typo in a deployment variable must not quietly remove the cap.
    expect(livePolicyFromEnv({ CHANGESAFE_LIVE_RATE_LIMIT: "ten" })).toEqual(
      DEFAULT_LIVE_RATE_POLICY,
    );
  });

  it("still allows deliberately disabling the cap", () => {
    expect(livePolicyFromEnv({ CHANGESAFE_LIVE_RATE_LIMIT: "0" }).limit).toBe(0);
  });
});

describe("identifying the caller", () => {
  it("takes the first forwarded address", () => {
    const headers = new Headers({ "x-forwarded-for": "203.0.113.7, 198.51.100.1" });
    expect(clientKey(headers)).toBe("203.0.113.7");
  });

  it("falls back to x-real-ip, then to a shared bucket", () => {
    expect(clientKey(new Headers({ "x-real-ip": "203.0.113.9" }))).toBe("203.0.113.9");
    // Unidentifiable callers share one window — the conservative direction.
    expect(clientKey(new Headers())).toBe("unidentified");
  });
});
