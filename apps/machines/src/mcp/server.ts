import { EventsClient, sanitizeChannelForOutput, sanitizeChannelsForOutput } from "@hasna/events";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import { getPackageVersion } from "../version.js";
import { buildBackupPlan, runBackup } from "../commands/backup.js";
import { buildAppsPlan, diffApps, getAppsStatus, listApps, runAppsPlan } from "../commands/apps.js";
import { buildCertPlan, runCertPlan } from "../commands/cert.js";
import { addDomainMapping, listDomainMappings, renderDomainMapping } from "../commands/dns.js";
import { diffMachines } from "../commands/diff.js";
import { buildDaemonServicePlan } from "../commands/daemon.js";
import { runDoctor } from "../commands/doctor.js";
import { buildClaudeInstallPlan, diffClaudeCli, getClaudeCliStatus, runClaudeInstallPlan } from "../commands/install-claude.js";
import { buildTailscaleInstallPlan, runTailscaleInstallPlan } from "../commands/install-tailscale.js";
import {
  addNotificationChannel,
  createTrustedNotificationApproval,
  dispatchNotificationEvent,
  listNotificationChannels,
  removeNotificationChannel,
  testNotificationChannel,
} from "../commands/notifications.js";
import { listPorts } from "../commands/ports.js";
import { getServeInfo, renderDashboardHtml } from "../commands/serve.js";
import { PRIVATE_OUTPUT_DENIED_WARNING, isPrivateOutputEnabled } from "../redaction.js";
import { runSelfTest } from "../commands/self-test.js";
import { buildSshCommand } from "../commands/ssh.js";
import { getStatus } from "../commands/status.js";
import {
  clearMachineFriendlyNameMutationArgs,
  machineFriendlyNameResourceId,
  manifestBootstrapCurrentMachine,
  manifestClearFriendlyName,
  manifestGet,
  manifestGetFriendlyName,
  manifestList,
  manifestRemove,
  manifestSetFriendlyName,
  manifestValidate,
  setMachineFriendlyNameMutationArgs,
} from "../commands/manifest.js";
import { buildSetupPlan, runSetupPlan } from "../commands/setup.js";
import { buildSyncPlan, runSyncPlan } from "../commands/sync.js";
import { getAgentStatus } from "../agent/runtime.js";
import { discoverMachineTopology, redactRouteForOutput, redactTopologyForOutput, resolveMachineRoute, resolveMachineWorkspace } from "../topology.js";
import { listMachineTrashPolicies, resolveNoteMachineContext } from "../notes.js";
import { resolveMachineDetails } from "../details.js";
import { getBrowserPlanFleet } from "../browserplan.js";
import { checkMachineCompatibility } from "../compatibility.js";
import {
  getCommandMatrix,
  getFleetLoopPreflight,
  getFleetMachineHealth,
  getFleetRouting,
} from "../agent-abstractions.js";
import { getDispatchFleetSmoke } from "../dispatch-smoke.js";
import { getStorageStatus, resolveTables, storagePull, storagePush, storageSync } from "../storage.js";
import { assertMutationApproved, createTrustedSdkMutationApproval, mutationPlanDigest } from "../commands/mutation-approval.js";

export const MACHINE_MCP_TOOL_NAMES = [
  "machines_status",
  "machines_doctor",
  "machines_self_test",
  "machines_apps_list",
  "machines_apps_status",
  "machines_apps_diff",
  "machines_apps_plan",
  "machines_apps_apply",
  "machines_manifest",
  "machines_manifest_validate",
  "machines_manifest_bootstrap",
  "machines_manifest_get",
  "machines_friendly_name_get",
  "machines_friendly_name_set",
  "machines_friendly_name_clear",
  "machines_details",
  "machines_browserplan_fleet",
  "machines_notes_context",
  "machines_notes_trash_policies",
  "machines_manifest_remove",
  "machines_agent_status",
  "machines_daemon_status",
  "machines_daemon_service_plan",
  "machines_setup_preview",
  "machines_setup_apply",
  "machines_sync_preview",
  "machines_sync_apply",
  "machines_topology",
  "machines_machine_health",
  "machines_routing",
  "machines_command_matrix",
  "machines_loop_preflight",
  "machines_dispatch_fleet_smoke",
  "machines_compatibility",
  "machines_diff",
  "machines_install_tailscale_preview",
  "machines_install_tailscale_apply",
  "machines_install_claude_status",
  "machines_install_claude_diff",
  "machines_install_claude_preview",
  "machines_install_claude_apply",
  "machines_route_resolve",
  "machines_workspace_resolve",
  "machines_ssh_resolve",
  "machines_ports",
  "machines_backup_preview",
  "machines_backup_apply",
  "machines_cert_preview",
  "machines_cert_apply",
  "machines_dns_add",
  "machines_dns_list",
  "machines_dns_render",
  "machines_notifications_add",
  "machines_notifications_list",
  "machines_notifications_test",
  "machines_notifications_dispatch",
  "machines_notifications_remove",
  "machines_webhooks_add",
  "machines_webhooks_list",
  "machines_webhooks_test",
  "machines_webhooks_remove",
  "machines_events_emit",
  "machines_events_list",
  "machines_events_replay",
  "machines_serve_info",
  "machines_serve_dashboard",
  "storage_status",
  "storage_push",
  "storage_pull",
  "storage_sync",
] as const;

export interface McpServerOptions {
  mutationTransport?: "mcp:stdio" | "mcp:http" | "mcp:memory" | (string & {});
}

export function buildServer(version: string = getPackageVersion(), options: McpServerOptions = {}): McpServer {
  return createMcpServer(version, options);
}

function privateMetadataAllowed(requested: boolean | undefined): boolean {
  return requested === true && isPrivateOutputEnabled();
}

function privateOutputWarnings(requested: boolean | undefined, allowed: boolean): string[] {
  return requested === true && !allowed ? [PRIVATE_OUTPUT_DENIED_WARNING] : [];
}

function appendWarnings<T>(payload: T, warnings: string[]): T {
  if (warnings.length === 0) return payload;
  const currentWarnings = typeof payload === "object" && payload && "warnings" in payload && Array.isArray(payload.warnings)
    ? payload.warnings
    : [];
  return { ...(payload as Record<string, unknown>), warnings: [...currentWarnings, ...warnings] } as T;
}

const approvalTokenSchema = z.string().optional().describe("Operator mutation approval token");

function mutationMachineId(machineId: string | null | undefined): string {
  return machineId?.trim() || "local";
}

function mutationResourceId(kind: string, ...parts: Array<string | number | boolean | undefined | null>): string {
  const values = parts
    .map((part) => String(part ?? "*").trim())
    .filter(Boolean)
    .join(":");
  return values ? `${kind}:${values}` : kind;
}

function mutationCallerId(): string {
  return process.env["HASNA_MACHINES_MUTATION_CALLER_ID"]?.trim() || "mcp";
}

function mutationRunId(): string {
  return process.env["HASNA_MACHINES_MUTATION_RUN_ID"]?.trim() || "mcp";
}

function assertScopedMcpMutation(
  operation: string,
  approvalToken: string | undefined,
  scope: { machineId?: string | null; resourceId?: string | null; args?: unknown } = {},
  transport: string,
): void {
  assertMutationApproved({
    surface: "mcp",
    operation,
    transport,
    callerId: mutationCallerId(),
    runId: mutationRunId(),
    machineId: scope.machineId === undefined ? undefined : mutationMachineId(scope.machineId),
    resourceId: scope.resourceId === undefined || scope.resourceId === null ? undefined : scope.resourceId,
    args: scope.args,
    approvalToken,
  });
}

function mcpPlanApprovalArgs<T extends Record<string, unknown>>(args: T, plan: unknown): T & { plan_digest: string } {
  return {
    ...args,
    plan_digest: mutationPlanDigest(plan),
  };
}

function mcpPlanResourceId(operation: string, machineId: string, plan: unknown): string {
  return mutationResourceId("plan", operation, machineId, mutationPlanDigest(plan));
}

export function createMcpServer(version: string, options: McpServerOptions = {}): McpServer {
  const server = new McpServer({ name: "machines", version });
  const events = new EventsClient();
  const trustedNotificationApproval = createTrustedNotificationApproval();
  const mutationTransport = options.mutationTransport ?? "mcp:stdio";

  function requireMcpMutation(
    operation: string,
    approvalToken: string | undefined,
    scope: { machineId?: string | null; resourceId?: string | null; args?: unknown } = {},
  ): void {
    assertScopedMcpMutation(operation, approvalToken, scope, mutationTransport);
  }

  server.tool(
    "machines_status",
    "Return local machine fleet status paths and machine identity.",
    { private_metadata: z.boolean().optional().describe("Include private local paths and machine identifiers") },
    async ({ private_metadata }) => {
      const privateMetadata = privateMetadataAllowed(private_metadata);
      const warnings = privateOutputWarnings(private_metadata, privateMetadata);
      return { content: [{ type: "text", text: JSON.stringify(appendWarnings(getStatus({ privateMetadata }), warnings), null, 2) }] };
    }
  );

  server.tool(
    "machines_doctor",
    "Run machine preflight checks.",
    { machine_id: z.string().optional().describe("Machine identifier") },
    async ({ machine_id }) => ({ content: [{ type: "text", text: JSON.stringify(runDoctor(machine_id), null, 2) }] })
  );

  server.tool("machines_self_test", "Run local package smoke checks.", {}, async () => ({
    content: [{ type: "text", text: JSON.stringify(runSelfTest(), null, 2) }],
  }));

  server.tool(
    "machines_apps_list",
    "List manifest-managed apps for a machine.",
    { machine_id: z.string().optional().describe("Machine identifier") },
    async ({ machine_id }) => ({ content: [{ type: "text", text: JSON.stringify(listApps(machine_id), null, 2) }] })
  );

  server.tool(
    "machines_apps_status",
    "Check installed state for manifest-managed apps.",
    { machine_id: z.string().optional().describe("Machine identifier") },
    async ({ machine_id }) => ({ content: [{ type: "text", text: JSON.stringify(getAppsStatus(machine_id), null, 2) }] })
  );

  server.tool(
    "machines_apps_diff",
    "Show missing and installed manifest-managed apps.",
    { machine_id: z.string().optional().describe("Machine identifier") },
    async ({ machine_id }) => ({ content: [{ type: "text", text: JSON.stringify(diffApps(machine_id), null, 2) }] })
  );

  server.tool(
    "machines_apps_plan",
    "Preview app install steps for a machine.",
    { machine_id: z.string().optional().describe("Machine identifier") },
    async ({ machine_id }) => ({ content: [{ type: "text", text: JSON.stringify(buildAppsPlan(machine_id), null, 2) }] })
  );

  server.tool(
    "machines_apps_apply",
    "Install manifest-managed apps for a machine.",
    {
      machine_id: z.string().optional().describe("Machine identifier"),
      yes: z.boolean().describe("Confirmation flag for execution"),
      expected_plan_digest: z.string().regex(/^[a-f0-9]{64}$/).optional().describe("Required exact candidate plan digest"),
      approval_token: approvalTokenSchema,
    },
    async ({ machine_id, yes, expected_plan_digest, approval_token }) => {
      const resolvedMachineId = mutationMachineId(machine_id);
      const plan = buildAppsPlan(machine_id);
      requireMcpMutation("machines_apps_apply", approval_token, {
        machineId: resolvedMachineId,
        resourceId: mcpPlanResourceId("machines_apps_apply", resolvedMachineId, plan),
        args: mcpPlanApprovalArgs({ machine_id: resolvedMachineId, yes }, plan),
      });
      return { content: [{ type: "text", text: JSON.stringify(runAppsPlan(plan, { apply: true, yes, expectedPlanDigest: expected_plan_digest }), null, 2) }] };
    }
  );

  server.tool("machines_manifest", "Read the current fleet manifest.", {}, async () => ({
    content: [{ type: "text", text: JSON.stringify(manifestList(), null, 2) }],
  }));
  server.tool("machines_manifest_validate", "Validate the current fleet manifest.", {}, async () => ({
    content: [{ type: "text", text: JSON.stringify(manifestValidate(), null, 2) }],
  }));
  server.tool(
    "machines_manifest_bootstrap",
    "Detect and upsert the current machine into the fleet manifest.",
    { approval_token: approvalTokenSchema },
    async ({ approval_token }) => {
      requireMcpMutation("machines_manifest_bootstrap", approval_token, { resourceId: "manifest:bootstrap", args: {} });
      return { content: [{ type: "text", text: JSON.stringify(manifestBootstrapCurrentMachine(), null, 2) }] };
    }
  );
  server.tool(
    "machines_manifest_get",
    "Read a single machine from the fleet manifest.",
    { machine_id: z.string().describe("Machine identifier") },
    async ({ machine_id }) => ({ content: [{ type: "text", text: JSON.stringify(manifestGet(machine_id), null, 2) }] })
  );
  server.tool(
    "machines_friendly_name_get",
    "Read a machine friendly name and computed display name without changing the stable machine id.",
    { machine_id: z.string().describe("Machine identifier") },
    async ({ machine_id }) => ({ content: [{ type: "text", text: JSON.stringify(manifestGetFriendlyName(machine_id), null, 2) }] })
  );
  server.tool(
    "machines_friendly_name_set",
    "Set a user-friendly display name for a machine without changing the stable machine id.",
    {
      machine_id: z.string().describe("Machine identifier"),
      friendly_name: z.string().describe("User-friendly display name"),
      approval_token: approvalTokenSchema,
    },
    async ({ machine_id, friendly_name, approval_token }) => {
      const input = { machineId: machine_id, friendlyName: friendly_name };
      requireMcpMutation("machines_friendly_name_set", approval_token, {
        machineId: input.machineId,
        resourceId: machineFriendlyNameResourceId(input.machineId),
        args: setMachineFriendlyNameMutationArgs(input),
      });
      return { content: [{ type: "text", text: JSON.stringify(manifestSetFriendlyName(input), null, 2) }] };
    }
  );
  server.tool(
    "machines_friendly_name_clear",
    "Clear a machine friendly name so consumers fall back to the stable machine id.",
    {
      machine_id: z.string().describe("Machine identifier"),
      approval_token: approvalTokenSchema,
    },
    async ({ machine_id, approval_token }) => {
      const input = { machineId: machine_id };
      requireMcpMutation("machines_friendly_name_clear", approval_token, {
        machineId: input.machineId,
        resourceId: machineFriendlyNameResourceId(input.machineId),
        args: clearMachineFriendlyNameMutationArgs(input),
      });
      return { content: [{ type: "text", text: JSON.stringify(manifestClearFriendlyName(input), null, 2) }] };
    }
  );
  server.tool(
    "machines_details",
    "Return consumer-safe machine details for right-click View details.",
    {
      machine_id: z.string().optional().describe("Machine identifier; defaults to local"),
      include_tailscale: z.boolean().optional().describe("Whether to probe tailscale while resolving details"),
    },
    async ({ machine_id, include_tailscale }) => ({
      content: [{
        type: "text",
        text: JSON.stringify(await resolveMachineDetails(machine_id ?? "local", {
          includeTailscale: include_tailscale,
        }), null, 2),
      }],
    })
  );
  server.tool(
    "machines_browserplan_fleet",
    "Return BrowserPlan target machine001-machine011 fleet metadata and safe remote operation hooks.",
    {
      machine_ids: z.array(z.string()).optional().describe("Optional BrowserPlan machine ids; spark01/spark02 are excluded"),
      include_tailscale: z.boolean().optional().describe("Whether to probe tailscale while resolving reachability"),
      check_installs: z.boolean().optional().describe("Run remote compatibility probes for browserplan/chrome/bun/git state"),
    },
    async ({ machine_ids, include_tailscale, check_installs }) => ({
      content: [{
        type: "text",
        text: JSON.stringify(getBrowserPlanFleet({
          machineIds: machine_ids,
          includeTailscale: include_tailscale,
          includeInstallState: check_installs,
        }), null, 2),
      }],
    })
  );
  server.tool(
    "machines_notes_context",
    "Resolve note origin/source/target machine display names, sync targets, and actor provenance for Hasna Notes consumers.",
    {
      origin_machine_id: z.string().optional().describe("Machine that owns/originated the note"),
      source_machine_id: z.string().optional().describe("Machine where the note event or sync source came from"),
      target_machine_id: z.string().optional().describe("Machine the note is being synced to"),
      sync_target_machine_ids: z.array(z.string()).optional().describe("Additional sync target machine ids"),
      actor_type: z.enum(["human", "agent", "system", "unknown"]).optional().describe("Actor kind"),
      actor_id: z.string().optional().describe("Actor identifier"),
      actor_name: z.string().optional().describe("Actor display name"),
      agent_id: z.string().optional().describe("Agent identifier for agent-created notes"),
      agent_name: z.string().optional().describe("Agent display name for agent-created notes"),
      source: z.enum(["notes", "agent", "sync", "import", "machines", "unknown", "notes", "machines"]).optional().describe("Provenance source (legacy open-* values accepted on read)"),
      include_tailscale: z.boolean().optional().describe("Whether to probe tailscale while building context"),
    },
    async ({
      origin_machine_id,
      source_machine_id,
      target_machine_id,
      sync_target_machine_ids,
      actor_type,
      actor_id,
      actor_name,
      agent_id,
      agent_name,
      source,
      include_tailscale,
    }) => ({
      content: [{
        type: "text",
        text: JSON.stringify(resolveNoteMachineContext({
          originMachineId: origin_machine_id,
          sourceMachineId: source_machine_id,
          targetMachineId: target_machine_id,
          syncTargetMachineIds: sync_target_machine_ids,
          includeTailscale: include_tailscale,
          actor: {
            actor_type,
            actor_id,
            actor_name,
            agent_id,
            agent_name,
            source,
          },
        }), null, 2),
      }],
    })
  );
  server.tool(
    "machines_notes_trash_policies",
    "List per-machine note trash retention metadata with latest-10/View-more pagination.",
    {
      machine_id: z.string().optional().describe("Filter by machine identifier"),
      limit: z.number().int().min(1).nullable().optional().describe("Maximum machines to return; default is 10, null returns all"),
      offset: z.number().int().min(0).optional().describe("Machine list offset for View more pagination"),
      include_tailscale: z.boolean().optional().describe("Whether to probe tailscale while listing policies"),
    },
    async ({ machine_id, limit, offset, include_tailscale }) => ({
      content: [{
        type: "text",
        text: JSON.stringify(listMachineTrashPolicies({
          machineId: machine_id,
          limit,
          offset,
          includeTailscale: include_tailscale,
        }), null, 2),
      }],
    })
  );
  server.tool(
    "machines_manifest_remove",
    "Remove a single machine from the fleet manifest.",
    { machine_id: z.string().describe("Machine identifier"), approval_token: approvalTokenSchema },
    async ({ machine_id, approval_token }) => {
      requireMcpMutation("machines_manifest_remove", approval_token, { machineId: machine_id, args: { machine_id } });
      return { content: [{ type: "text", text: JSON.stringify(manifestRemove(machine_id), null, 2) }] };
    }
  );

  server.tool(
    "machines_agent_status",
    "List current machine agent heartbeats.",
    { private_metadata: z.boolean().optional().describe("Include private heartbeat metadata") },
    async ({ private_metadata }) => {
      const privateMetadata = privateMetadataAllowed(private_metadata);
      const warnings = privateOutputWarnings(private_metadata, privateMetadata);
      const agents = getAgentStatus(undefined, { privateMetadata });
      return {
        content: [{ type: "text", text: JSON.stringify(warnings.length > 0 ? { agents, warnings } : agents, null, 2) }],
      };
    }
  );

  server.tool(
    "machines_daemon_status",
    "List fleet daemon heartbeat status rows.",
    { private_metadata: z.boolean().optional().describe("Include private heartbeat metadata") },
    async ({ private_metadata }) => {
      const privateMetadata = privateMetadataAllowed(private_metadata);
      const warnings = privateOutputWarnings(private_metadata, privateMetadata);
      return {
        content: [{
          type: "text",
          text: JSON.stringify({
            generated_at: new Date().toISOString(),
            agents: getAgentStatus(undefined, { privateMetadata }),
            ...(warnings.length > 0 ? { warnings } : {}),
          }, null, 2),
        }],
      };
    }
  );

  server.tool(
    "machines_daemon_service_plan",
    "Plan launchd/systemd lifecycle commands for the machines-daemon daemon.",
    {
      action: z.enum(["install", "uninstall", "restart", "status", "logs"]).describe("Daemon lifecycle action"),
      platform: z.enum(["macos", "linux"]).optional().describe("Target service platform"),
      mode: z.enum(["user", "system"]).optional().describe("Service mode"),
      service_name: z.string().optional().describe("Service name/label"),
      executable: z.string().optional().describe("machines-daemon executable path"),
      interval_ms: z.number().optional().describe("Heartbeat interval in milliseconds"),
      storage_push: z.boolean().optional().describe("Configure heartbeat storage push"),
      doctor_summary: z.boolean().optional().describe("Configure lightweight doctor summaries in heartbeat metadata"),
      private_metadata: z.boolean().optional().describe("Opt in to private heartbeat metadata"),
      env: z.array(z.string()).optional().describe("Environment variable names to include as placeholders"),
    },
    async ({ action, platform, mode, service_name, executable, interval_ms, storage_push, doctor_summary, private_metadata, env }) => ({
      content: [{
        type: "text",
        text: JSON.stringify(buildDaemonServicePlan({
          action,
          platform,
          mode,
          serviceName: service_name,
          executable,
          intervalMs: interval_ms,
          storagePush: storage_push,
          doctorSummary: doctor_summary,
          privateMetadata: private_metadata,
          env,
        }), null, 2),
      }],
    })
  );

  server.tool(
    "machines_setup_preview",
    "Preview setup actions for a machine.",
    { machine_id: z.string().optional().describe("Machine identifier") },
    async ({ machine_id }) => ({ content: [{ type: "text", text: JSON.stringify(buildSetupPlan(machine_id), null, 2) }] })
  );

  server.tool(
    "machines_setup_apply",
    "Execute setup actions for a machine.",
    { machine_id: z.string().optional().describe("Machine identifier"), yes: z.boolean().describe("Confirmation flag for execution"), approval_token: approvalTokenSchema },
    async ({ machine_id, yes, approval_token }) => {
      const resolvedMachineId = mutationMachineId(machine_id);
      const plan = buildSetupPlan(machine_id);
      requireMcpMutation("machines_setup_apply", approval_token, {
        machineId: resolvedMachineId,
        resourceId: mcpPlanResourceId("machines_setup_apply", resolvedMachineId, plan),
        args: mcpPlanApprovalArgs({ machine_id: resolvedMachineId, yes }, plan),
      });
      return { content: [{ type: "text", text: JSON.stringify(runSetupPlan(plan, { apply: true, yes }), null, 2) }] };
    }
  );

  server.tool(
    "machines_sync_preview",
    "Preview sync actions for a machine.",
    { machine_id: z.string().optional().describe("Machine identifier") },
    async ({ machine_id }) => ({ content: [{ type: "text", text: JSON.stringify(buildSyncPlan(machine_id), null, 2) }] })
  );

  server.tool(
    "machines_sync_apply",
    "Execute sync actions for a machine.",
    { machine_id: z.string().optional().describe("Machine identifier"), yes: z.boolean().describe("Confirmation flag for execution"), approval_token: approvalTokenSchema },
    async ({ machine_id, yes, approval_token }) => {
      const resolvedMachineId = mutationMachineId(machine_id);
      const plan = buildSyncPlan(machine_id);
      requireMcpMutation("machines_sync_apply", approval_token, {
        machineId: resolvedMachineId,
        resourceId: mcpPlanResourceId("machines_sync_apply", resolvedMachineId, plan),
        args: mcpPlanApprovalArgs({ machine_id: resolvedMachineId, yes }, plan),
      });
      return { content: [{ type: "text", text: JSON.stringify(runSyncPlan(plan, { apply: true, yes }), null, 2) }] };
    }
  );

  server.tool(
    "machines_topology",
    "Discover local, manifest, heartbeat, SSH, and Tailscale machine topology.",
    {
      include_tailscale: z.boolean().optional().describe("Whether to probe tailscale status --json"),
      limit: z.number().int().min(1).nullable().optional().describe("Maximum machines to return; default is 10, null returns all"),
      offset: z.number().int().min(0).optional().describe("Machine list offset for View more pagination"),
      private_metadata: z.boolean().optional().describe("Include private host/network route fields"),
    },
    async ({ include_tailscale, limit, offset, private_metadata }) => {
      const privateMetadata = privateMetadataAllowed(private_metadata);
      const warnings = privateOutputWarnings(private_metadata, privateMetadata);
      const topology = redactTopologyForOutput(discoverMachineTopology({
        includeTailscale: include_tailscale !== false,
        limit,
        offset,
      }), { privateMetadata });
      return { content: [{ type: "text", text: JSON.stringify(appendWarnings(topology, warnings), null, 2) }] };
    }
  );

  const compatibilityCommandSchema = z.object({
    command: z.string(),
    expectedVersion: z.string().optional(),
    versionArgs: z.string().optional(),
    required: z.boolean().optional(),
  });
  const compatibilityPackageSchema = z.object({
    name: z.string(),
    command: z.string().optional(),
    expectedVersion: z.string().optional(),
    required: z.boolean().optional(),
  });
  const compatibilityWorkspaceSchema = z.object({
    path: z.string(),
    label: z.string().optional(),
    expectedPackageName: z.string().optional(),
    expectedVersion: z.string().optional(),
    required: z.boolean().optional(),
  });
  const agentSelectorSchema = {
    machine_ids: z.array(z.string()).optional().describe("Optional machine ids; output remains bounded by limit/offset"),
    include_tailscale: z.boolean().optional().describe("Whether to probe tailscale status --json"),
    limit: z.number().int().min(1).nullable().optional().describe("Maximum machines to return; default is 10, null returns all"),
    offset: z.number().int().min(0).optional().describe("Machine list offset for pagination"),
  };
  const workspaceReadinessSchema = {
    project_id: z.string().optional().describe("Project/workspace id for workspace readiness"),
    repo_name: z.string().optional().describe("Repository name; defaults to project id"),
    open_files_repo_name: z.string().optional().describe("Open-files repository name"),
    primary_machine_id: z.string().optional().describe("Primary machine id for this project"),
  };
  const compatibilityReadinessSchema = {
    check_compatibility: z.boolean().optional().describe("Run bounded compatibility checks"),
    commands: z.array(compatibilityCommandSchema).optional().describe("Commands to check"),
    packages: z.array(compatibilityPackageSchema).optional().describe("Package-backed CLI checks"),
    workspaces: z.array(compatibilityWorkspaceSchema).optional().describe("Workspace paths and package metadata to check"),
  };

  server.tool(
    "machines_machine_health",
    "Return compact local/remote loop-readiness health for machines.",
    {
      ...agentSelectorSchema,
      ...workspaceReadinessSchema,
      ...compatibilityReadinessSchema,
      private_metadata: z.boolean().optional().describe("Include private route artifact refs where allowed"),
    },
    async ({
      machine_ids,
      include_tailscale,
      limit,
      offset,
      project_id,
      repo_name,
      open_files_repo_name,
      primary_machine_id,
      check_compatibility,
      commands,
      packages,
      workspaces,
      private_metadata,
    }) => {
      const privateMetadata = privateMetadataAllowed(private_metadata);
      const warnings = privateOutputWarnings(private_metadata, privateMetadata);
      const result = getFleetMachineHealth({
        machineIds: machine_ids,
        includeTailscale: include_tailscale !== false,
        limit,
        offset,
        projectId: project_id,
        repoName: repo_name,
        openFilesRepoName: open_files_repo_name,
        primaryMachineId: primary_machine_id,
        checkCompatibility: check_compatibility === true || Boolean(commands?.length || packages?.length || workspaces?.length),
        commands,
        packages,
        workspaces,
        privateMetadata,
      });
      return { content: [{ type: "text", text: JSON.stringify(appendWarnings(result, warnings)) }] };
    }
  );

  server.tool(
    "machines_routing",
    "Return compact route readiness for local and remote machines.",
    {
      ...agentSelectorSchema,
      private_metadata: z.boolean().optional().describe("Include private route targets where allowed"),
    },
    async ({ machine_ids, include_tailscale, limit, offset, private_metadata }) => {
      const privateMetadata = privateMetadataAllowed(private_metadata);
      const warnings = privateOutputWarnings(private_metadata, privateMetadata);
      const result = getFleetRouting({
        machineIds: machine_ids,
        includeTailscale: include_tailscale !== false,
        limit,
        offset,
        privateMetadata,
      });
      return { content: [{ type: "text", text: JSON.stringify(appendWarnings(result, warnings)) }] };
    }
  );

  server.tool(
    "machines_command_matrix",
    "Return command plans gated by a bounded read-only execution-authentication probe.",
    {
      ...agentSelectorSchema,
      command: z.string().optional().describe("Loop command to plan; omitted keeps <loop-command> placeholder"),
      command_label: z.string().optional().describe("Short label for the planned command"),
      private_metadata: z.boolean().optional().describe("Include private resolved shell commands where allowed"),
    },
    async ({ machine_ids, include_tailscale, limit, offset, command, command_label, private_metadata }) => {
      const privateMetadata = privateMetadataAllowed(private_metadata);
      const warnings = privateOutputWarnings(private_metadata, privateMetadata);
      const result = getCommandMatrix({
        machineIds: machine_ids,
        includeTailscale: include_tailscale !== false,
        limit,
        offset,
        command,
        commandLabel: command_label,
        privateMetadata,
      });
      return { content: [{ type: "text", text: JSON.stringify(appendWarnings(result, warnings)) }] };
    }
  );

  server.tool(
    "machines_loop_preflight",
    "Return compact fleet loop readiness, route choices, and next steps.",
    {
      ...agentSelectorSchema,
      ...workspaceReadinessSchema,
      ...compatibilityReadinessSchema,
      command: z.string().optional().describe("Loop command to plan; omitted keeps <loop-command> placeholder"),
      command_label: z.string().optional().describe("Short label for the planned command"),
      private_metadata: z.boolean().optional().describe("Include private resolved shell commands where allowed"),
    },
    async ({
      machine_ids,
      include_tailscale,
      limit,
      offset,
      project_id,
      repo_name,
      open_files_repo_name,
      primary_machine_id,
      check_compatibility,
      commands,
      packages,
      workspaces,
      command,
      command_label,
      private_metadata,
    }) => {
      const privateMetadata = privateMetadataAllowed(private_metadata);
      const warnings = privateOutputWarnings(private_metadata, privateMetadata);
      const result = getFleetLoopPreflight({
        machineIds: machine_ids,
        includeTailscale: include_tailscale !== false,
        limit,
        offset,
        projectId: project_id,
        repoName: repo_name,
        openFilesRepoName: open_files_repo_name,
        primaryMachineId: primary_machine_id,
        checkCompatibility: check_compatibility === true || Boolean(commands?.length || packages?.length || workspaces?.length),
        commands,
        packages,
        workspaces,
        command,
        commandLabel: command_label,
        privateMetadata,
      });
      return { content: [{ type: "text", text: JSON.stringify(appendWarnings(result, warnings)) }] };
    }
  );

  server.tool(
    "machines_dispatch_fleet_smoke",
    "Run a bounded dry-run @hasna/dispatch fleet package, route, and daemon-readiness smoke.",
    {
      ...agentSelectorSchema,
      ssh_machine_ids: z.array(z.string()).optional().describe("Machine ids to probe through a direct SSH alias"),
      include_apple01: z.boolean().optional().describe("Include optional apple01 instead of ignoring it by default"),
      package_name: z.string().optional().describe("Package name to report"),
      command: z.string().optional().describe("Package CLI command to probe"),
      expected_version: z.string().optional().describe("Expected package version"),
      timeout_ms: z.number().int().min(1).optional().describe("Per-machine command timeout"),
      max_output_chars: z.number().int().min(1).optional().describe("Maximum redacted stdout/stderr chars per command"),
      private_metadata: z.boolean().optional().describe("Include private route targets where allowed"),
    },
    async ({
      machine_ids,
      include_tailscale,
      ssh_machine_ids,
      include_apple01,
      package_name,
      command,
      expected_version,
      timeout_ms,
      max_output_chars,
      private_metadata,
    }) => {
      const privateMetadata = privateMetadataAllowed(private_metadata);
      const warnings = privateOutputWarnings(private_metadata, privateMetadata);
      const result = getDispatchFleetSmoke({
        machineIds: machine_ids,
        sshMachineIds: ssh_machine_ids,
        includeApple01: include_apple01,
        packageName: package_name,
        command,
        expectedVersion: expected_version,
        includeTailscale: include_tailscale !== false,
        timeoutMs: timeout_ms,
        maxOutputChars: max_output_chars,
        privateMetadata,
      });
      return { content: [{ type: "text", text: JSON.stringify(appendWarnings(result, warnings)) }] };
    }
  );

  server.tool(
    "machines_compatibility",
    "Check remote package, command, and workspace compatibility for open-* consumers.",
    {
      machine_id: z.string().optional().describe("Machine identifier"),
      commands: z.array(z.object({
        command: z.string(),
        expectedVersion: z.string().optional(),
        versionArgs: z.string().optional(),
        required: z.boolean().optional(),
      })).optional().describe("Commands to check"),
      packages: z.array(z.object({
        name: z.string(),
        command: z.string().optional(),
        expectedVersion: z.string().optional(),
        required: z.boolean().optional(),
      })).optional().describe("Package-backed CLI checks"),
      workspaces: z.array(z.object({
        path: z.string(),
        label: z.string().optional(),
        expectedPackageName: z.string().optional(),
        expectedVersion: z.string().optional(),
        required: z.boolean().optional(),
      })).optional().describe("Workspace paths and package metadata to check"),
    },
    async ({ machine_id, commands, packages, workspaces }) => ({
      content: [{ type: "text", text: JSON.stringify(checkMachineCompatibility({ machineId: machine_id, commands, packages, workspaces }), null, 2) }],
    })
  );

  server.tool(
    "machines_diff",
    "Show manifest differences between two machines.",
    {
      left_machine_id: z.string().describe("Left machine identifier"),
      right_machine_id: z.string().optional().describe("Right machine identifier"),
    },
    async ({ left_machine_id, right_machine_id }) => ({
      content: [{ type: "text", text: JSON.stringify(diffMachines(left_machine_id, right_machine_id), null, 2) }],
    })
  );

  server.tool(
    "machines_install_claude_status",
    "Check installed state for Claude, Codex, and Gemini CLIs.",
    {
      machine_id: z.string().optional().describe("Machine identifier"),
      tools: z.array(z.enum(["claude", "codex", "gemini"])).optional().describe("AI CLIs to inspect"),
    },
    async ({ machine_id, tools }) => ({ content: [{ type: "text", text: JSON.stringify(getClaudeCliStatus(machine_id, tools), null, 2) }] })
  );

  server.tool(
    "machines_install_claude_diff",
    "Show missing and installed Claude, Codex, and Gemini CLIs.",
    {
      machine_id: z.string().optional().describe("Machine identifier"),
      tools: z.array(z.enum(["claude", "codex", "gemini"])).optional().describe("AI CLIs to inspect"),
    },
    async ({ machine_id, tools }) => ({ content: [{ type: "text", text: JSON.stringify(diffClaudeCli(machine_id, tools), null, 2) }] })
  );

  server.tool(
    "machines_install_claude_preview",
    "Preview Claude, Codex, and Gemini CLI install steps for a machine.",
    {
      machine_id: z.string().optional().describe("Machine identifier"),
      tools: z.array(z.enum(["claude", "codex", "gemini"])).optional().describe("AI CLIs to install"),
    },
    async ({ machine_id, tools }) => ({ content: [{ type: "text", text: JSON.stringify(buildClaudeInstallPlan(machine_id, tools), null, 2) }] })
  );

  server.tool(
    "machines_install_claude_apply",
    "Execute Claude, Codex, and Gemini CLI install steps for a machine.",
    {
      machine_id: z.string().optional().describe("Machine identifier"),
      tools: z.array(z.enum(["claude", "codex", "gemini"])).optional().describe("AI CLIs to install"),
      yes: z.boolean().describe("Confirmation flag for execution"),
      approval_token: approvalTokenSchema,
    },
    async ({ machine_id, tools, yes, approval_token }) => {
      const resolvedMachineId = mutationMachineId(machine_id);
      const plan = buildClaudeInstallPlan(machine_id, tools);
      requireMcpMutation("machines_install_claude_apply", approval_token, {
        machineId: resolvedMachineId,
        resourceId: mcpPlanResourceId("machines_install_claude_apply", resolvedMachineId, plan),
        args: mcpPlanApprovalArgs({ machine_id: resolvedMachineId, tools, yes }, plan),
      });
      return {
        content: [{ type: "text", text: JSON.stringify(runClaudeInstallPlan(plan, { apply: true, yes }), null, 2) }],
      };
    }
  );

  server.tool(
    "machines_install_tailscale_preview",
    "Preview Tailscale install steps for a machine.",
    { machine_id: z.string().optional().describe("Machine identifier") },
    async ({ machine_id }) => ({ content: [{ type: "text", text: JSON.stringify(buildTailscaleInstallPlan(machine_id), null, 2) }] })
  );

  server.tool(
    "machines_install_tailscale_apply",
    "Execute Tailscale install steps for a machine.",
    { machine_id: z.string().optional().describe("Machine identifier"), yes: z.boolean().describe("Confirmation flag for execution"), approval_token: approvalTokenSchema },
    async ({ machine_id, yes, approval_token }) => {
      const resolvedMachineId = mutationMachineId(machine_id);
      const plan = buildTailscaleInstallPlan(machine_id);
      requireMcpMutation("machines_install_tailscale_apply", approval_token, {
        machineId: resolvedMachineId,
        resourceId: mcpPlanResourceId("machines_install_tailscale_apply", resolvedMachineId, plan),
        args: mcpPlanApprovalArgs({ machine_id: resolvedMachineId, yes }, plan),
      });
      return { content: [{ type: "text", text: JSON.stringify(runTailscaleInstallPlan(plan, { apply: true, yes }), null, 2) }] };
    }
  );

  server.tool(
    "machines_route_resolve",
    "Resolve the best route for a machine using manifest, heartbeat, SSH, LAN, and Tailscale topology.",
    {
      machine_id: z.string().describe("Machine identifier"),
      include_tailscale: z.boolean().optional().describe("Whether to probe tailscale status --json"),
      private_metadata: z.boolean().optional().describe("Include private route targets"),
    },
    async ({ machine_id, include_tailscale, private_metadata }) => {
      const privateMetadata = privateMetadataAllowed(private_metadata);
      const warnings = privateOutputWarnings(private_metadata, privateMetadata);
      const route = redactRouteForOutput(resolveMachineRoute(machine_id, { includeTailscale: include_tailscale !== false }), { privateMetadata });
      return { content: [{ type: "text", text: JSON.stringify(appendWarnings(route, warnings), null, 2) }] };
    }
  );

  server.tool(
    "machines_workspace_resolve",
    "Resolve sync-safe repo and open-files roots for an open-* consumer.",
    {
      machine_id: z.string().describe("Machine identifier"),
      project_id: z.string().describe("Canonical project id"),
      repo_name: z.string().optional().describe("Repository name; defaults to project id"),
      open_files_repo_name: z.string().optional().describe("Open-files repository name"),
      primary_machine_id: z.string().optional().describe("Primary machine id for this project"),
      workspace_root: z.string().optional().describe("Override the machine workspace root"),
      project_root: z.string().optional().describe("Override the resolved project root"),
      open_files_root: z.string().optional().describe("Override the resolved open-files root"),
      include_tailscale: z.boolean().optional().describe("Whether to probe tailscale status --json"),
    },
    async ({
      machine_id,
      project_id,
      repo_name,
      open_files_repo_name,
      primary_machine_id,
      workspace_root,
      project_root,
      open_files_root,
      include_tailscale,
    }) => ({
      content: [{
        type: "text",
        text: JSON.stringify(resolveMachineWorkspace({
          machineId: machine_id,
          projectId: project_id,
          repoName: repo_name,
          openFilesRepoName: open_files_repo_name,
          primaryMachineId: primary_machine_id,
          workspaceRoot: workspace_root,
          projectRoot: project_root,
          openFilesRoot: open_files_root,
          includeTailscale: include_tailscale !== false,
        }), null, 2),
      }],
    })
  );

  server.tool(
    "machines_ssh_resolve",
    "Resolve the best SSH route for a machine.",
    {
      machine_id: z.string().describe("Machine identifier"),
      remote_command: z.string().optional().describe("Optional remote command"),
      private_metadata: z.boolean().optional().describe("Include private SSH target and command"),
    },
    async ({ machine_id, remote_command, private_metadata }) => {
      const privateMetadata = privateMetadataAllowed(private_metadata);
      const warnings = privateOutputWarnings(private_metadata, privateMetadata);
      const resolved = resolveMachineRoute(machine_id);
      const publicResolved = redactRouteForOutput(resolved, { privateMetadata });
      const command = resolved.ok && privateMetadata ? buildSshCommand(machine_id, remote_command) : resolved.ok ? "[redacted]" : null;
      return {
        content: [{
          type: "text",
          text: JSON.stringify(appendWarnings({ resolved: publicResolved, command }, warnings), null, 2),
        }],
      };
    }
  );

  server.tool("machines_ports", "List listening ports on a machine.", { machine_id: z.string().optional().describe("Machine identifier") }, async ({ machine_id }) => ({
    content: [{ type: "text", text: JSON.stringify(listPorts(machine_id), null, 2) }],
  }));

  server.tool(
    "machines_backup_preview",
    "Preview backup steps for the current machine.",
    { bucket: z.string().optional().describe("S3 bucket name; defaults to HASNA_MACHINES_S3_BUCKET or MACHINES_S3_BUCKET"), prefix: z.string().optional().describe("S3 key prefix; defaults to HASNA_MACHINES_S3_PREFIX, MACHINES_S3_PREFIX, or machines") },
    async ({ bucket, prefix }) => ({ content: [{ type: "text", text: JSON.stringify(buildBackupPlan(bucket, prefix), null, 2) }] })
  );

  server.tool(
    "machines_backup_apply",
    "Execute backup steps for the current machine.",
    { bucket: z.string().optional().describe("S3 bucket name; defaults to HASNA_MACHINES_S3_BUCKET or MACHINES_S3_BUCKET"), prefix: z.string().optional().describe("S3 key prefix; defaults to HASNA_MACHINES_S3_PREFIX, MACHINES_S3_PREFIX, or machines"), yes: z.boolean().describe("Confirmation flag for execution"), approval_token: approvalTokenSchema },
    async ({ bucket, prefix, yes, approval_token }) => {
      requireMcpMutation("machines_backup_apply", approval_token, { resourceId: mutationResourceId("backup", bucket, prefix), args: { bucket, prefix, yes } });
      return { content: [{ type: "text", text: JSON.stringify(runBackup(bucket, prefix, { apply: true, yes }), null, 2) }] };
    }
  );

  server.tool(
    "machines_cert_preview",
    "Preview mkcert steps for one or more domains.",
    { domains: z.array(z.string()).describe("Domains to issue certificates for") },
    async ({ domains }) => ({ content: [{ type: "text", text: JSON.stringify(buildCertPlan(domains), null, 2) }] })
  );

  server.tool(
    "machines_cert_apply",
    "Execute mkcert steps for one or more domains.",
    { domains: z.array(z.string()).describe("Domains to issue certificates for"), yes: z.boolean().describe("Confirmation flag for execution"), approval_token: approvalTokenSchema },
    async ({ domains, yes, approval_token }) => {
      requireMcpMutation("machines_cert_apply", approval_token, { resourceId: mutationResourceId("cert", domains.join(",")), args: { domains, yes } });
      return { content: [{ type: "text", text: JSON.stringify(runCertPlan(domains, { apply: true, yes }), null, 2) }] };
    }
  );

  server.tool(
    "machines_dns_add",
    "Add or replace a local domain mapping.",
    { domain: z.string().describe("Domain name"), port: z.number().describe("Target port"), target_host: z.string().optional().describe("Target host"), approval_token: approvalTokenSchema },
    async ({ domain, port, target_host, approval_token }) => {
      const resolvedTargetHost = target_host ?? "127.0.0.1";
      requireMcpMutation("machines_dns_add", approval_token, { resourceId: mutationResourceId("dns", domain), args: { domain, port, target_host: resolvedTargetHost } });
      return { content: [{ type: "text", text: JSON.stringify(addDomainMapping(domain, port, resolvedTargetHost), null, 2) }] };
    }
  );
  server.tool("machines_dns_list", "List local domain mappings.", {}, async () => ({ content: [{ type: "text", text: JSON.stringify(listDomainMappings(), null, 2) }] }));
  server.tool(
    "machines_dns_render",
    "Render hosts/proxy configuration for a domain.",
    { domain: z.string().describe("Domain name") },
    async ({ domain }) => ({ content: [{ type: "text", text: JSON.stringify(renderDomainMapping(domain), null, 2) }] })
  );

  server.tool(
    "machines_notifications_add",
    "Add or replace a notification channel.",
    {
      channel_id: z.string().describe("Channel identifier"),
      type: z.enum(["email", "webhook", "command"]).describe("Notification transport"),
      target: z.string().describe("Email, webhook URL, or command executable"),
      command_args: z.array(z.string()).optional().describe("Arguments for command transports"),
      events: z.array(z.string()).describe("Events routed to this channel"),
      enabled: z.boolean().optional().describe("Whether the channel is enabled"),
      approval_token: approvalTokenSchema,
    },
    async ({ channel_id, type, target, command_args, events, enabled, approval_token }) => {
      const resolvedEnabled = enabled ?? true;
      const resolvedEvents = [...new Set(events)];
      const commandArgs = command_args ?? [];
      requireMcpMutation("machines_notifications_add", approval_token, { resourceId: mutationResourceId("notification", channel_id), args: { channel_id, type, target, command_args: commandArgs, events: resolvedEvents, enabled: resolvedEnabled } });
      return {
        content: [{ type: "text", text: JSON.stringify(addNotificationChannel({ id: channel_id, type, target, commandArgs: type === "command" && commandArgs.length > 0 ? commandArgs : undefined, events: resolvedEvents, enabled: resolvedEnabled }, { trustedApproval: trustedNotificationApproval }), null, 2) }],
      };
    }
  );

  server.tool("machines_notifications_list", "List notification channels.", {}, async () => ({
    content: [{ type: "text", text: JSON.stringify(listNotificationChannels(), null, 2) }],
  }));

  server.tool(
    "machines_notifications_test",
    "Preview or execute a notification test.",
    { channel_id: z.string().describe("Channel identifier"), event: z.string().optional().describe("Event name"), message: z.string().optional().describe("Message body"), yes: z.boolean().optional().describe("Execute the test when true"), approval_token: approvalTokenSchema },
    async ({ channel_id, event, message, yes, approval_token }) => {
      if (yes === true) requireMcpMutation("machines_notifications_test", approval_token, { resourceId: mutationResourceId("notification-test", channel_id, event), args: { channel_id, event, message, yes: true } });
      return {
        content: [{ type: "text", text: JSON.stringify(await testNotificationChannel(channel_id, event, message, { apply: Boolean(yes), yes, trustedApproval: yes === true ? trustedNotificationApproval : undefined }), null, 2) }],
      };
    }
  );

  server.tool(
    "machines_notifications_dispatch",
    "Dispatch an event to matching notification channels.",
    { event: z.string().describe("Event name"), message: z.string().describe("Message body"), channel_id: z.string().optional().describe("Limit delivery to one channel"), approval_token: approvalTokenSchema },
    async ({ event, message, channel_id, approval_token }) => {
      requireMcpMutation("machines_notifications_dispatch", approval_token, { resourceId: mutationResourceId("notification-dispatch", channel_id, event), args: { event, message, channel_id } });
      return { content: [{ type: "text", text: JSON.stringify(await dispatchNotificationEvent(event, message, { channelId: channel_id, trustedApproval: trustedNotificationApproval }), null, 2) }] };
    }
  );

  server.tool(
    "machines_notifications_remove",
    "Remove a notification channel.",
    { channel_id: z.string().describe("Channel identifier"), approval_token: approvalTokenSchema },
    async ({ channel_id, approval_token }) => {
      requireMcpMutation("machines_notifications_remove", approval_token, { resourceId: mutationResourceId("notification", channel_id), args: { channel_id } });
      return { content: [{ type: "text", text: JSON.stringify(removeNotificationChannel(channel_id), null, 2) }] };
    }
  );

  server.tool(
    "machines_webhooks_add",
    "Add or replace a shared event webhook channel.",
    {
      channel_id: z.string().describe("Channel identifier"),
      url: z.string().url().describe("Webhook URL"),
      event_type: z.string().optional().describe("Optional event type filter, e.g. machines.*"),
      source: z.string().optional().describe("Optional source filter"),
      secret: z.string().optional().describe("Optional HMAC secret"),
      enabled: z.boolean().optional().describe("Whether the channel is enabled"),
      approval_token: approvalTokenSchema,
    },
    async ({ channel_id, url, event_type, source, secret, enabled, approval_token }) => {
      const resolvedEnabled = enabled ?? true;
      requireMcpMutation("machines_webhooks_add", approval_token, { resourceId: mutationResourceId("webhook", channel_id), args: { channel_id, url, event_type, source, secret, enabled: resolvedEnabled } });
      const now = new Date().toISOString();
      const channel = await events.addChannel({
        id: channel_id,
        enabled: resolvedEnabled,
        transport: "webhook",
        filters: event_type || source ? [{ type: event_type, source }] : undefined,
        webhook: { url, secret },
        createdAt: now,
        updatedAt: now,
      });
      return { content: [{ type: "text", text: JSON.stringify(sanitizeChannelForOutput(channel), null, 2) }] };
    }
  );

  server.tool("machines_webhooks_list", "List shared event webhook channels.", {}, async () => ({
    content: [{ type: "text", text: JSON.stringify(sanitizeChannelsForOutput(await events.listChannels()), null, 2) }],
  }));

  server.tool(
    "machines_webhooks_test",
    "Send a test event to one shared event channel.",
    { channel_id: z.string().describe("Channel identifier"), event_type: z.string().optional().describe("Event type"), message: z.string().optional().describe("Message body"), approval_token: approvalTokenSchema },
    async ({ channel_id, event_type, message, approval_token }) => {
      requireMcpMutation("machines_webhooks_test", approval_token, { resourceId: mutationResourceId("webhook-test", channel_id, event_type), args: { channel_id, event_type, message } });
      return {
        content: [{ type: "text", text: JSON.stringify(await events.testChannel(channel_id, { source: "machines", type: event_type ?? "events.test", message }), null, 2) }],
      };
    }
  );

  server.tool(
    "machines_webhooks_remove",
    "Remove a shared event channel.",
    { channel_id: z.string().describe("Channel identifier"), approval_token: approvalTokenSchema },
    async ({ channel_id, approval_token }) => {
      requireMcpMutation("machines_webhooks_remove", approval_token, { resourceId: mutationResourceId("webhook", channel_id), args: { channel_id } });
      return { content: [{ type: "text", text: JSON.stringify({ removed: await events.removeChannel(channel_id) }, null, 2) }] };
    }
  );

  server.tool(
    "machines_events_emit",
    "Emit a shared event from machines.",
    {
      event_type: z.string().describe("Event type"),
      subject: z.string().optional().describe("Event subject"),
      severity: z.enum(["debug", "info", "notice", "warning", "error", "critical"]).optional().describe("Event severity"),
      message: z.string().optional().describe("Message body"),
      data: z.record(z.unknown()).optional().describe("Event data"),
      metadata: z.record(z.unknown()).optional().describe("Event metadata"),
      dedupe_key: z.string().optional().describe("Dedupe key"),
      deliver: z.boolean().optional().describe("Deliver to matching channels"),
      approval_token: approvalTokenSchema,
    },
    async ({ event_type, subject, severity, message, data, metadata, dedupe_key, deliver, approval_token }) => {
      const resolvedData = data ?? {};
      const resolvedMetadata = metadata ?? {};
      const resolvedDeliver = deliver !== false;
      requireMcpMutation("machines_events_emit", approval_token, { resourceId: mutationResourceId("event", event_type, subject, dedupe_key), args: { event_type, subject, severity, message, data: resolvedData, metadata: resolvedMetadata, dedupe_key, deliver: resolvedDeliver } });
      return {
        content: [{ type: "text", text: JSON.stringify(await events.emit({
          source: "machines",
          type: event_type,
          subject,
          severity,
          message,
          data: resolvedData,
          metadata: resolvedMetadata,
          dedupeKey: dedupe_key,
        }, { deliver: resolvedDeliver }), null, 2) }],
      };
    }
  );

  server.tool("machines_events_list", "List shared events.", {}, async () => ({
    content: [{ type: "text", text: JSON.stringify(await events.listEvents(), null, 2) }],
  }));

  server.tool(
    "machines_events_replay",
    "Replay shared events.",
    { event_id: z.string().optional().describe("Event id"), source: z.string().optional().describe("Source filter"), event_type: z.string().optional().describe("Event type filter"), dry_run: z.boolean().optional().describe("Preview without delivery"), approval_token: approvalTokenSchema },
    async ({ event_id, source, event_type, dry_run, approval_token }) => {
      if (dry_run !== true) requireMcpMutation("machines_events_replay", approval_token, { resourceId: mutationResourceId("event-replay", event_id, source, event_type), args: { event_id, source, event_type, dry_run: false } });
      return {
        content: [{ type: "text", text: JSON.stringify(await events.replay({ eventId: event_id, source, type: event_type, dryRun: dry_run }), null, 2) }],
      };
    }
  );

  server.tool(
    "machines_serve_info",
    "Preview the dashboard server bind address and routes.",
    { host: z.string().optional().describe("Host interface"), port: z.number().optional().describe("Port number") },
    async ({ host, port }) => ({ content: [{ type: "text", text: JSON.stringify(getServeInfo({ host, port }), null, 2) }] })
  );

  server.tool("machines_serve_dashboard", "Render the current dashboard HTML.", {}, async () => ({
    content: [{ type: "text", text: renderDashboardHtml() }],
  }));

  server.tool("storage_status", "Show machines storage sync configuration and local sync history.", {}, async () => ({
    content: [{ type: "text", text: JSON.stringify(getStorageStatus(), null, 2) }],
  }));

  server.tool(
    "storage_push",
    "Push local machine runtime data to storage PostgreSQL.",
    { tables: z.array(z.string()).optional().describe("Optional table list to push"), approval_token: approvalTokenSchema },
    async ({ tables, approval_token }) => {
      const resolvedTables = resolveTables(tables);
      requireMcpMutation("storage_push", approval_token, { resourceId: mutationResourceId("storage-push", resolvedTables.join(",")), args: { tables: resolvedTables } });
      return { content: [{ type: "text", text: JSON.stringify(await storagePush({ tables: resolvedTables, trustedLocalMutation: createTrustedSdkMutationApproval() }), null, 2) }] };
    }
  );

  server.tool(
    "storage_pull",
    "Pull machine runtime data from storage PostgreSQL to local SQLite.",
    { tables: z.array(z.string()).optional().describe("Optional table list to pull"), approval_token: approvalTokenSchema },
    async ({ tables, approval_token }) => {
      const resolvedTables = resolveTables(tables);
      requireMcpMutation("storage_pull", approval_token, { resourceId: mutationResourceId("storage-pull", resolvedTables.join(",")), args: { tables: resolvedTables } });
      return { content: [{ type: "text", text: JSON.stringify(await storagePull({ tables: resolvedTables, trustedLocalMutation: createTrustedSdkMutationApproval() }), null, 2) }] };
    }
  );

  server.tool(
    "storage_sync",
    "Bidirectional machines storage sync: pull then push.",
    { tables: z.array(z.string()).optional().describe("Optional table list to sync"), approval_token: approvalTokenSchema },
    async ({ tables, approval_token }) => {
      const resolvedTables = resolveTables(tables);
      requireMcpMutation("storage_sync", approval_token, { resourceId: mutationResourceId("storage-sync", resolvedTables.join(",")), args: { tables: resolvedTables } });
      return { content: [{ type: "text", text: JSON.stringify(await storageSync({ tables: resolvedTables, trustedLocalMutation: createTrustedSdkMutationApproval() }), null, 2) }] };
    }
  );

  return server;
}
