// Pure contract helpers for project-channel registration: the collection-changed
// error code, the canonical digest and the operation-intent guard. Shared by the
// CLI (`conversations project-registration …`), the server and the domain
// library; kept free of any store import so client bundles never reach
// `bun:sqlite` through the registration authority.
import { createHash } from "crypto";
import type {
  ProjectChannelRegistrationOperationIntent,
  ProjectChannelRegistrationRequest,
} from "./project-channel-registration.js";

export const PROJECT_CHANNEL_COLLECTION_CHANGED =
  "CONVERSATIONS_PROJECT_CHANNEL_COLLECTION_CHANGED" as const;

export class ProjectChannelCollectionChangedError extends Error {
  readonly code = PROJECT_CHANNEL_COLLECTION_CHANGED;

  constructor(
    message: string,
    readonly details: Record<string, unknown> = {},
  ) {
    super(message);
    this.name = "ProjectChannelCollectionChangedError";
  }
}

function canonicalize(value: unknown): unknown {
  if (value instanceof Date) return value.toISOString();
  if (Array.isArray(value)) return value.map(canonicalize);
  if (value && typeof value === "object") {
    const input = value as Record<string, unknown>;
    return Object.fromEntries(
      Object.keys(input).sort().map((key) => [key, canonicalize(input[key])]),
    );
  }
  if (typeof value === "bigint") return value.toString();
  return value ?? null;
}

export function projectChannelRegistrationDigest(value: unknown): string {
  return createHash("sha256")
    .update(JSON.stringify(canonicalize(value)))
    .digest("hex");
}

export function assertProjectChannelRegistrationOperationIntent(
  request: Pick<
    ProjectChannelRegistrationRequest,
    | "operation_intent"
    | "bind_existing"
    | "adopt_existing"
    | "desired"
    | "precondition_digest"
    | "target_selector"
  >,
  expected: ProjectChannelRegistrationOperationIntent,
): void {
  const desiredBind = request.desired.registration_mode === "bind_existing";
  const desiredAdopt = request.desired.registration_mode === "adopt_existing";
  const bindShape = request.bind_existing !== undefined || desiredBind;
  const adoptShape = request.adopt_existing !== undefined || desiredAdopt;
  if (expected === "create" && request.operation_intent === undefined && bindShape) {
    throw new Error("project channel registration create surface rejects bind-existing intent.");
  }
  if (expected === "create" && request.operation_intent === undefined && adoptShape) {
    throw new Error("project channel registration create surface rejects adopt-existing intent.");
  }
  const legacyExpectedAbsentCreate = expected === "create"
    && request.operation_intent === undefined
    && !bindShape
    && !adoptShape
    && request.precondition_digest === projectChannelRegistrationDigest({
      target_selector: request.target_selector,
      expected: "absent",
    });
  if (request.operation_intent !== expected && !legacyExpectedAbsentCreate) {
    throw new Error(
      `project channel registration ${expected} surface requires operation_intent=${expected}.`,
    );
  }
  if (expected === "create" && bindShape) {
    throw new Error("project channel registration create surface rejects bind-existing intent.");
  }
  if (expected === "create" && adoptShape) {
    throw new Error("project channel registration create surface rejects adopt-existing intent.");
  }
  if (expected === "bind_existing" && (!request.bind_existing || !desiredBind)) {
    throw new Error("project channel registration bind-existing surface requires bind-existing intent.");
  }
  if (expected === "adopt_existing" && (!request.adopt_existing || !desiredAdopt)) {
    throw new Error("project channel registration adopt-existing surface requires adopt-existing intent.");
  }
}
