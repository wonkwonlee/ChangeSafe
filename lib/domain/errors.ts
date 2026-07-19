/**
 * Typed domain errors. Every boundary failure becomes one of these so the UI
 * can render a safe, useful message. `userMessage` must never contain secrets,
 * stack traces, raw model output, or API key material.
 */

export type DomainErrorCode =
  | "SCHEMA_VALIDATION"
  | "ILLEGAL_TRANSITION"
  | "EVIDENCE_UNKNOWN"
  | "PATCH_PATH_FORBIDDEN"
  | "PATCH_TARGET_MISSING"
  | "PATCH_CONFLICT"
  | "PATCH_VALUE_INVALID"
  | "ROLLBACK_MISMATCH"
  | "AI_UNAVAILABLE"
  | "AI_CALL_FAILED"
  | "AI_INVALID_OUTPUT"
  | "FIXTURE_INVALID"
  | "REQUEST_INVALID"
  | "INTERNAL";

export class DomainError extends Error {
  readonly code: DomainErrorCode;
  /** Safe to render verbatim in the UI. */
  readonly userMessage: string;

  constructor(code: DomainErrorCode, userMessage: string, options?: { cause?: unknown }) {
    super(`${code}: ${userMessage}`, options);
    this.name = "DomainError";
    this.code = code;
    this.userMessage = userMessage;
  }
}

export class IllegalTransitionError extends DomainError {
  readonly fromPhase: string;
  readonly eventType: string;

  constructor(fromPhase: string, eventType: string, detail?: string) {
    super(
      "ILLEGAL_TRANSITION",
      `Transition "${eventType}" is not allowed from state "${fromPhase}"${
        detail ? `: ${detail}` : ""
      }`,
    );
    this.name = "IllegalTransitionError";
    this.fromPhase = fromPhase;
    this.eventType = eventType;
  }
}

export function isDomainError(value: unknown): value is DomainError {
  return value instanceof DomainError;
}

/** Collapse an arbitrary thrown value into a safe user-facing DomainError. */
export function toDomainError(value: unknown, fallbackMessage: string): DomainError {
  if (isDomainError(value)) {
    return value;
  }
  return new DomainError("INTERNAL", fallbackMessage, { cause: value });
}
