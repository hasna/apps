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
import { getMachineDetails } from "../details.js";
import { getBrowserPlanFleet } from "../browserplan.js";
import { checkMachineCompatibility } from "../compatibility.js";
import { getStorageStatus, resolveTables, storagePull, storagePush, storageSync } from "../storage.js";
import { assertMutationApproved, createTrustedSdkMutationApproval, mutationPlanDigest } from "../commands/mutation-approval.js";
import { renderMcpCompactResult } from "../compact-output.js";

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
const verboseOutputSchema = z.boolean().optional().describe("Return full JSON output instead of the compact default");

function mcpResult(data: unknown, label: string, verbose?: boolean) {
  return {
    content: [{
      type: "text" as const,
      text: verbose ? JSON.stringify(data, null, 2) : renderMcpCompactResult(label, data),
    }],
  };
}

function mcpRawText(fullText: string, compactText: string, verbose?: boolean) {
  return {
    content: [{
      type: "text" as const,
      text: verbose ? fullText : compactText,
    }],
  };
}

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
    { private_metadata: z.boolean().optional().describe("Include private local paths and machine identifiers"), verbose: verboseOutputSchema },
    async ({ private_metadata, verbose }) => {
      const privateMetadata = privateMetadataAllowed(private_metadata);
      const warnings = privateOutputWarnings(private_metadata, privateMetadata);
      return mcpResult(appendWarnings(getStatus({ privateMetadata }), warnings), "machines_status", verbose);
    }
  );

  server.tool(
    "machines_doctor",
    "Run machine preflight checks.",
    { machine_id: z.string().optional().describe("Machine identifier"), verbose: verboseOutputSchema },
    async ({ machine_id, verbose }) => mcpResult(runDoctor(machine_id), "machines_doctor", verbose)
  );

  server.tool("machines_self_test", "Run local package smoke checks.", { verbose: verboseOutputSchema }, async ({ verbose }) => (
    mcpResult(runSelfTest(), "machines_self_test", verbose)
  ));

  server.tool(
    "machines_apps_list",
    "List manifest-managed apps for a machine.",
    { machine_id: z.string().optional().describe("Machine identifier"), verbose: verboseOutputSchema },
    async ({ machine_id, verbose }) => mcpResult(listApps(machine_id), "machines_apps_list", verbose)
  );

  server.tool(
    "machines_apps_status",
    "Check installed state for manifest-managed apps.",
    { machine_id: z.string().optional().describe("Machine identifier"), verbose: verboseOutputSchema },
    async ({ machine_id, verbose }) => mcpResult(getAppsStatus(machine_id), "machines_apps_status", verbose)
  );

  server.tool(
    "machines_apps_diff",
    "Show missing and installed manifest-managed apps.",
    { machine_id: z.string().optional().describe("Machine identifier"), verbose: verboseOutputSchema },
    async ({ machine_id, verbose }) => mcpResult(diffApps(machine_id), "machines_apps_diff", verbose)
  );

  server.tool(
    "machines_apps_plan",
    "Preview app install steps for a machine.",
    { machine_id: z.string().optional().describe("Machine identifier"), verbose: verboseOutputSchema },
    async ({ machine_id, verbose }) => mcpResult(buildAppsPlan(machine_id), "machines_apps_plan", verbose)
  );

  server.tool(
    "machines_apps_apply",
    "Install manifest-managed apps for a machine.",
    { machine_id: z.string().optional().describe("Machine identifier"), yes: z.boolean().describe("Confirmation flag for execution"), approval_token: approvalTokenSchema, verbose: verboseOutputSchema },
    async ({ machine_id, yes, approval_token, verbose }) => {
      const resolvedMachineId = mutationMachineId(machine_id);
      const plan = buildAppsPlan(machine_id);
      requireMcpMutation("machines_apps_apply", approval_token, {
        machineId: resolvedMachineId,
        resourceId: mcpPlanResourceId("machines_apps_apply", resolvedMachineId, plan),
        args: mcpPlanApprovalArgs({ machine_id: resolvedMachineId, yes }, plan),
      });
      return mcpResult(runAppsPlan(plan, { apply: true, yes }), "machines_apps_apply", verbose);
    }
  );

  server.tool("machines_manifest", "Read the current fleet manifest.", { verbose: verboseOutputSchema }, async ({ verbose }) => (
    mcpResult(manifestList(), "machines_manifest", verbose)
  ));
  server.tool("machines_manifest_validate", "Validate the current fleet manifest.", { verbose: verboseOutputSchema }, async ({ verbose }) => (
    mcpResult(manifestValidate(), "machines_manifest_validate", verbose)
  ));
  server.tool(
    "machines_manifest_bootstrap",
    "Detect and upsert the current machine into the fleet manifest.",
    { approval_token: approvalTokenSchema, verbose: verboseOutputSchema },
    async ({ approval_token, verbose }) => {
      requireMcpMutation("machines_manifest_bootstrap", approval_token, { resourceId: "manifest:bootstrap", args: {} });
      return mcpResult(manifestBootstrapCurrentMachine(), "machines_manifest_bootstrap", verbose);
    }
  );
  server.tool(
    "machines_manifest_get",
    "Read a single machine from the fleet manifest.",
    { machine_id: z.string().describe("Machine identifier"), verbose: verboseOutputSchema },
    async ({ machine_id, verbose }) => mcpResult(manifestGet(machine_id), "machines_manifest_get", verbose)
  );
  server.tool(
    "machines_friendly_name_get",
    "Read a machine friendly name and computed display name without changing the stable machine id.",
    { machine_id: z.string().describe("Machine identifier"), verbose: verboseOutputSchema },
    async ({ machine_id, verbose }) => mcpResult(manifestGetFriendlyName(machine_id), "machines_friendly_name_get", verbose)
  );
  server.tool(
    "machines_friendly_name_set",
    "Set a user-friendly display name for a machine without changing the stable machine id.",
    {
      machine_id: z.string().describe("Machine identifier"),
      friendly_name: z.string().describe("User-friendly display name"),
      approval_token: approvalTokenSchema,
      verbose: verboseOutputSchema,
    },
    async ({ machine_id, friendly_name, approval_token, verbose }) => {
      const input = { machineId: machine_id, friendlyName: friendly_name };
      requireMcpMutation("machines_friendly_name_set", approval_token, {
        machineId: input.machineId,
        resourceId: machineFriendlyNameResourceId(input.machineId),
        args: setMachineFriendlyNameMutationArgs(input),
      });
      return mcpResult(manifestSetFriendlyName(input), "machines_friendly_name_set", verbose);
    }
  );
  server.tool(
    "machines_friendly_name_clear",
    "Clear a machine friendly name so consumers fall back to the stable machine id.",
    {
      machine_id: z.string().describe("Machine identifier"),
      approval_token: approvalTokenSchema,
      verbose: verboseOutputSchema,
    },
    async ({ machine_id, approval_token, verbose }) => {
      const input = { machineId: machine_id };
      requireMcpMutation("machines_friendly_name_clear", approval_token, {
        machineId: input.machineId,
        resourceId: machineFriendlyNameResourceId(input.machineId),
        args: clearMachineFriendlyNameMutationArgs(input),
      });
      return mcpResult(manifestClearFriendlyName(input), "machines_friendly_name_clear", verbose);
    }
  );
  server.tool(
    "machines_details",
    "Return consumer-safe machine details for right-click View details.",
    {
      machine_id: z.string().optional().describe("Machine identifier; defaults to local"),
      include_tailscale: z.boolean().optional().describe("Whether to probe tailscale while resolving details"),
      verbose: verboseOutputSchema,
    },
    async ({ machine_id, include_tailscale, verbose }) => mcpResult(getMachineDetails(machine_id ?? "local", {
      includeTailscale: include_tailscale,
    }), "machines_details", verbose)
  );
  server.tool(
    "machines_browserplan_fleet",
    "Return BrowserPlan target machine001-machine011 fleet metadata and safe remote operation hooks.",
    {
      machine_ids: z.array(z.string()).optional().describe("Optional BrowserPlan machine ids; spark01/spark02 are excluded"),
      include_tailscale: z.boolean().optional().describe("Whether to probe tailscale while resolving reachability"),
      check_installs: z.boolean().optional().describe("Run remote compatibility probes for browserplan/chrome/bun/git state"),
      verbose: verboseOutputSchema,
    },
    async ({ machine_ids, include_tailscale, check_installs, verbose }) => mcpResult(getBrowserPlanFleet({
      machineIds: machine_ids,
      includeTailscale: include_tailscale,
      includeInstallState: check_installs,
    }), "machines_browserplan_fleet", verbose)
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
      source: z.enum(["open-notes", "agent", "sync", "import", "open-machines", "unknown"]).optional().describe("Provenance source"),
      include_tailscale: z.boolean().optional().describe("Whether to probe tailscale while building context"),
      verbose: verboseOutputSchema,
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
      verbose,
    }) => mcpResult(resolveNoteMachineContext({
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
    }), "machines_notes_context", verbose)
  );
  server.tool(
    "machines_notes_trash_policies",
    "List per-machine note trash retention metadata with latest-10/View-more pagination.",
    {
      machine_id: z.string().optional().describe("Filter by machine identifier"),
      limit: z.number().int().min(1).nullable().optional().describe("Maximum machines to return; default is 10, null returns all"),
      offset: z.number().int().min(0).optional().describe("Machine list offset for View more pagination"),
      include_tailscale: z.boolean().optional().describe("Whether to probe tailscale while listing policies"),
      verbose: verboseOutputSchema,
    },
    async ({ machine_id, limit, offset, include_tailscale, verbose }) => mcpResult(listMachineTrashPolicies({
      machineId: machine_id,
      limit,
      offset,
      includeTailscale: include_tailscale,
    }), "machines_notes_trash_policies", verbose)
  );
  server.tool(
    "machines_manifest_remove",
    "Remove a single machine from the fleet manifest.",
    { machine_id: z.string().describe("Machine identifier"), approval_token: approvalTokenSchema, verbose: verboseOutputSchema },
    async ({ machine_id, approval_token, verbose }) => {
      requireMcpMutation("machines_manifest_remove", approval_token, { machineId: machine_id, args: { machine_id } });
      return mcpResult(manifestRemove(machine_id), "machines_manifest_remove", verbose);
    }
  );

  server.tool(
    "machines_agent_status",
    "List current machine agent heartbeats.",
    { private_metadata: z.boolean().optional().describe("Include private heartbeat metadata"), verbose: verboseOutputSchema },
    async ({ private_metadata, verbose }) => {
      const privateMetadata = privateMetadataAllowed(private_metadata);
      const warnings = privateOutputWarnings(private_metadata, privateMetadata);
      const agents = getAgentStatus(undefined, { privateMetadata });
      return mcpResult(warnings.length > 0 ? { agents, warnings } : agents, "machines_agent_status", verbose);
    }
  );

  server.tool(
    "machines_daemon_status",
    "List fleet daemon heartbeat status rows.",
    { private_metadata: z.boolean().optional().describe("Include private heartbeat metadata"), verbose: verboseOutputSchema },
    async ({ private_metadata, verbose }) => {
      const privateMetadata = privateMetadataAllowed(private_metadata);
      const warnings = privateOutputWarnings(private_metadata, privateMetadata);
      return mcpResult({
        generated_at: new Date().toISOString(),
        agents: getAgentStatus(undefined, { privateMetadata }),
        ...(warnings.length > 0 ? { warnings } : {}),
      }, "machines_daemon_status", verbose);
    }
  );

  server.tool(
    "machines_daemon_service_plan",
    "Plan launchd/systemd lifecycle commands for the machines-agent daemon.",
    {
      action: z.enum(["install", "uninstall", "restart", "status", "logs"]).describe("Daemon lifecycle action"),
      platform: z.enum(["macos", "linux"]).optional().describe("Target service platform"),
      mode: z.enum(["user", "system"]).optional().describe("Service mode"),
      service_name: z.string().optional().describe("Service name/label"),
      executable: z.string().optional().describe("machines-agent executable path"),
      interval_ms: z.number().optional().describe("Heartbeat interval in milliseconds"),
      storage_push: z.boolean().optional().describe("Configure heartbeat storage push"),
      doctor_summary: z.boolean().optional().describe("Configure lightweight doctor summaries in heartbeat metadata"),
      private_metadata: z.boolean().optional().describe("Opt in to private heartbeat metadata"),
      env: z.array(z.string()).optional().describe("Environment variable names to include as placeholders"),
      verbose: verboseOutputSchema,
    },
    async ({ action, platform, mode, service_name, executable, interval_ms, storage_push, doctor_summary, private_metadata, env, verbose }) => mcpResult(buildDaemonServicePlan({
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
    }), "machines_daemon_service_plan", verbose)
  );

  server.tool(
    "machines_setup_preview",
    "Preview setup actions for a machine.",
    { machine_id: z.string().optional().describe("Machine identifier"), verbose: verboseOutputSchema },
    async ({ machine_id, verbose }) => mcpResult(buildSetupPlan(machine_id), "machines_setup_preview", verbose)
  );

  server.tool(
    "machines_setup_apply",
    "Execute setup actions for a machine.",
    { machine_id: z.string().optional().describe("Machine identifier"), yes: z.boolean().describe("Confirmation flag for execution"), approval_token: approvalTokenSchema, verbose: verboseOutputSchema },
    async ({ machine_id, yes, approval_token, verbose }) => {
      const resolvedMachineId = mutationMachineId(machine_id);
      const plan = buildSetupPlan(machine_id);
      requireMcpMutation("machines_setup_apply", approval_token, {
        machineId: resolvedMachineId,
        resourceId: mcpPlanResourceId("machines_setup_apply", resolvedMachineId, plan),
        args: mcpPlanApprovalArgs({ machine_id: resolvedMachineId, yes }, plan),
      });
      return mcpResult(runSetupPlan(plan, { apply: true, yes }), "machines_setup_apply", verbose);
    }
  );

  server.tool(
    "machines_sync_preview",
    "Preview sync actions for a machine.",
    { machine_id: z.string().optional().describe("Machine identifier"), verbose: verboseOutputSchema },
    async ({ machine_id, verbose }) => mcpResult(buildSyncPlan(machine_id), "machines_sync_preview", verbose)
  );

  server.tool(
    "machines_sync_apply",
    "Execute sync actions for a machine.",
    { machine_id: z.string().optional().describe("Machine identifier"), yes: z.boolean().describe("Confirmation flag for execution"), approval_token: approvalTokenSchema, verbose: verboseOutputSchema },
    async ({ machine_id, yes, approval_token, verbose }) => {
      const resolvedMachineId = mutationMachineId(machine_id);
      const plan = buildSyncPlan(machine_id);
      requireMcpMutation("machines_sync_apply", approval_token, {
        machineId: resolvedMachineId,
        resourceId: mcpPlanResourceId("machines_sync_apply", resolvedMachineId, plan),
        args: mcpPlanApprovalArgs({ machine_id: resolvedMachineId, yes }, plan),
      });
      return mcpResult(runSyncPlan(plan, { apply: true, yes }), "machines_sync_apply", verbose);
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
      verbose: verboseOutputSchema,
    },
    async ({ include_tailscale, limit, offset, private_metadata, verbose }) => {
      const privateMetadata = privateMetadataAllowed(private_metadata);
      const warnings = privateOutputWarnings(private_metadata, privateMetadata);
      const topology = redactTopologyForOutput(discoverMachineTopology({
        includeTailscale: include_tailscale !== false,
        limit,
        offset,
      }), { privateMetadata });
      return mcpResult(appendWarnings(topology, warnings), "machines_topology", verbose);
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
      verbose: verboseOutputSchema,
    },
    async ({ machine_id, commands, packages, workspaces, verbose }) => mcpResult(checkMachineCompatibility({ machineId: machine_id, commands, packages, workspaces }), "machines_compatibility", verbose)
  );

  server.tool(
    "machines_diff",
    "Show manifest differences between two machines.",
    {
      left_machine_id: z.string().describe("Left machine identifier"),
      right_machine_id: z.string().optional().describe("Right machine identifier"),
      verbose: verboseOutputSchema,
    },
    async ({ left_machine_id, right_machine_id, verbose }) => mcpResult(diffMachines(left_machine_id, right_machine_id), "machines_diff", verbose)
  );

  server.tool(
    "machines_install_claude_status",
    "Check installed state for Claude, Codex, and Gemini CLIs.",
    {
      machine_id: z.string().optional().describe("Machine identifier"),
      tools: z.array(z.enum(["claude", "codex", "gemini"])).optional().describe("AI CLIs to inspect"),
      verbose: verboseOutputSchema,
    },
    async ({ machine_id, tools, verbose }) => mcpResult(getClaudeCliStatus(machine_id, tools), "machines_install_claude_status", verbose)
  );

  server.tool(
    "machines_install_claude_diff",
    "Show missing and installed Claude, Codex, and Gemini CLIs.",
    {
      machine_id: z.string().optional().describe("Machine identifier"),
      tools: z.array(z.enum(["claude", "codex", "gemini"])).optional().describe("AI CLIs to inspect"),
      verbose: verboseOutputSchema,
    },
    async ({ machine_id, tools, verbose }) => mcpResult(diffClaudeCli(machine_id, tools), "machines_install_claude_diff", verbose)
  );

  server.tool(
    "machines_install_claude_preview",
    "Preview Claude, Codex, and Gemini CLI install steps for a machine.",
    {
      machine_id: z.string().optional().describe("Machine identifier"),
      tools: z.array(z.enum(["claude", "codex", "gemini"])).optional().describe("AI CLIs to install"),
      verbose: verboseOutputSchema,
    },
    async ({ machine_id, tools, verbose }) => mcpResult(buildClaudeInstallPlan(machine_id, tools), "machines_install_claude_preview", verbose)
  );

  server.tool(
    "machines_install_claude_apply",
    "Execute Claude, Codex, and Gemini CLI install steps for a machine.",
    {
      machine_id: z.string().optional().describe("Machine identifier"),
      tools: z.array(z.enum(["claude", "codex", "gemini"])).optional().describe("AI CLIs to install"),
      yes: z.boolean().describe("Confirmation flag for execution"),
      approval_token: approvalTokenSchema,
      verbose: verboseOutputSchema,
    },
    async ({ machine_id, tools, yes, approval_token, verbose }) => {
      const resolvedMachineId = mutationMachineId(machine_id);
      const plan = buildClaudeInstallPlan(machine_id, tools);
      requireMcpMutation("machines_install_claude_apply", approval_token, {
        machineId: resolvedMachineId,
        resourceId: mcpPlanResourceId("machines_install_claude_apply", resolvedMachineId, plan),
        args: mcpPlanApprovalArgs({ machine_id: resolvedMachineId, tools, yes }, plan),
      });
      return {
        ...mcpResult(runClaudeInstallPlan(plan, { apply: true, yes }), "machines_install_claude_apply", verbose),
      };
    }
  );

  server.tool(
    "machines_install_tailscale_preview",
    "Preview Tailscale install steps for a machine.",
    { machine_id: z.string().optional().describe("Machine identifier"), verbose: verboseOutputSchema },
    async ({ machine_id, verbose }) => mcpResult(buildTailscaleInstallPlan(machine_id), "machines_install_tailscale_preview", verbose)
  );

  server.tool(
    "machines_install_tailscale_apply",
    "Execute Tailscale install steps for a machine.",
    { machine_id: z.string().optional().describe("Machine identifier"), yes: z.boolean().describe("Confirmation flag for execution"), approval_token: approvalTokenSchema, verbose: verboseOutputSchema },
    async ({ machine_id, yes, approval_token, verbose }) => {
      const resolvedMachineId = mutationMachineId(machine_id);
      const plan = buildTailscaleInstallPlan(machine_id);
      requireMcpMutation("machines_install_tailscale_apply", approval_token, {
        machineId: resolvedMachineId,
        resourceId: mcpPlanResourceId("machines_install_tailscale_apply", resolvedMachineId, plan),
        args: mcpPlanApprovalArgs({ machine_id: resolvedMachineId, yes }, plan),
      });
      return mcpResult(runTailscaleInstallPlan(plan, { apply: true, yes }), "machines_install_tailscale_apply", verbose);
    }
  );

  server.tool(
    "machines_route_resolve",
    "Resolve the best route for a machine using manifest, heartbeat, SSH, LAN, and Tailscale topology.",
    {
      machine_id: z.string().describe("Machine identifier"),
      include_tailscale: z.boolean().optional().describe("Whether to probe tailscale status --json"),
      private_metadata: z.boolean().optional().describe("Include private route targets"),
      verbose: verboseOutputSchema,
    },
    async ({ machine_id, include_tailscale, private_metadata, verbose }) => {
      const privateMetadata = privateMetadataAllowed(private_metadata);
      const warnings = privateOutputWarnings(private_metadata, privateMetadata);
      const route = redactRouteForOutput(resolveMachineRoute(machine_id, { includeTailscale: include_tailscale !== false }), { privateMetadata });
      return mcpResult(appendWarnings(route, warnings), "machines_route_resolve", verbose);
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
      verbose: verboseOutputSchema,
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
      verbose,
    }) => mcpResult(resolveMachineWorkspace({
      machineId: machine_id,
      projectId: project_id,
      repoName: repo_name,
      openFilesRepoName: open_files_repo_name,
      primaryMachineId: primary_machine_id,
      workspaceRoot: workspace_root,
      projectRoot: project_root,
      openFilesRoot: open_files_root,
      includeTailscale: include_tailscale !== false,
    }), "machines_workspace_resolve", verbose)
  );

  server.tool(
    "machines_ssh_resolve",
    "Resolve the best SSH route for a machine.",
    {
      machine_id: z.string().describe("Machine identifier"),
      remote_command: z.string().optional().describe("Optional remote command"),
      private_metadata: z.boolean().optional().describe("Include private SSH target and command"),
      verbose: verboseOutputSchema,
    },
    async ({ machine_id, remote_command, private_metadata, verbose }) => {
      const privateMetadata = privateMetadataAllowed(private_metadata);
      const warnings = privateOutputWarnings(private_metadata, privateMetadata);
      const resolved = resolveMachineRoute(machine_id);
      const publicResolved = redactRouteForOutput(resolved, { privateMetadata });
      const command = resolved.ok && privateMetadata ? buildSshCommand(machine_id, remote_command) : resolved.ok ? "[redacted]" : null;
      return mcpResult(appendWarnings({ resolved: publicResolved, command }, warnings), "machines_ssh_resolve", verbose);
    }
  );

  server.tool("machines_ports", "List listening ports on a machine.", { machine_id: z.string().optional().describe("Machine identifier"), verbose: verboseOutputSchema }, async ({ machine_id, verbose }) => (
    mcpResult(listPorts(machine_id), "machines_ports", verbose)
  ));

  server.tool(
    "machines_backup_preview",
    "Preview backup steps for the current machine.",
    { bucket: z.string().optional().describe("S3 bucket name; defaults to HASNA_MACHINES_S3_BUCKET or MACHINES_S3_BUCKET"), prefix: z.string().optional().describe("S3 key prefix; defaults to HASNA_MACHINES_S3_PREFIX, MACHINES_S3_PREFIX, or machines"), verbose: verboseOutputSchema },
    async ({ bucket, prefix, verbose }) => mcpResult(buildBackupPlan(bucket, prefix), "machines_backup_preview", verbose)
  );

  server.tool(
    "machines_backup_apply",
    "Execute backup steps for the current machine.",
    { bucket: z.string().optional().describe("S3 bucket name; defaults to HASNA_MACHINES_S3_BUCKET or MACHINES_S3_BUCKET"), prefix: z.string().optional().describe("S3 key prefix; defaults to HASNA_MACHINES_S3_PREFIX, MACHINES_S3_PREFIX, or machines"), yes: z.boolean().describe("Confirmation flag for execution"), approval_token: approvalTokenSchema, verbose: verboseOutputSchema },
    async ({ bucket, prefix, yes, approval_token, verbose }) => {
      requireMcpMutation("machines_backup_apply", approval_token, { resourceId: mutationResourceId("backup", bucket, prefix), args: { bucket, prefix, yes } });
      return mcpResult(runBackup(bucket, prefix, { apply: true, yes }), "machines_backup_apply", verbose);
    }
  );

  server.tool(
    "machines_cert_preview",
    "Preview mkcert steps for one or more domains.",
    { domains: z.array(z.string()).describe("Domains to issue certificates for"), verbose: verboseOutputSchema },
    async ({ domains, verbose }) => mcpResult(buildCertPlan(domains), "machines_cert_preview", verbose)
  );

  server.tool(
    "machines_cert_apply",
    "Execute mkcert steps for one or more domains.",
    { domains: z.array(z.string()).describe("Domains to issue certificates for"), yes: z.boolean().describe("Confirmation flag for execution"), approval_token: approvalTokenSchema, verbose: verboseOutputSchema },
    async ({ domains, yes, approval_token, verbose }) => {
      requireMcpMutation("machines_cert_apply", approval_token, { resourceId: mutationResourceId("cert", domains.join(",")), args: { domains, yes } });
      return mcpResult(runCertPlan(domains, { apply: true, yes }), "machines_cert_apply", verbose);
    }
  );

  server.tool(
    "machines_dns_add",
    "Add or replace a local domain mapping.",
    { domain: z.string().describe("Domain name"), port: z.number().describe("Target port"), target_host: z.string().optional().describe("Target host"), approval_token: approvalTokenSchema, verbose: verboseOutputSchema },
    async ({ domain, port, target_host, approval_token, verbose }) => {
      const resolvedTargetHost = target_host ?? "127.0.0.1";
      requireMcpMutation("machines_dns_add", approval_token, { resourceId: mutationResourceId("dns", domain), args: { domain, port, target_host: resolvedTargetHost } });
      return mcpResult(addDomainMapping(domain, port, resolvedTargetHost), "machines_dns_add", verbose);
    }
  );
  server.tool("machines_dns_list", "List local domain mappings.", { verbose: verboseOutputSchema }, async ({ verbose }) => mcpResult(listDomainMappings(), "machines_dns_list", verbose));
  server.tool(
    "machines_dns_render",
    "Render hosts/proxy configuration for a domain.",
    { domain: z.string().describe("Domain name"), verbose: verboseOutputSchema },
    async ({ domain, verbose }) => mcpResult(renderDomainMapping(domain), "machines_dns_render", verbose)
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
      verbose: verboseOutputSchema,
    },
    async ({ channel_id, type, target, command_args, events, enabled, approval_token, verbose }) => {
      const resolvedEnabled = enabled ?? true;
      const resolvedEvents = [...new Set(events)];
      const commandArgs = command_args ?? [];
      requireMcpMutation("machines_notifications_add", approval_token, { resourceId: mutationResourceId("notification", channel_id), args: { channel_id, type, target, command_args: commandArgs, events: resolvedEvents, enabled: resolvedEnabled } });
      return {
        ...mcpResult(addNotificationChannel({ id: channel_id, type, target, commandArgs: type === "command" && commandArgs.length > 0 ? commandArgs : undefined, events: resolvedEvents, enabled: resolvedEnabled }, { trustedApproval: trustedNotificationApproval }), "machines_notifications_add", verbose),
      };
    }
  );

  server.tool("machines_notifications_list", "List notification channels.", { verbose: verboseOutputSchema }, async ({ verbose }) => (
    mcpResult(listNotificationChannels(), "machines_notifications_list", verbose)
  ));

  server.tool(
    "machines_notifications_test",
    "Preview or execute a notification test.",
    { channel_id: z.string().describe("Channel identifier"), event: z.string().optional().describe("Event name"), message: z.string().optional().describe("Message body"), yes: z.boolean().optional().describe("Execute the test when true"), approval_token: approvalTokenSchema, verbose: verboseOutputSchema },
    async ({ channel_id, event, message, yes, approval_token, verbose }) => {
      if (yes === true) requireMcpMutation("machines_notifications_test", approval_token, { resourceId: mutationResourceId("notification-test", channel_id, event), args: { channel_id, event, message, yes: true } });
      return mcpResult(await testNotificationChannel(channel_id, event, message, { apply: Boolean(yes), yes, trustedApproval: yes === true ? trustedNotificationApproval : undefined }), "machines_notifications_test", verbose);
    }
  );

  server.tool(
    "machines_notifications_dispatch",
    "Dispatch an event to matching notification channels.",
    { event: z.string().describe("Event name"), message: z.string().describe("Message body"), channel_id: z.string().optional().describe("Limit delivery to one channel"), approval_token: approvalTokenSchema, verbose: verboseOutputSchema },
    async ({ event, message, channel_id, approval_token, verbose }) => {
      requireMcpMutation("machines_notifications_dispatch", approval_token, { resourceId: mutationResourceId("notification-dispatch", channel_id, event), args: { event, message, channel_id } });
      return mcpResult(await dispatchNotificationEvent(event, message, { channelId: channel_id, trustedApproval: trustedNotificationApproval }), "machines_notifications_dispatch", verbose);
    }
  );

  server.tool(
    "machines_notifications_remove",
    "Remove a notification channel.",
    { channel_id: z.string().describe("Channel identifier"), approval_token: approvalTokenSchema, verbose: verboseOutputSchema },
    async ({ channel_id, approval_token, verbose }) => {
      requireMcpMutation("machines_notifications_remove", approval_token, { resourceId: mutationResourceId("notification", channel_id), args: { channel_id } });
      return mcpResult(removeNotificationChannel(channel_id), "machines_notifications_remove", verbose);
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
      verbose: verboseOutputSchema,
    },
    async ({ channel_id, url, event_type, source, secret, enabled, approval_token, verbose }) => {
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
      return mcpResult(sanitizeChannelForOutput(channel), "machines_webhooks_add", verbose);
    }
  );

  server.tool("machines_webhooks_list", "List shared event webhook channels.", { verbose: verboseOutputSchema }, async ({ verbose }) => (
    mcpResult(sanitizeChannelsForOutput(await events.listChannels()), "machines_webhooks_list", verbose)
  ));

  server.tool(
    "machines_webhooks_test",
    "Send a test event to one shared event channel.",
    { channel_id: z.string().describe("Channel identifier"), event_type: z.string().optional().describe("Event type"), message: z.string().optional().describe("Message body"), approval_token: approvalTokenSchema, verbose: verboseOutputSchema },
    async ({ channel_id, event_type, message, approval_token, verbose }) => {
      requireMcpMutation("machines_webhooks_test", approval_token, { resourceId: mutationResourceId("webhook-test", channel_id, event_type), args: { channel_id, event_type, message } });
      return mcpResult(await events.testChannel(channel_id, { source: "machines", type: event_type ?? "events.test", message }), "machines_webhooks_test", verbose);
    }
  );

  server.tool(
    "machines_webhooks_remove",
    "Remove a shared event channel.",
    { channel_id: z.string().describe("Channel identifier"), approval_token: approvalTokenSchema, verbose: verboseOutputSchema },
    async ({ channel_id, approval_token, verbose }) => {
      requireMcpMutation("machines_webhooks_remove", approval_token, { resourceId: mutationResourceId("webhook", channel_id), args: { channel_id } });
      return mcpResult({ removed: await events.removeChannel(channel_id) }, "machines_webhooks_remove", verbose);
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
      verbose: verboseOutputSchema,
    },
    async ({ event_type, subject, severity, message, data, metadata, dedupe_key, deliver, approval_token, verbose }) => {
      const resolvedData = data ?? {};
      const resolvedMetadata = metadata ?? {};
      const resolvedDeliver = deliver !== false;
      requireMcpMutation("machines_events_emit", approval_token, { resourceId: mutationResourceId("event", event_type, subject, dedupe_key), args: { event_type, subject, severity, message, data: resolvedData, metadata: resolvedMetadata, dedupe_key, deliver: resolvedDeliver } });
      return {
        ...mcpResult(await events.emit({
          source: "machines",
          type: event_type,
          subject,
          severity,
          message,
          data: resolvedData,
          metadata: resolvedMetadata,
          dedupeKey: dedupe_key,
        }, { deliver: resolvedDeliver }), "machines_events_emit", verbose),
      };
    }
  );

  server.tool("machines_events_list", "List shared events.", { verbose: verboseOutputSchema }, async ({ verbose }) => (
    mcpResult(await events.listEvents(), "machines_events_list", verbose)
  ));

  server.tool(
    "machines_events_replay",
    "Replay shared events.",
    { event_id: z.string().optional().describe("Event id"), source: z.string().optional().describe("Source filter"), event_type: z.string().optional().describe("Event type filter"), dry_run: z.boolean().optional().describe("Preview without delivery"), approval_token: approvalTokenSchema, verbose: verboseOutputSchema },
    async ({ event_id, source, event_type, dry_run, approval_token, verbose }) => {
      if (dry_run !== true) requireMcpMutation("machines_events_replay", approval_token, { resourceId: mutationResourceId("event-replay", event_id, source, event_type), args: { event_id, source, event_type, dry_run: false } });
      return mcpResult(await events.replay({ eventId: event_id, source, type: event_type, dryRun: dry_run }), "machines_events_replay", verbose);
    }
  );

  server.tool(
    "machines_serve_info",
    "Preview the dashboard server bind address and routes.",
    { host: z.string().optional().describe("Host interface"), port: z.number().optional().describe("Port number"), verbose: verboseOutputSchema },
    async ({ host, port, verbose }) => mcpResult(getServeInfo({ host, port }), "machines_serve_info", verbose)
  );

  server.tool("machines_serve_dashboard", "Render the current dashboard HTML.", { verbose: verboseOutputSchema }, async ({ verbose }) => {
    const html = renderDashboardHtml();
    return mcpRawText(html, `machines_serve_dashboard: ${html.length} bytes of HTML\nhint: pass verbose: true to return the full dashboard HTML.`, verbose);
  });

  server.tool("storage_status", "Show machines storage sync configuration and local sync history.", { verbose: verboseOutputSchema }, async ({ verbose }) => (
    mcpResult(getStorageStatus(), "storage_status", verbose)
  ));

  server.tool(
    "storage_push",
    "Push local machine runtime data to storage PostgreSQL.",
    { tables: z.array(z.string()).optional().describe("Optional table list to push"), approval_token: approvalTokenSchema, verbose: verboseOutputSchema },
    async ({ tables, approval_token, verbose }) => {
      const resolvedTables = resolveTables(tables);
      requireMcpMutation("storage_push", approval_token, { resourceId: mutationResourceId("storage-push", resolvedTables.join(",")), args: { tables: resolvedTables } });
      return mcpResult(await storagePush({ tables: resolvedTables, trustedLocalMutation: createTrustedSdkMutationApproval() }), "storage_push", verbose);
    }
  );

  server.tool(
    "storage_pull",
    "Pull machine runtime data from storage PostgreSQL to local SQLite.",
    { tables: z.array(z.string()).optional().describe("Optional table list to pull"), approval_token: approvalTokenSchema, verbose: verboseOutputSchema },
    async ({ tables, approval_token, verbose }) => {
      const resolvedTables = resolveTables(tables);
      requireMcpMutation("storage_pull", approval_token, { resourceId: mutationResourceId("storage-pull", resolvedTables.join(",")), args: { tables: resolvedTables } });
      return mcpResult(await storagePull({ tables: resolvedTables, trustedLocalMutation: createTrustedSdkMutationApproval() }), "storage_pull", verbose);
    }
  );

  server.tool(
    "storage_sync",
    "Bidirectional machines storage sync: pull then push.",
    { tables: z.array(z.string()).optional().describe("Optional table list to sync"), approval_token: approvalTokenSchema, verbose: verboseOutputSchema },
    async ({ tables, approval_token, verbose }) => {
      const resolvedTables = resolveTables(tables);
      requireMcpMutation("storage_sync", approval_token, { resourceId: mutationResourceId("storage-sync", resolvedTables.join(",")), args: { tables: resolvedTables } });
      return mcpResult(await storageSync({ tables: resolvedTables, trustedLocalMutation: createTrustedSdkMutationApproval() }), "storage_sync", verbose);
    }
  );

  return server;
}
