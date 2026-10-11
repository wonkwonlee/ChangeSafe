/**
 * Kubernetes' documented comparison for resource versions of one resource
 * type served by kube-apiserver (conformance-required from 1.35): decimal
 * strings compared by length, then lexicographically. Anything that is not
 * such a string (an aggregated API server's version, say) is incomparable,
 * and the caller must fall back to equality.
 */
export function compareResourceVersions(a: string, b: string): -1 | 0 | 1 | undefined {
  const decimal = /^[1-9][0-9]*$/;
  if (!decimal.test(a) || !decimal.test(b)) return undefined;
  if (a.length !== b.length) return a.length < b.length ? -1 : 1;
  return a === b ? 0 : a < b ? -1 : 1;
}
