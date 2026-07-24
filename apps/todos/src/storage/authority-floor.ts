/** Dependency-light Stage-A authority floor shared by every public surface. */

export type TodosHostedUnavailableReason =
  | "default_local"
  | "explicit_local"
  | "explicit_hosted"
  | "ambiguous_service_dsn"
  | "invalid_mode"
  | "conflicting_modes"
  | "authority_resolver_unavailable"
  | "unreadable_environment"
  | "unreadable_options"
  | "unreadable_request";

export class TodosHostedStorageUnavailableError extends Error {
  readonly status = 503;
  readonly code = "HOSTED_AUTHORITY_UNAVAILABLE";

  constructor(readonly reason: TodosHostedUnavailableReason = "explicit_hosted") {
    super(`HOSTED_AUTHORITY_UNAVAILABLE: ${reason}`);
    this.name = "TodosHostedStorageUnavailableError";
  }
}

/** Stage A has no positive remote authority path under any role or config. */
export function assertTodosStageARemoteAccessFloor(): never {
  throw new TodosHostedStorageUnavailableError("authority_resolver_unavailable");
}

export function unreadableStageAInput(reason: "unreadable_environment" | "unreadable_options" | "unreadable_request"): never {
  throw new TodosHostedStorageUnavailableError(reason);
}
