/**
 * Pure line- and leaf-level diffing for the before/after JSON panels. No
 * dependency is added for this: both algorithms are small, well-understood,
 * and bounded so they stay cheap even on the largest bundled fixtures.
 */

export interface DiffLine {
  readonly type: "context" | "add" | "remove";
  readonly text: string;
}

/** Above this line count, an LCS table becomes wasted work no reviewer will scroll through; callers fall back to plain before/after rendering. */
const MAX_DIFF_LINES = 400;

/**
 * Classic LCS-based line diff. Returns null (never a huge diff) when either
 * side exceeds `MAX_DIFF_LINES`, so a caller can fall back to unmarked
 * before/after blocks instead of doing (and rendering) O(n·m) work no one
 * will read line by line anyway.
 */
export function computeLineDiff(beforeText: string, afterText: string): DiffLine[] | null {
  const before = beforeText.split("\n");
  const after = afterText.split("\n");
  if (before.length > MAX_DIFF_LINES || after.length > MAX_DIFF_LINES) return null;

  const n = before.length;
  const m = after.length;
  // Row (n+1) x (m+1), always in bounds by construction — no index can read
  // past it, so a small helper keeps every access provably defined without
  // scattering non-null assertions through the algorithm.
  const lcs: number[][] = Array.from({ length: n + 1 }, () => new Array<number>(m + 1).fill(0));
  const lcsAt = (row: number, col: number): number => lcs[row]?.[col] ?? 0;

  for (let i = n - 1; i >= 0; i--) {
    for (let j = m - 1; j >= 0; j--) {
      const row = lcs[i];
      if (!row) continue;
      row[j] = before[i] === after[j] ? lcsAt(i + 1, j + 1) + 1 : Math.max(lcsAt(i + 1, j), lcsAt(i, j + 1));
    }
  }

  const result: DiffLine[] = [];
  let i = 0;
  let j = 0;
  while (i < n && j < m) {
    const beforeLine = before[i] ?? "";
    const afterLine = after[j] ?? "";
    if (beforeLine === afterLine) {
      result.push({ type: "context", text: beforeLine });
      i++;
      j++;
    } else if (lcsAt(i + 1, j) >= lcsAt(i, j + 1)) {
      result.push({ type: "remove", text: beforeLine });
      i++;
    } else {
      result.push({ type: "add", text: afterLine });
      j++;
    }
  }
  while (i < n) {
    result.push({ type: "remove", text: before[i] ?? "" });
    i++;
  }
  while (j < m) {
    result.push({ type: "add", text: after[j] ?? "" });
    j++;
  }
  return result;
}

export interface LeafChange {
  readonly path: string;
  readonly before: unknown;
  readonly after: unknown;
}

export interface LeafChangeSummary {
  readonly changes: LeafChange[];
  // True once the walk hit MAX_VISITED_NODES before finishing. An empty
  // `changes` alongside `truncated: true` means "gave up before reaching
  // every leaf", not "these values are equal" — the two must never be
  // presented to a reader the same way.
  readonly truncated: boolean;
}

export const MAX_LEAF_CHANGES = 6;
const MAX_VISITED_NODES = 2000;

function isPlainObjectOrArray(value: unknown): value is Record<string, unknown> | unknown[] {
  return value !== null && typeof value === "object";
}

/**
 * Walks two JSON-shaped values in lockstep and collects the leaf values that
 * differ, as human-readable paths ("spec.replicas", "0.image"). Bounded on
 * both the number of changes collected and the number of nodes visited, so a
 * huge or deeply nested proposal can never make this expensive — the caller
 * gets a short, useful summary or an explicit truncation signal, never a
 * hang and never a false "nothing differs".
 */
export function summarizeLeafChanges(before: unknown, after: unknown): LeafChangeSummary {
  const changes: LeafChange[] = [];
  let visited = 0;
  let truncated = false;

  function walk(a: unknown, b: unknown, path: string): void {
    if (changes.length >= MAX_LEAF_CHANGES) return;
    if (visited >= MAX_VISITED_NODES) {
      truncated = true;
      return;
    }
    visited++;
    if (a === b) return;

    if (isPlainObjectOrArray(a) && isPlainObjectOrArray(b)) {
      const aRecord = a as Record<string, unknown>;
      const bRecord = b as Record<string, unknown>;
      const keys = new Set([...Object.keys(aRecord), ...Object.keys(bRecord)]);
      for (const key of keys) {
        if (changes.length >= MAX_LEAF_CHANGES) return;
        walk(aRecord[key], bRecord[key], path ? `${path}.${key}` : key);
      }
      return;
    }

    changes.push({ path: path || "(root)", before: a, after: b });
  }

  walk(before, after, "");
  return { changes, truncated };
}

function formatLeafValue(value: unknown): string {
  return value === undefined ? "(absent)" : JSON.stringify(value);
}

export function formatLeafChange(change: LeafChange): string {
  return `${change.path}: ${formatLeafValue(change.before)} → ${formatLeafValue(change.after)}`;
}
