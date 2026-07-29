/** Kept in sync with package.json manually; embedded in receipts. */
export const APP_VERSION = "0.3.0";

/** Bumped whenever any frozen policy's behavior changes; embedded in receipts. */
export const POLICY_VERSION = "policies-v0.1.0";

// There is deliberately no runtime model constant here. Which model answers
// is a deployment setting resolved server-side from the configured provider,
// and what a receipt records is the model that actually answered — never the
// one we hoped for. See @changesafe/ai and /api/status.
