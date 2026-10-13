export type ErrorCode = "configuration_error" | "provider_unavailable" | "provider_rejected" | "invalid_token" | "invalid_state" | "access_denied" | "account_conflict" | "migration_denied" | "csrf_failed" | "session_expired" | "internal_error";

export class OrbitaError extends Error {
  constructor(public readonly code: ErrorCode, public readonly status = 401) {
    super(code);
    this.name = "OrbitaError";
  }
}

export function safeError(error: unknown): OrbitaError {
  return error instanceof OrbitaError ? error : new OrbitaError("internal_error", 500);
}
