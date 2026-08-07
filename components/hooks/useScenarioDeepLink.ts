"use client";

import { useCallback } from "react";

/**
 * Pure lookup, split out from the hook so it's testable without a React
 * or Next.js runtime. Returns null (not a thrown error) for a missing or
 * unrecognized id — callers fall back to their own default (EXAMPLES[0]).
 */
export function resolveInitialScenarioId(
  searchParams: URLSearchParams | null,
  availableIds: readonly string[],
): string | null {
  const candidate = searchParams?.get("scenario");
  if (!candidate) return null;
  return availableIds.includes(candidate) ? candidate : null;
}

/**
 * Reads `?scenario=<id>` from the current address bar to seed the initial
 * scenario selection. Deliberately does not use next/navigation's
 * `useSearchParams`: that hook forces Next.js to bail the enclosing
 * Suspense subtree out of static prerendering (emitting
 * `BAILOUT_TO_CLIENT_SIDE_RENDERING` instead of real markup), which would
 * mean the public workbench routes ship no server-rendered HTML. Reading
 * `window.location` from a client-only mount effect has no such effect on
 * prerendering — it never runs during the server render or in the
 * `renderToStaticMarkup`-based unit tests, only in a real browser.
 *
 * Returns null during SSR/static rendering (`window` is undefined); callers
 * invoke this from their own mount effect and fall back to their default
 * example when it returns null.
 */
export function readInitialScenarioId(availableIds: readonly string[]): string | null {
  if (typeof window === "undefined") return null;
  return resolveInitialScenarioId(new URLSearchParams(window.location.search), availableIds);
}

/**
 * Distinguishes "no `?scenario=` in the URL at all" from "`?scenario=` named
 * an id that isn't in this corpus" — the second case is what silently
 * substitutes a different example with no notice. `requestedId` is the raw,
 * untrusted query value; `resolvedId` is `requestedId` only when it matches
 * the corpus, otherwise null. A caller shows a substitution notice exactly
 * when `requestedId` is non-null and `resolvedId` is null.
 */
export function resolveScenarioLookup(
  searchParams: URLSearchParams | null,
  availableIds: readonly string[],
): { requestedId: string | null; resolvedId: string | null } {
  const requestedId = searchParams?.get("scenario") ?? null;
  const resolvedId = requestedId !== null && availableIds.includes(requestedId) ? requestedId : null;
  return { requestedId, resolvedId };
}

export function readScenarioLookup(
  availableIds: readonly string[],
): { requestedId: string | null; resolvedId: string | null } {
  if (typeof window === "undefined") return { requestedId: null, resolvedId: null };
  return resolveScenarioLookup(new URLSearchParams(window.location.search), availableIds);
}

/**
 * Keeps the URL in sync as the visitor picks a different scenario — every
 * scenario becomes a copy-able link, not just the featured ones.
 *
 * Deliberately bypasses next/navigation's router: router.replace() (even
 * with scroll: false) issues a real RSC fetch to re-render the route on
 * every scenario click. The URL update here is cosmetic bookkeeping only —
 * making the current selection a copy-able link — and no server-rendered
 * content depends on it, so a plain History API call updates the address
 * bar with no network request and no re-render.
 */
export function useScenarioDeepLink(): {
  readonly setScenarioInUrl: (id: string) => void;
} {
  const setScenarioInUrl = useCallback((id: string) => {
    const next = new URLSearchParams(window.location.search);
    next.set("scenario", id);
    window.history.replaceState(
      window.history.state,
      "",
      `${window.location.pathname}?${next.toString()}${window.location.hash}`,
    );
  }, []);

  return { setScenarioInUrl };
}
