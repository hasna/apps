import { checkMachineCompatibility, type CompatibilityCheck, type CompatibilityCommandRunner, type MachineCompatibilityReport } from "./compatibility.js";
import {
  MACHINES_CONSUMER_CONTRACT_VERSION,
  MACHINES_PACKAGE_NAME,
  discoverMachineTopology,
  getMachinesConsumerCapabilities,
  resolveMachineRoute,
  resolveMachineWorkspace,
  type MachineRouteConfidence,
  type MachineRouteKind,
  type MachineTopology,
  type MachineTopologyEntry,
  type MachinesContractPackage,
} from "./topology.js";
import { getPackageVersion } from "./version.js";

export const BROWSERPLAN_FLEET_KIND = "browserplan_fleet";

/**
 * BrowserPlan distribution source of truth. The `hasna/chrome` git repository was
 * retired, so the npm package is the only remaining artifact: it ships raw TypeScript
 * (no `dist/`) and provides the `browserplan` bin.
 */
export const BROWSERPLAN_PACKAGE_NAME = "@hasna/open-chrome";
export const BROWSERPLAN_CLI_COMMAND = "browserplan";
/**
 * Contract owner id for every BrowserPlan-owned surface (`target.owner`,
 * `operation_contract.command_owner`, `operation_hooks[].owner`, safe-runner ownership)
 * and the workspace/project key machine manifests use. Must stay equal to
 * `defaultAppIdForPackage(BROWSERPLAN_PACKAGE_NAME)`; test/browserplan.test.ts pins that.
 */
export const BROWSERPLAN_APP_ID = "open-chrome";
/** Route owner id for this package, i.e. `defaultAppIdForPackage(MACHINES_PACKAGE_NAME)`. */
export const BROWSERPLAN_ROUTE_OWNER = "open-machines";
export const BROWSERPLAN_SECRETS_OWNER = "open-identities/open-attachments/open-mailery";
/**
 * `app_install_update` installs/updates BrowserPlan from npm, matching the desired-state
 * rollout idiom in src/commands/reconcile.ts (`bun install -g pkg@version`). It must NOT
 * git-pull a checkout: the source repository no longer exists.
 */
export const BROWSERPLAN_INSTALL_VERSION_PLACEHOLDER = "open-chrome-version";
export const BROWSERPLAN_INSTALL_UPDATE_COMMAND_TEMPLATE = `bun install -g ${BROWSERPLAN_PACKAGE_NAME}@<${BROWSERPLAN_INSTALL_VERSION_PLACEHOLDER}>`;

export const BROWSERPLAN_TARGET_NAME = "browserplan-machine001-machine011";
export const BROWSERPLAN_MACHINE_IDS = [
  "machine001",
  "machine002",
  "machine003",
  "machine004",
  "machine005",
  "machine006",
  "machine007",
  "machine008",
  "machine009",
  "machine010",
  "machine011",
] as const;
export const BROWSERPLAN_EXCLUDED_MACHINE_IDS = ["spark01", "spark02"] as const;

export type BrowserPlanMachineId = typeof BROWSERPLAN_MACHINE_IDS[number];
export type BrowserPlanExcludedMachineId = typeof BROWSERPLAN_EXCLUDED_MACHINE_IDS[number];
export type BrowserPlanCapabilityState = "available" | "missing" | "unknown" | "failed";
export type BrowserPlanOperationId =
  | "profile_setup"
  | "headed_launch"
  | "headless_launch"
  | "daemon_status"
  | "supervisor_status"
  | "tab_inventory"
  | "session_inventory"
  | "app_install_update";

export interface BrowserPlanFleetOptions {
  machineIds?: string[];
  topology?: MachineTopology;
  includeTailscale?: boolean;
  includeInstallState?: boolean;
  runner?: CompatibilityCommandRunner;
  now?: Date;
}

export interface BrowserPlanMachineStatus {
  state: "online" | "offline" | "unknown";
  label: "Online" | "Offline" | "Unknown";
  online: boolean | null;
  last_seen_at?: string;
  last_heartbeat_at?: string;
}

export interface BrowserPlanMachineReachability {
  ok: boolean;
  route: MachineRouteKind;
  source: MachineRouteKind;
  confidence: MachineRouteConfidence;
  local: boolean;
  tailscale_online: boolean | null;
  cacheable: boolean;
  warnings: string[];
}

export interface BrowserPlanCapability {
  state: BrowserPlanCapabilityState;
  command: string;
  version: string | null;
  detail: string | null;
}

export interface BrowserPlanInstallState {
  checked: boolean;
  source: "compatibility" | "not_checked" | "failed";
  browserplan_cli: BrowserPlanCapability;
  machines_cli: BrowserPlanCapability;
  bun: BrowserPlanCapability;
  git: BrowserPlanCapability;
  node: BrowserPlanCapability;
  chrome: BrowserPlanCapability;
  compatibility_summary?: MachineCompatibilityReport["summary"];
  warnings: string[];
}

export interface BrowserPlanWorkspaceSummary {
  workspace_path: string | null;
  project_root: string | null;
  project_root_source: string;
  open_files_root: string | null;
  open_files_root_source: string;
  trust_status: string;
  auth_status: string;
}

export interface BrowserPlanSafeRunnerContract {
  sdk: {
    function: "runMachineCommand";
    machine_id: string;
    command_argument: "<browserplan-owned command>";
    timeout_ms: number;
  };
  cli: {
    command: string[];
    private_metadata_note: string;
  };
  mcp: {
    tool: "machines_ssh_resolve";
    args: {
      machine_id: string;
      remote_command: "<browserplan-owned command>";
      private_metadata: false;
    };
    private_metadata_note: string;
  };
  ownership: {
    command_owner: typeof BROWSERPLAN_APP_ID;
    route_owner: typeof BROWSERPLAN_ROUTE_OWNER;
    secrets_owner: typeof BROWSERPLAN_SECRETS_OWNER;
  };
}

export interface BrowserPlanOperationHook {
  id: BrowserPlanOperationId;
  label: string;
  description: string;
  owner: typeof BROWSERPLAN_APP_ID;
  available: boolean;
  readiness: "ready" | "blocked" | "unknown";
  launch_mode?: "headed" | "headless";
  required_capabilities: string[];
  blocked_by: string[];
  command_template: string;
  command_placeholders: string[];
  safe_runner: BrowserPlanSafeRunnerContract;
}

export interface BrowserPlanMachine {
  machine_id: BrowserPlanMachineId;
  slug: BrowserPlanMachineId;
  display_name: string;
  displayName: string;
  friendly_name: string | null;
  friendlyName: string | null;
  target_group: typeof BROWSERPLAN_TARGET_NAME;
  known: boolean;
  eligible: boolean;
  eligibility_reasons: string[];
  platform: string | null;
  os: string | null;
  user: string | null;
  workspace: BrowserPlanWorkspaceSummary;
  tags: string[];
  updated_at: string | null;
  status: BrowserPlanMachineStatus;
  reachability: BrowserPlanMachineReachability;
  daemon: {
    mode: string | null;
    version: string | null;
    storage_sync_status: string | null;
    heartbeat_status: string;
  };
  install_state: BrowserPlanInstallState;
  operation_hooks: BrowserPlanOperationHook[];
  warnings: string[];
}

export interface BrowserPlanFleet {
  schema_version: typeof MACHINES_CONSUMER_CONTRACT_VERSION;
  package: MachinesContractPackage;
  capabilities: ReturnType<typeof getMachinesConsumerCapabilities>;
  generated_at: string;
  kind: typeof BROWSERPLAN_FLEET_KIND;
  target: {
    name: typeof BROWSERPLAN_TARGET_NAME;
    owner: typeof BROWSERPLAN_APP_ID;
    machine_ids: BrowserPlanMachineId[];
    excluded_machine_ids: BrowserPlanExcludedMachineId[];
    install_target_excludes: BrowserPlanExcludedMachineId[];
  };
  coverage: {
    expected: number;
    returned: number;
    known: number;
    missing: BrowserPlanMachineId[];
    unreachable: BrowserPlanMachineId[];
    excluded_requested: BrowserPlanExcludedMachineId[];
  };
  operation_contract: {
    command_owner: typeof BROWSERPLAN_APP_ID;
    route_owner: typeof BROWSERPLAN_ROUTE_OWNER;
    default_timeout_ms: number;
    private_route_policy: "private targets are omitted unless caller explicitly requests private metadata on a trusted local operator surface";
    supported_operations: BrowserPlanOperationId[];
    stable_surfaces: {
      sdk: "getBrowserPlanFleet";
      cli: "machines browserplan fleet --json";
      api: "/api/browserplan/fleet";
      mcp: "machines_browserplan_fleet";
    };
  };
  machines: BrowserPlanMachine[];
  warnings: string[];
}

const DEFAULT_REMOTE_TIMEOUT_MS = 120_000;
const CAPABILITY_COMMANDS = ["browserplan", "machines", "bun", "git", "node", "google-chrome", "chromium", "chromium-browser"] as const;

function packageInfo(): MachinesContractPackage {
  return {
    name: MACHINES_PACKAGE_NAME,
    version: getPackageVersion(),
  };
}

function isBrowserPlanMachineId(value: string): value is BrowserPlanMachineId {
  return (BROWSERPLAN_MACHINE_IDS as readonly string[]).includes(value);
}

function isExcludedMachineId(value: string): value is BrowserPlanExcludedMachineId {
  return (BROWSERPLAN_EXCLUDED_MACHINE_IDS as readonly string[]).includes(value);
}

export function normalizeBrowserPlanMachineId(value: string): BrowserPlanMachineId | null {
  const normalized = value.trim().toLowerCase();
  if (isBrowserPlanMachineId(normalized)) return normalized;
  const match = normalized.match(/^machine0*(\d{1,2})$/);
  if (!match) return null;
  const index = Number.parseInt(match[1] ?? "", 10);
  if (!Number.isInteger(index) || index < 1 || index > BROWSERPLAN_MACHINE_IDS.length) return null;
  const machineId = `machine${String(index).padStart(3, "0")}`;
  return isBrowserPlanMachineId(machineId) ? machineId : null;
}

function selectedMachineIds(input: string[] | undefined, warnings: string[]): BrowserPlanMachineId[] {
  if (!input || input.length === 0) return [...BROWSERPLAN_MACHINE_IDS];
  const selected: BrowserPlanMachineId[] = [];
  for (const raw of input) {
    const trimmed = raw.trim();
    if (!trimmed) continue;
    const lower = trimmed.toLowerCase();
    if (isExcludedMachineId(lower)) {
      warnings.push(`browserplan_machine_excluded:${lower}`);
      continue;
    }
    const machineId = normalizeBrowserPlanMachineId(trimmed);
    if (!machineId) {
      warnings.push(`browserplan_machine_unsupported:${trimmed}`);
      continue;
    }
    if (!selected.includes(machineId)) selected.push(machineId);
  }
  return selected;
}

function fullTopology(options: BrowserPlanFleetOptions): MachineTopology {
  return discoverMachineTopology({
    includeTailscale: options.includeTailscale === true,
    limit: null,
    offset: 0,
    now: options.now,
  });
}

function findMachine(topology: MachineTopology, machineId: string): MachineTopologyEntry | null {
  return topology.machines.find((machine) => machine.machine_id === machineId) ?? null;
}

function statusForMachine(machine: MachineTopologyEntry | null): BrowserPlanMachineStatus {
  const state = machine?.heartbeat_status === "online" || machine?.tailscale.online === true
    ? "online"
    : machine?.heartbeat_status === "offline" || machine?.tailscale.online === false
      ? "offline"
      : "unknown";
  const label = state === "online" ? "Online" : state === "offline" ? "Offline" : "Unknown";
  const lastSeen = machine?.last_heartbeat_at ?? machine?.tailscale.last_seen ?? undefined;
  return {
    state,
    label,
    online: state === "unknown" ? null : state === "online",
    ...(lastSeen ? { last_seen_at: lastSeen } : {}),
    ...(machine?.last_heartbeat_at ? { last_heartbeat_at: machine.last_heartbeat_at } : {}),
  };
}

function compatibilityState(check: CompatibilityCheck | undefined): BrowserPlanCapabilityState {
  if (!check) return "unknown";
  if (check.status === "ok") return "available";
  if (check.detail.toLowerCase().includes("failed") || check.detail.toLowerCase().includes("timed out")) return "failed";
  return "missing";
}

function commandCheck(report: MachineCompatibilityReport | null, command: string): CompatibilityCheck | undefined {
  const id = `command:${command}:path`;
  return report?.checks.find((check) => check.id === id);
}

function commandVersionCheck(report: MachineCompatibilityReport | null, command: string): CompatibilityCheck | undefined {
  const id = `command:${command}:version`;
  return report?.checks.find((check) => check.id === id);
}

function capability(report: MachineCompatibilityReport | null, command: string): BrowserPlanCapability {
  const pathCheck = commandCheck(report, command);
  const versionCheck = commandVersionCheck(report, command);
  return {
    state: compatibilityState(pathCheck),
    command,
    version: versionCheck?.actual && versionCheck.actual !== "missing" ? versionCheck.actual : null,
    detail: pathCheck?.detail ?? null,
  };
}

function chromeCapability(report: MachineCompatibilityReport | null): BrowserPlanCapability {
  const candidates = ["google-chrome", "chromium", "chromium-browser"].map((command) => capability(report, command));
  const available = candidates.find((entry) => entry.state === "available");
  if (available) return { ...available, command: available.command };
  const failed = candidates.find((entry) => entry.state === "failed");
  return {
    state: failed ? "failed" : report ? "missing" : "unknown",
    command: "google-chrome|chromium|chromium-browser",
    version: null,
    detail: failed?.detail ?? (report ? "No supported Chromium/Chrome command found." : null),
  };
}

function installState(
  machineId: string,
  options: BrowserPlanFleetOptions,
  warnings: string[],
): BrowserPlanInstallState {
  if (options.includeInstallState !== true) {
    const unknown = (command: string): BrowserPlanCapability => ({ state: "unknown", command, version: null, detail: null });
    return {
      checked: false,
      source: "not_checked",
      browserplan_cli: unknown("browserplan"),
      machines_cli: unknown("machines"),
      bun: unknown("bun"),
      git: unknown("git"),
      node: unknown("node"),
      chrome: unknown("google-chrome|chromium|chromium-browser"),
      warnings: ["install_state_not_checked"],
    };
  }

  try {
    const report = checkMachineCompatibility({
      machineId,
      commands: CAPABILITY_COMMANDS.map((command) => ({ command, required: false })),
      packages: [
        { name: MACHINES_PACKAGE_NAME, command: "machines", required: false },
        { name: BROWSERPLAN_PACKAGE_NAME, command: BROWSERPLAN_CLI_COMMAND, required: false },
      ],
      runner: options.runner,
      now: options.now,
    });
    return {
      checked: true,
      source: "compatibility",
      browserplan_cli: capability(report, "browserplan"),
      machines_cli: capability(report, "machines"),
      bun: capability(report, "bun"),
      git: capability(report, "git"),
      node: capability(report, "node"),
      chrome: chromeCapability(report),
      compatibility_summary: report.summary,
      warnings: [],
    };
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    warnings.push(`browserplan_install_state_failed:${machineId}:${message}`);
    const failed = (command: string): BrowserPlanCapability => ({ state: "failed", command, version: null, detail: message });
    return {
      checked: true,
      source: "failed",
      browserplan_cli: failed("browserplan"),
      machines_cli: failed("machines"),
      bun: failed("bun"),
      git: failed("git"),
      node: failed("node"),
      chrome: failed("google-chrome|chromium|chromium-browser"),
      warnings: [message],
    };
  }
}

function workspaceSummary(machineId: string, topology: MachineTopology, machine: MachineTopologyEntry | null, now?: Date): BrowserPlanWorkspaceSummary {
  try {
    const workspace = resolveMachineWorkspace({
      machineId,
      projectId: BROWSERPLAN_APP_ID,
      repoName: BROWSERPLAN_APP_ID,
      topology,
      now,
    });
    return {
      workspace_path: machine?.workspace_path ?? null,
      project_root: workspace.paths.project_root.path,
      project_root_source: workspace.paths.project_root.source,
      open_files_root: workspace.paths.open_files_root.path,
      open_files_root_source: workspace.paths.open_files_root.source,
      trust_status: workspace.machine.trust_status,
      auth_status: workspace.machine.auth_status,
    };
  } catch {
    return {
      workspace_path: machine?.workspace_path ?? null,
      project_root: null,
      project_root_source: "unresolved",
      open_files_root: null,
      open_files_root_source: "unresolved",
      trust_status: "unknown",
      auth_status: "unknown",
    };
  }
}

function safeRunner(machineId: string): BrowserPlanSafeRunnerContract {
  return {
    sdk: {
      function: "runMachineCommand",
      machine_id: machineId,
      command_argument: "<browserplan-owned command>",
      timeout_ms: DEFAULT_REMOTE_TIMEOUT_MS,
    },
    cli: {
      command: ["machines", "ssh", "--machine", machineId, "--cmd", "<browserplan-owned command>", "--json"],
      private_metadata_note: "Add --private-metadata only on trusted operator surfaces when the concrete SSH command must be printed or executed.",
    },
    mcp: {
      tool: "machines_ssh_resolve",
      args: {
        machine_id: machineId,
        remote_command: "<browserplan-owned command>",
        private_metadata: false,
      },
      private_metadata_note: "Set private_metadata:true only on trusted operator surfaces when the concrete SSH command must be printed or executed.",
    },
    ownership: {
      command_owner: BROWSERPLAN_APP_ID,
      route_owner: BROWSERPLAN_ROUTE_OWNER,
      secrets_owner: BROWSERPLAN_SECRETS_OWNER,
    },
  };
}

function operationHook(input: {
  id: BrowserPlanOperationId;
  label: string;
  description: string;
  machineId: string;
  commandTemplate: string;
  placeholders: string[];
  requiredCapabilities: string[];
  routeReady: boolean;
  known: boolean;
  launchMode?: "headed" | "headless";
  installState: BrowserPlanInstallState;
}): BrowserPlanOperationHook {
  const blockedBy: string[] = [];
  if (!input.known) blockedBy.push("machine_missing_from_open_machines_topology");
  if (!input.routeReady) blockedBy.push("route_unavailable_or_low_confidence");
  if (input.installState.checked && input.requiredCapabilities.includes("browserplan_cli") && input.installState.browserplan_cli.state !== "available") {
    blockedBy.push("browserplan_cli_missing");
  }
  if (input.installState.checked && input.requiredCapabilities.includes("bun") && input.installState.bun.state !== "available") {
    blockedBy.push("bun_missing");
  }
  if (input.installState.checked && input.requiredCapabilities.includes("git") && input.installState.git.state !== "available") {
    blockedBy.push("git_missing");
  }
  if (input.installState.checked && input.requiredCapabilities.includes("chrome") && input.installState.chrome.state !== "available") {
    blockedBy.push("chrome_missing");
  }
  const readiness = blockedBy.length > 0 ? "blocked" : input.installState.checked ? "ready" : "unknown";
  return {
    id: input.id,
    label: input.label,
    description: input.description,
    owner: BROWSERPLAN_APP_ID,
    available: blockedBy.length === 0,
    readiness,
    ...(input.launchMode ? { launch_mode: input.launchMode } : {}),
    required_capabilities: input.requiredCapabilities,
    blocked_by: blockedBy,
    command_template: input.commandTemplate,
    command_placeholders: input.placeholders,
    safe_runner: safeRunner(input.machineId),
  };
}

function operationHooks(machineId: string, routeReady: boolean, known: boolean, install: BrowserPlanInstallState, workspace: BrowserPlanWorkspaceSummary): BrowserPlanOperationHook[] {
  void workspace;
  return [
    operationHook({
      id: "profile_setup",
      label: "Profile setup",
      description: "Create or update a BrowserPlan profile on the target machine.",
      machineId,
      commandTemplate: "browserplan profile create <profile-name> --machine <machine-id> --json",
      placeholders: ["profile-name", "machine-id"],
      requiredCapabilities: ["browserplan_cli"],
      routeReady,
      known,
      installState: install,
    }),
    operationHook({
      id: "headed_launch",
      label: "Headed launch",
      description: "Launch a BrowserPlan profile with a visible browser on the target machine.",
      machineId,
      commandTemplate: "browserplan profile launch <profile-id> --json",
      placeholders: ["profile-id"],
      requiredCapabilities: ["browserplan_cli", "chrome"],
      routeReady,
      known,
      launchMode: "headed",
      installState: install,
    }),
    operationHook({
      id: "headless_launch",
      label: "Headless launch",
      description: "Launch a BrowserPlan profile with headless Chromium on the target machine.",
      machineId,
      commandTemplate: "browserplan profile launch <profile-id> --headless --json",
      placeholders: ["profile-id"],
      requiredCapabilities: ["browserplan_cli", "chrome"],
      routeReady,
      known,
      launchMode: "headless",
      installState: install,
    }),
    operationHook({
      id: "daemon_status",
      label: "Daemon status",
      description: "Inspect BrowserPlan/open-chrome browser runtime status on the target machine.",
      machineId,
      commandTemplate: "browserplan browser status --json",
      placeholders: [],
      requiredCapabilities: ["browserplan_cli"],
      routeReady,
      known,
      installState: install,
    }),
    operationHook({
      id: "supervisor_status",
      label: "Supervisor status",
      description: "Inspect the remote open-chrome server supervisor for the target machine.",
      machineId,
      commandTemplate: "browserplan remote status --machine <machine-id> --json",
      placeholders: ["machine-id"],
      requiredCapabilities: ["browserplan_cli"],
      routeReady,
      known,
      installState: install,
    }),
    operationHook({
      id: "tab_inventory",
      label: "Tab inventory",
      description: "List BrowserPlan-controlled tabs on the target machine.",
      machineId,
      commandTemplate: "browserplan tab list --json",
      placeholders: [],
      requiredCapabilities: ["browserplan_cli"],
      routeReady,
      known,
      installState: install,
    }),
    operationHook({
      id: "session_inventory",
      label: "Session inventory",
      description: "List BrowserPlan profiles/sessions on the target machine.",
      machineId,
      commandTemplate: "browserplan profile list --json",
      placeholders: [],
      requiredCapabilities: ["browserplan_cli"],
      routeReady,
      known,
      installState: install,
    }),
    operationHook({
      id: "app_install_update",
      label: "Install/update app",
      description: `Install or update the BrowserPlan CLI from the ${BROWSERPLAN_PACKAGE_NAME} npm package on the target machine.`,
      machineId,
      commandTemplate: BROWSERPLAN_INSTALL_UPDATE_COMMAND_TEMPLATE,
      placeholders: [BROWSERPLAN_INSTALL_VERSION_PLACEHOLDER],
      requiredCapabilities: ["bun"],
      routeReady,
      known,
      installState: install,
    }),
  ];
}

function reachability(machineId: string, topology: MachineTopology, now?: Date): BrowserPlanMachineReachability {
  const route = resolveMachineRoute(machineId, { topology, now });
  return {
    ok: route.ok,
    route: route.route,
    source: route.source,
    confidence: route.confidence,
    local: route.local,
    tailscale_online: route.evidence.tailscale_online,
    cacheable: route.cacheability.cacheable,
    warnings: route.warnings,
  };
}

function eligibilityReasons(machine: MachineTopologyEntry | null, reach: BrowserPlanMachineReachability): string[] {
  const reasons: string[] = [];
  if (!machine) reasons.push("machine_missing_from_open_machines_topology");
  if (!reach.ok) reasons.push("route_unavailable");
  if (reach.confidence === "low" || reach.confidence === "none") reasons.push(`route_confidence_${reach.confidence}`);
  return reasons;
}

function browserPlanMachine(machineId: BrowserPlanMachineId, topology: MachineTopology, options: BrowserPlanFleetOptions): BrowserPlanMachine {
  const machine = findMachine(topology, machineId);
  const displayName = machine?.display_name ?? machineId;
  const friendlyName = machine?.friendly_name ?? null;
  const warnings: string[] = [];
  if (!machine) warnings.push(`browserplan_machine_missing:${machineId}`);
  const reach = reachability(machineId, topology, options.now);
  const install = installState(machineId, options, warnings);
  const workspace = workspaceSummary(machineId, topology, machine, options.now);
  const reasons = eligibilityReasons(machine, reach);
  const routeReady = reasons.length === 0;
  return {
    machine_id: machineId,
    slug: machineId,
    display_name: displayName,
    displayName,
    friendly_name: friendlyName,
    friendlyName,
    target_group: BROWSERPLAN_TARGET_NAME,
    known: Boolean(machine),
    eligible: routeReady,
    eligibility_reasons: reasons,
    platform: machine?.platform ? String(machine.platform) : null,
    os: machine?.os ?? null,
    user: machine?.user ?? null,
    workspace,
    tags: machine?.tags ?? [],
    updated_at: machine?.updated_at ?? null,
    status: statusForMachine(machine),
    reachability: reach,
    daemon: {
      mode: machine?.agent.mode ?? null,
      version: machine?.agent.daemon_version ?? null,
      storage_sync_status: machine?.agent.storage_sync_status ?? null,
      heartbeat_status: machine?.heartbeat_status ?? "unknown",
    },
    install_state: install,
    operation_hooks: operationHooks(machineId, routeReady, Boolean(machine), install, workspace),
    warnings,
  };
}

export function getBrowserPlanFleet(options: BrowserPlanFleetOptions = {}): BrowserPlanFleet {
  const warnings: string[] = [];
  const machineIds = selectedMachineIds(options.machineIds, warnings);
  const topology = options.topology ?? fullTopology(options);
  const machines = machineIds.map((machineId) => browserPlanMachine(machineId, topology, options));
  const missing = machines.filter((machine) => !machine.known).map((machine) => machine.machine_id);
  const unreachable = machines.filter((machine) => machine.known && !machine.reachability.ok).map((machine) => machine.machine_id);
  const excludedRequested = warnings
    .filter((warning) => warning.startsWith("browserplan_machine_excluded:"))
    .map((warning) => warning.slice("browserplan_machine_excluded:".length))
    .filter((value): value is BrowserPlanExcludedMachineId => isExcludedMachineId(value));

  return {
    schema_version: MACHINES_CONSUMER_CONTRACT_VERSION,
    package: packageInfo(),
    capabilities: getMachinesConsumerCapabilities(),
    generated_at: (options.now ?? new Date()).toISOString(),
    kind: BROWSERPLAN_FLEET_KIND,
    target: {
      name: BROWSERPLAN_TARGET_NAME,
      owner: BROWSERPLAN_APP_ID,
      machine_ids: [...BROWSERPLAN_MACHINE_IDS],
      excluded_machine_ids: [...BROWSERPLAN_EXCLUDED_MACHINE_IDS],
      install_target_excludes: [...BROWSERPLAN_EXCLUDED_MACHINE_IDS],
    },
    coverage: {
      expected: machineIds.length,
      returned: machines.length,
      known: machines.length - missing.length,
      missing,
      unreachable,
      excluded_requested: excludedRequested,
    },
    operation_contract: {
      command_owner: BROWSERPLAN_APP_ID,
      route_owner: BROWSERPLAN_ROUTE_OWNER,
      default_timeout_ms: DEFAULT_REMOTE_TIMEOUT_MS,
      private_route_policy: "private targets are omitted unless caller explicitly requests private metadata on a trusted local operator surface",
      supported_operations: [
        "profile_setup",
        "headed_launch",
        "headless_launch",
        "daemon_status",
        "supervisor_status",
        "tab_inventory",
        "session_inventory",
        "app_install_update",
      ],
      stable_surfaces: {
        sdk: "getBrowserPlanFleet",
        cli: "machines browserplan fleet --json",
        api: "/api/browserplan/fleet",
        mcp: "machines_browserplan_fleet",
      },
    },
    machines,
    warnings: [...new Set([...topology.warnings, ...warnings, ...machines.flatMap((machine) => machine.warnings)])],
  };
}
