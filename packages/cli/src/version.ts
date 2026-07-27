/**
 * Build identity recorded in receipts this CLI writes.
 *
 * This is not a policy version. `policyVersion` says which gate decided, and
 * only moves when policy behavior does; these say which build ran, and move
 * with every release. Keeping them separate is what lets a receipt from
 * v0.1.1 and one from v0.2.0 still be compared: same verdict, different
 * binary.
 *
 * `tests/integration/version-sync.test.ts` asserts these track their
 * package.json versions, because a comment asking someone to remember is not
 * a check.
 */

export const CLI_PACKAGE_VERSION = "0.2.0";

export const CLI_APP_VERSION = `changesafe-cli-${CLI_PACKAGE_VERSION}`;

export const SERVER_APP_VERSION = `changesafe-server-${CLI_PACKAGE_VERSION}`;
