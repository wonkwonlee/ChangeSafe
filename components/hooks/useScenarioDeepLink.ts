"use client";

import { useRouter, useSearchParams } from "next/navigation";
import { useMemo } from "react";

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
 * Reads `?scenario=<id>` on mount to seed the initial scenario selection,
 * and keeps the URL in sync as the visitor picks a different scenario —
 * every scenario becomes a copy-able link, not just the featured ones.
 *
 * Must be called from a component rendered under a <Suspense> boundary
 * (Next.js requirement for useSearchParams in an otherwise-static page).
 */
export function useScenarioDeepLink(availableIds: readonly string[]): {
  readonly initialScenarioId: string | null;
  readonly setScenarioInUrl: (id: string) => void;
} {
  const searchParams = useSearchParams();
  const router = useRouter();

  const initialScenarioId = useMemo(
    () => resolveInitialScenarioId(searchParams, availableIds),
    // Only resolved once per mount's initial params — intentionally not
    // re-derived as the URL changes afterward, since setScenarioInUrl is
    // the only writer once the component is interactive.
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [],
  );

  const setScenarioInUrl = (id: string) => {
    const next = new URLSearchParams(searchParams?.toString() ?? "");
    next.set("scenario", id);
    router.replace(`?${next.toString()}`, { scroll: false });
  };

  return { initialScenarioId, setScenarioInUrl };
}
