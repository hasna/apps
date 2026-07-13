/**
 * @hasnaxyz/sandboxes — primary package entry (the SDK).
 *
 * The default export is the typed /v1 API client. Domain value types
 * (SandboxSpecV1, error codes, canonical helpers, validators) are re-exported so
 * SDK consumers can build/validate specs without a second import. The heavy
 * domain service + provider adapters are SERVER-INTERNAL (used by
 * sandboxes-serve) and intentionally not part of the client SDK surface.
 */
export * from "./canonical.js";
export * from "./errors.js";
export * from "./types.js";
export * from "./validation.js";

export {
  SandboxesClient,
  SandboxesApiError,
} from "./sdk.js";
export type {
  Allocation,
  AllocationState,
  AdapterId,
  Checkpoint,
  WhoAmI,
  SandboxesClientOptions,
  ApiEnvelope,
} from "./sdk.js";

export { SandboxesClient as default } from "./sdk.js";
