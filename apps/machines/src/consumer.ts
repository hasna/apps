export {
  MACHINES_CONSUMER_CAPABILITIES,
  MACHINES_CONSUMER_CONTRACT,
  MACHINES_CONSUMER_ENTRYPOINT,
  MACHINES_CONSUMER_CONTRACT_VERSION,
  MACHINES_CONSUMER_FIELD_CAPABILITIES,
  MACHINES_CONSUMER_SCHEMA_ARTIFACT,
  MACHINES_CONSUMER_SCHEMA_URI,
  MACHINES_PACKAGE_NAME,
  DEFAULT_MACHINE_RESOLVER_TTL_MS,
  DEFAULT_MACHINE_LIST_LIMIT,
  createMachineResolverSnapshot,
  discoverMachineTopology,
  getMachinesConsumerCapabilities,
  getLocalMachineTopology,
  resolveMachineRoute,
  resolveMachineWorkspace,
} from "./topology.js";
export type {
  MachineRouteConfidence,
  MachineRouteHint,
  MachineRouteKind,
  MachineRouteOptions,
  MachineRouteResolution,
  MachineResolverAuthority,
  MachineResolverCacheability,
  MachineResolverSnapshot,
  MachineResolverSnapshotRoute,
  MachineResolverSnapshotWorkspace,
  MachineListPagination,
  MachineTopology,
  MachineTopologyEntry,
  MachineTopologyOptions,
  MachineWorkspaceAuthStatus,
  MachineWorkspaceDiagnostic,
  MachineWorkspaceDiagnosticStatus,
  MachineWorkspaceOptions,
  MachineWorkspacePath,
  MachineWorkspacePathSource,
  MachineWorkspaceProject,
  MachineWorkspaceRepairHint,
  MachineWorkspaceResolution,
  MachineWorkspaceTrustStatus,
  MachinesConsumerContract,
  MachinesConsumerEnvelope,
  MachinesConsumerFieldCapabilities,
  MachinesConsumerCapabilities,
  MachinesContractPackage,
  TopologyCommandResult,
  TopologyCommandRunner,
} from "./topology.js";
export {
  MACHINES_CONSUMER_SCHEMA_BUNDLE,
  getMachinesConsumerSchemaBundle,
  validateMachinesConsumerEnvelope,
} from "./consumer-schema.js";
export type {
  MachinesConsumerEnvelopeValue,
  MachinesConsumerSchemaBundle,
  MachinesConsumerSchemaEnvelope,
  MachinesConsumerValidationResult,
} from "./consumer-schema.js";
export {
  listMachineProjectAssignments,
  projectAssignmentMutationArgs,
  projectAssignmentResourceId,
  removeProjectAssignmentMutationArgs,
} from "./projects.js";
export type {
  AssignMachineProjectInput,
  MachineProjectAssignment,
  MachineProjectAssignmentMachineSummary,
  MachineProjectAssignmentProjectSummary,
  MachineProjectAssignmentSource,
  MachineProjectAssignments,
  MachineProjectAssignmentsOptions,
  RemoveMachineProjectAssignmentInput,
} from "./projects.js";
export {
  MACHINE_TRASH_POLICIES_KIND,
  NOTE_MACHINE_CONTEXT_KIND,
  listMachineTrashPolicies,
  machineReferenceForNote,
  resolveNoteMachineContext,
} from "./notes.js";
export type {
  MachineTrashPolicies,
  MachineTrashPoliciesOptions,
  MachineTrashPolicy,
  MachineTrashPolicySource,
  NoteActorContext,
  NoteActorType,
  NoteMachineContext,
  NoteMachineContextOptions,
  NoteMachineContextSource,
  NoteMachineReference,
  NoteMachineRole,
  NoteSyncTarget,
} from "./notes.js";
export {
  checkMachineCompatibility,
} from "./compatibility.js";
export type {
  CompatibilityCheck,
  CompatibilityCommandRunner,
  CompatibilityCommandSpec,
  CompatibilityPackageSpec,
  CompatibilitySource,
  CompatibilityStatus,
  CompatibilityWorkspaceSpec,
  MachineCompatibilityOptions,
  MachineCompatibilityReport,
} from "./compatibility.js";
export {
  resolveMachineCommand,
  runMachineCommand,
} from "./remote.js";
export type {
  MachineCommandResult,
} from "./remote.js";
export {
  buildSshCommand,
  resolveSshTarget,
} from "./commands/ssh.js";
export type {
  ResolvedSshTarget,
} from "./commands/ssh.js";
export {
  getPackageVersion,
} from "./version.js";
