/**
 * @hasna/skills/sdk — the import surface for embedding the skills service.
 *
 * Server/router, registry + version service, run protocol + atomic run services,
 * dispatcher adapters, executor, storage/object-store seams, the cloud-run
 * execution lane (admission, CAS leases, ECS reconciliation), and the run
 * governance controls (privacy, retention, tenancy, cancellation, events,
 * spend ceilings, offline fail-closed). Every module re-exports the shipped
 * implementation with the interface as the contract; nothing here duplicates
 * business logic. The SaaS control plane imports this package directly and
 * never spawns the server binaries.
 *
 * The client credential seam is re-exported too, so an SDK consumer resolves the
 * Skills authority and credential exactly the way the CLI and the MCP server do
 * — the shared @hasna/contracts ladder — instead of reading an environment
 * variable of its own. See lib/fleet-credentials.ts.
 */
export {
  MissingSkillsFleetError,
  SkillsFleetCredentialError,
  SKILLS_API_KEY_ENV,
  SKILLS_API_URL_ENV,
  SKILLS_APP,
  configuredSkillsApiUrl,
  noticeLocalSkillsMode,
  normalizeSkillsApiOrigin,
  requireSkillsApiOrigin,
  requireSkillsFleet,
  resolveSkillsApiOrigin,
  resolveSkillsFleet,
  skillsCredentialFilePath,
  skillsCredentialFiles,
  skillsCredentialOrReason,
  type HostedSkillsFleet,
  type LocalSkillsFleet,
  type SkillsFleet,
  type SkillsFleetErrorCode,
  type SkillsFleetOptions,
} from "../lib/fleet-credentials.js";
export * from "./server.js";
export * from "./registry.js";
export * from "./runs.js";
export * from "./dispatcher.js";
export * from "./executor.js";
export * from "./storage.js";
export * from "./governance.js";
export * from "./governance-store.js";
export * from "./outputs.js";
export * from "./cancel.js";
export * from "./events.js";
export * from "./spend.js";
export * from "./offline.js";
export * from "./execution/index.js";
export { RemoteSkillsClient, createRemoteSkillsClient, RemoteRequestError, RemoteRouteUnsupportedError, RemoteCapabilityUnavailableError } from "../lib/remote-client.js";
export { RemoteCreditApprovalError, type RemoteRunApproval, type RemoteRunQuote, type RemoteCreditPack } from "../lib/remote-account.js";
export { type RemoteInputFile, type RemoteInputFileDescriptor } from "../lib/remote-files.js";

export { RemoteSkillsAuthClient, HostedApiError } from "../lib/remote-auth.js";
