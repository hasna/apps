export {
  MACHINES_CONSUMER_CONTRACT_VERSION,
  MACHINES_PACKAGE_NAME,
  discoverMachineTopology,
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
  MachineTopology,
  MachineTopologyEntry,
  MachineTopologyOptions,
  MachineWorkspaceAuthStatus,
  MachineWorkspaceOptions,
  MachineWorkspacePath,
  MachineWorkspacePathSource,
  MachineWorkspaceProject,
  MachineWorkspaceResolution,
  MachineWorkspaceTrustStatus,
  MachinesConsumerCapabilities,
  MachinesContractPackage,
  TopologyCommandResult,
  TopologyCommandRunner,
} from "./topology.js";
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
