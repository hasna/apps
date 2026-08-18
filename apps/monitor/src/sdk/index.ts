/**
 * @hasna/monitor SDK — MonitorService facade (MON-V2-15).
 *
 * The `@hasna/monitor/sdk` export keeps the full library surface (`export *
 * from "../index.js"`) and adds the MonitorService facade: one domain
 * operation per method, each delegating to the shared implementation
 * modules. No interface (CLI, MCP, SDK) carries a second implementation of
 * a monitor operation.
 *
 * Parity contract, enforced by tests in this directory:
 * - `SDK_METHODS` is the shared operation set;
 * - `MCP_TOOL_MAP` is a bijection between the MCP tool names and that set;
 * - `CLI_TO_METHOD` maps every CLI shared-core command onto the same set.
 */

// The package's library surface, preserved for `@hasna/monitor/sdk` consumers.
// Named exports declared below shadow the identical names re-exported here.
export * from "../index.js";

import { ProcessManager, processInfoToRow, type KillSignal, type ProcessReport } from "../process-manager/index.js";
import { getCollectorForMachine, listKnownMachineIds } from "../collectors/index.js";
import {
  collectMachineDiagnostics,
  collectRuntimeHealthAcrossMachines,
  mergeStoredAndLiveAlerts,
} from "../runtime-health.js";
import { executeTmuxCommand, type TmuxExecOptions } from "../tmux.js";
import { MONITOR_VERSION } from "../version.js";
import {
  listInstalledApps,
  listInstalledAppsAcrossMachines,
} from "../apps.js";
import {
  listManagedServices,
  manageService,
  type ServiceAction,
  type ServiceActionResult,
  type ServiceListResult,
} from "../services.js";
import {
  getMcpProcessStatus,
  getMcpProcessStatusAcrossMachines,
  restartMcpServer,
} from "../mcp-processes.js";
import {
  scanListeningPorts,
  scanListeningPortsAcrossMachines,
} from "../ports.js";
import {
  getTailscaleStatus,
  getTailscaleStatusAcrossMachines,
} from "../tailscale.js";
import {
  getTemperatureStatus,
  getTemperatureStatusAcrossMachines,
} from "../temperature.js";
import {
  getContainerLogs,
  listContainers,
  listContainersAcrossMachines,
} from "../containers.js";
import {
  deleteMachine,
  getCronJob,
  insertCronJob,
  insertFeedback,
  insertMachine,
  listAgents,
  listAlerts,
  listCronJobs,
  listMachines,
  updateAgentFocus,
  updateAgentHeartbeat,
  updateCronJob,
  upsertAgent,
} from "../db/queries.js";
import { search } from "../db/search.js";
import { loadConfig, saveConfig } from "../config.js";
import type { IntegrationsConfig } from "../config.js";
import type { AgentRow } from "../db/queries.js";
import type { CronJobRow, ProcessRow } from "../db/schema.js";

/** The parity operation set — one entry per MCP tool. */
export const SDK_METHODS = [
  "snapshot",
  "health",
  "mcpHealth",
  "mcpStatus",
  "mcpRestart",
  "processes",
  "apps",
  "services",
  "exec",
  "ports",
  "tailscale",
  "temperature",
  "containers",
  "containerLogs",
  "kill",
  "machinesList",
  "machineAdd",
  "alerts",
  "doctor",
  "cron",
  "search",
  "registerAgent",
  "agentHeartbeat",
  "agentSetFocus",
  "listAgents",
  "integrations",
  "sendFeedback",
] as const;

export type MonitorMethod = (typeof SDK_METHODS)[number];

/** Bijection between the MCP tool names and the SDK operation set. */
export const MCP_TOOL_MAP = {
  monitor_snapshot: "snapshot",
  monitor_health: "health",
  monitor_mcp_health: "mcpHealth",
  monitor_mcp_status: "mcpStatus",
  monitor_mcp_restart: "mcpRestart",
  monitor_processes: "processes",
  monitor_apps: "apps",
  monitor_service: "services",
  monitor_exec: "exec",
  monitor_ports: "ports",
  monitor_tailscale: "tailscale",
  monitor_temperature: "temperature",
  monitor_containers: "containers",
  monitor_container_logs: "containerLogs",
  monitor_kill: "kill",
  monitor_machines: "machinesList",
  monitor_add_machine: "machineAdd",
  monitor_alerts: "alerts",
  monitor_cron_jobs: "cron",
  monitor_doctor: "doctor",
  monitor_search: "search",
  monitor_register_agent: "registerAgent",
  monitor_heartbeat: "agentHeartbeat",
  monitor_set_focus: "agentSetFocus",
  monitor_list_agents: "listAgents",
  monitor_configure_integrations: "integrations",
  monitor_send_feedback: "sendFeedback",
} as const satisfies Record<string, MonitorMethod>;

/** CLI shared-core commands and the SDK operation each one runs. */
export const CLI_TO_METHOD = {
  health: "health",
  machines: "machinesList",
  add: "machineAdd",
  doctor: "doctor",
  ps: "processes",
  "mcp-health": "mcpHealth",
  "mcp-status": "mcpStatus",
  "mcp-restart": "mcpRestart",
  exec: "exec",
  kill: "kill",
  alerts: "alerts",
  apps: "apps",
  "compare-apps": "apps",
  service: "services",
  temperature: "temperature",
  ports: "ports",
  tailscale: "tailscale",
  containers: "containers",
  cron: "cron",
  search: "search",
  integrations: "integrations",
} as const satisfies Record<string, MonitorMethod>;

export type MachineDiagnostics = Awaited<ReturnType<typeof collectMachineDiagnostics>>;
export type MachineHealthResult = Awaited<ReturnType<typeof collectRuntimeHealthAcrossMachines>>[number];

export interface MachineAddInput {
  name: string;
  type: "local" | "ssh" | "ec2";
  host?: string | null;
  port?: number | null;
  ssh_key_path?: string | null;
  aws_region?: string | null;
  aws_instance_id?: string | null;
}

export interface CronAddInput {
  machine_id?: string | null;
  name: string;
  schedule: string;
  command: string;
  action_type?: CronJobRow["action_type"];
  action_config?: string;
  enabled?: number;
}

export interface FeedbackInput {
  source: "agent" | "user";
  rating: number;
  message: string;
  metadata?: string;
}

export interface AgentInput {
  id: string;
  name: string;
  metadata?: string;
}

export interface ExecInput extends Omit<TmuxExecOptions, "target"> {
  target: string;
}

export interface MachineListItem {
  id: string;
  name: string;
  type: string;
  host: string | null;
  port: number | null;
  ssh_key_path: string | null;
  aws_region: string | null;
  aws_instance_id: string | null;
  tags: string;
  created_at: number;
  last_seen: number | null;
  status: string;
}

export interface ProcessQueryResult {
  allRows: ProcessRow[];
  report: ProcessReport;
  processes: ProcessRow[];
}

/**
 * The single domain facade for @hasna/monitor. All operations delegate to
 * the shared implementation modules. Interface layers (CLI, MCP) call this
 * facade; they never re-implement an operation.
 */
export class MonitorService {
  private readonly pm = new ProcessManager();

  /** Collect a live compact/live system snapshot for a machine. */
  async snapshot(machineId = "local") {
    return collectMachineDiagnostics(machineId);
  }

  /** Run health checks on a machine and return the DoctorReport. */
  async health(machineId = "local") {
    return collectMachineDiagnostics(machineId);
  }

  /** MCP/tmux runtime health for one machine or every configured machine. */
  async mcpHealth(machineId: string | undefined, all: true): Promise<MachineHealthResult[]>;
  async mcpHealth(machineId: string | undefined, all?: false): Promise<MachineDiagnostics>;
  async mcpHealth(machineId: string | undefined, all = false) {
    if (all) {
      return collectRuntimeHealthAcrossMachines(listKnownMachineIds());
    }
    return collectMachineDiagnostics(machineId ?? "local");
  }

  /** MCP process status for one machine or every configured machine. */
  async mcpStatus(machineId: string | undefined, all = false) {
    if (all) {
      return getMcpProcessStatusAcrossMachines();
    }
    return [await getMcpProcessStatus(machineId ?? "local")];
  }

  /** Restart a matched MCP server process, or re-check health when none matches. */
  async mcpRestart(name: string, machineId = "local") {
    return restartMcpServer(name, machineId);
  }

  /**
   * Collect and analyse live processes on a machine.
   * Throws with the collector error when collection fails.
   */
  async processes(
    machineId = "local",
    filter: "all" | "zombies" | "orphans" | "high_mem" = "all"
  ): Promise<ProcessQueryResult> {
    const collector = getCollectorForMachine(machineId);
    const result = await collector.collect();
    if (!result.ok) {
      throw new Error(result.error);
    }

    const allRows = result.snapshot.processes.map((p) => processInfoToRow(p, machineId));
    const report = this.pm.analyse(allRows);

    let filtered = allRows;
    switch (filter) {
      case "zombies":
        filtered = report.zombies;
        break;
      case "orphans":
        filtered = report.orphans;
        break;
      case "high_mem":
        filtered = report.highMem;
        break;
    }

    const processes = [...filtered].sort(
      (a, b) => (b.cpu_percent ?? 0) - (a.cpu_percent ?? 0)
    );

    return { allRows, report, processes };
  }

  /** Installed-app inventories for one machine, or every machine with comparison. */
  async apps(machineId: string | undefined, all = false, compare = false) {
    if (all || compare) {
      return listInstalledAppsAcrossMachines();
    }
    return [await listInstalledApps(machineId ?? "local")];
  }

  /** List managed services on a machine. */
  async services(
    machineId: string | undefined,
    action: "list",
    name?: string
  ): Promise<ServiceListResult>;
  /** Manage (start/stop/restart) a service on a machine. */
  async services(
    machineId: string | undefined,
    action: ServiceAction,
    name?: string
  ): Promise<ServiceActionResult>;
  async services(
    machineId: string | undefined,
    action: "list" | ServiceAction,
    name?: string
  ) {
    if (action === "list") {
      return listManagedServices(machineId ?? "local");
    }
    return manageService(action, name ?? "", machineId ?? "local");
  }

  /** Send keys to a tmux target, or broadcast to all panes on a machine. */
  async exec(machineId: string | undefined, options: ExecInput) {
    const collector = getCollectorForMachine(machineId ?? "local");
    return executeTmuxCommand(collector, {
      target: options.target ?? "",
      all: options.all,
      command: options.command,
      enter: options.enter,
      timeoutMs: options.timeoutMs,
    });
  }

  /** Listening TCP/UDP sockets for one machine or every configured machine. */
  async ports(machineId: string | undefined, all = false) {
    if (all) {
      return scanListeningPortsAcrossMachines();
    }
    return [await scanListeningPorts(machineId ?? "local")];
  }

  /** Tailscale status for one machine or every configured machine. */
  async tailscale(machineId: string | undefined, all = false) {
    if (all) {
      return getTailscaleStatusAcrossMachines();
    }
    return [await getTailscaleStatus(machineId ?? "local")];
  }

  /** Thermal status for one machine or every configured machine. */
  async temperature(machineId: string | undefined, all = false) {
    if (all) {
      return getTemperatureStatusAcrossMachines();
    }
    return [await getTemperatureStatus(machineId ?? "local")];
  }

  /** Containers for one machine or every configured machine. */
  async containers(machineId: string | undefined, all = false) {
    if (all) {
      return listContainersAcrossMachines();
    }
    return [await listContainers(machineId ?? "local")];
  }

  /** Container logs for one container on one machine. */
  async containerLogs(machineId: string | undefined, container: string, tail = 100) {
    return getContainerLogs(container, machineId ?? "local", tail);
  }

  /** Terminate a process by PID on a machine. */
  async kill(machineId: string | undefined, pid: number, signal: KillSignal) {
    return this.pm.kill(pid, signal, machineId ?? "local");
  }

  /** List registered/configured machines, falling back to the config file. */
  machinesList(): MachineListItem[] {
    try {
      return listMachines();
    } catch {
      return this.machinesFromConfig();
    }
  }

  /** Machines derived from the config file when the DB is unavailable. */
  machinesFromConfig(): MachineListItem[] {
    const config = loadConfig();
    return config.machines.map((m) => ({
      id: m.id,
      name: m.label,
      type: m.type,
      host: m.ssh?.host ?? null,
      port: m.ssh?.port ?? null,
      ssh_key_path: m.ssh?.privateKeyPath ?? null,
      aws_region: m.ec2?.region ?? null,
      aws_instance_id: m.ec2?.instanceId ?? null,
      tags: "{}",
      created_at: 0,
      last_seen: null,
      status: "unknown",
    }));
  }

  /** Register a machine and return its derived id. */
  machineAdd(input: MachineAddInput): string {
    const id = input.name.toLowerCase().replace(/\s+/g, "-");
    insertMachine({
      id,
      name: input.name,
      type: input.type,
      host: input.host ?? null,
      port: input.port ?? null,
      ssh_key_path: input.ssh_key_path ?? null,
      aws_region: input.aws_region ?? null,
      aws_instance_id: input.aws_instance_id ?? null,
      tags: "{}",
      last_seen: null,
      status: "unknown",
    });
    return id;
  }

  /** Delete a machine by id. */
  machineDelete(id: string): void {
    deleteMachine(id);
  }

  /** Stored alerts, optionally merged with live doctor findings for one machine. */
  async alerts(machineId: string | undefined, unresolvedOnly = true) {
    if (machineId) {
      const { doctorReport } = await collectMachineDiagnostics(machineId);
      return unresolvedOnly
        ? mergeStoredAndLiveAlerts(machineId, doctorReport)
        : listAlerts(machineId, unresolvedOnly);
    }
    return listAlerts(undefined, unresolvedOnly);
  }

  /** Run live diagnostics on a machine. */
  async doctor(machineId = "local") {
    return collectMachineDiagnostics(machineId);
  }

  /** Cron operations: list, add, toggle. */
  cron(action: "list" | "add" | "toggle", input: Partial<CronAddInput> & { job_id?: number }): unknown {
    switch (action) {
      case "list": {
        try {
          return listCronJobs(input.machine_id ?? undefined);
        } catch {
          return [];
        }
      }
      case "add": {
        if (!input.name || !input.schedule || !input.command) {
          throw new Error("cron add requires name, schedule, and command");
        }
        return insertCronJob({
          machine_id: input.machine_id ?? null,
          name: input.name,
          schedule: input.schedule,
          command: input.command,
          action_type: input.action_type ?? "shell",
          action_config: input.action_config ?? "{}",
          enabled: input.enabled ?? 1,
          last_run_at: null,
          last_run_status: null,
        });
      }
      case "toggle": {
        if (!input.job_id) {
          throw new Error("job_id is required for toggle action");
        }
        const job = getCronJob(input.job_id);
        if (!job) {
          throw new Error(`Cron job ${input.job_id} not found`);
        }
        const newEnabled = job.enabled ? 0 : 1;
        updateCronJob(input.job_id, { enabled: newEnabled });
        return newEnabled;
      }
      default: {
        const exhaustive: never = action;
        return exhaustive;
      }
    }
  }

  /** Full-text search over machines, alerts, and processes. */
  search(query: string, tables?: string[]) {
    return search(query, tables);
  }

  /** Register an agent in the agent registry. */
  registerAgent(input: AgentInput): void {
    upsertAgent({ id: input.id, name: input.name, metadata: input.metadata ?? "{}" });
  }

  /** Record an agent heartbeat. */
  agentHeartbeat(id: string): void {
    updateAgentHeartbeat(id);
  }

  /** Update an agent's current focus. */
  agentSetFocus(id: string, focus: string | null): void {
    updateAgentFocus(id, focus);
  }

  /** List registered agents. */
  listAgents(): AgentRow[] {
    return listAgents();
  }

  /** Get or set the configured integrations. */
  integrations(action: "get" | "set", value?: IntegrationsConfig) {
    if (action === "get") {
      const config = loadConfig();
      return config.integrations ?? {};
    }
    const config = loadConfig();
    config.integrations = value ?? {};
    saveConfig(config);
    return config.integrations;
  }

  /** Record agent or user feedback. */
  sendFeedback(input: FeedbackInput): number {
    return insertFeedback({
      source: input.source,
      rating: input.rating,
      message: input.message,
      metadata: input.metadata ?? "{}",
    });
  }

  /** The package version. */
  version(): string {
    return MONITOR_VERSION;
  }
}

/** Create a MonitorService instance. */
export function createMonitorService(): MonitorService {
  return new MonitorService();
}
