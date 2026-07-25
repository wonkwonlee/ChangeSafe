/**
 * @changesafe/server — the authenticated, self-hosted decision path.
 *
 * The public console runs the workflow in the browser, which is fine when the
 * person clicking is the person accountable. A team needs something else: an
 * approver whose identity was established by their own identity provider, a
 * decision the client cannot fake, and a durable record neither party can
 * quietly edit.
 *
 * So the server recomputes the findings itself, drives the same state machine
 * as everything else — including the rule that a BLOCK can never be approved
 * — signs the resulting receipt, and appends it to the ledger before
 * answering. It still cannot execute anything.
 */

export { DecisionService } from "./decisions";
export type {
  DecisionRequest,
  DecisionOutcome,
  DecisionServiceOptions,
} from "./decisions";

export { SERVER_DOMAIN_IDS, resolveServerDomain } from "./domains";
export type { ServerDomain } from "./domains";

export { AuthenticationError, OidcVerifier, bearerToken } from "./oidc";
export type { Jwk, OidcConfig, VerifiedIdentity } from "./oidc";

export { createDecisionServer } from "./http";
export type { DecisionServerOptions } from "./http";
