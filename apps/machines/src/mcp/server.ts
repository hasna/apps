import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import { buildBackupPlan, runBackup } from "../commands/backup.js";
import { buildAppsPlan, listApps, runAppsInstall } from "../commands/apps.js";
import { buildCertPlan, runCertPlan } from "../commands/cert.js";
import { addDomainMapping, listDomainMappings, renderDomainMapping } from "../commands/dns.js";
import { diffMachines } from "../commands/diff.js";
import { buildClaudeInstallPlan, runClaudeInstall } from "../commands/install-claude.js";
import { buildTailscaleInstallPlan, runTailscaleInstall } from "../commands/install-tailscale.js";
import {
  addNotificationChannel,
  listNotificationChannels,
  removeNotificationChannel,
  testNotificationChannel,
} from "../commands/notifications.js";
import { listPorts } from "../commands/ports.js";
import { getServeInfo, renderDashboardHtml } from "../commands/serve.js";
import { buildSshCommand, resolveSshTarget } from "../commands/ssh.js";
import { getStatus } from "../commands/status.js";
import { manifestBootstrapCurrentMachine, manifestGet, manifestList, manifestRemove, manifestValidate } from "../commands/manifest.js";
import { buildSetupPlan, runSetup } from "../commands/setup.js";
import { buildSyncPlan, runSync } from "../commands/sync.js";
import { getAgentStatus } from "../agent/runtime.js";

export const MACHINE_MCP_TOOL_NAMES = [
  "machines_status",
  "machines_apps_list",
  "machines_apps_plan",
  "machines_apps_apply",
  "machines_manifest",
  "machines_manifest_validate",
  "machines_manifest_bootstrap",
  "machines_manifest_get",
  "machines_manifest_remove",
  "machines_agent_status",
  "machines_setup_preview",
  "machines_setup_apply",
  "machines_sync_preview",
  "machines_sync_apply",
  "machines_diff",
  "machines_install_tailscale_preview",
  "machines_install_tailscale_apply",
  "machines_install_claude_preview",
  "machines_install_claude_apply",
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
  "machines_notifications_remove",
  "machines_serve_info",
  "machines_serve_dashboard",
] as const;

export function createMcpServer(version: string): McpServer {
  const server = new McpServer({
    name: "machines",
    version,
  });

  server.tool("machines_status", "Return local machine fleet status paths and machine identity.", {}, async () => ({
    content: [{ type: "text", text: JSON.stringify(getStatus(), null, 2) }],
  }));

  server.tool(
    "machines_apps_list",
    "List manifest-managed apps for a machine.",
    { machine_id: z.string().optional().describe("Machine identifier") },
    async ({ machine_id }) => ({
      content: [{ type: "text", text: JSON.stringify(listApps(machine_id), null, 2) }],
    })
  );

  server.tool(
    "machines_apps_plan",
    "Preview app install steps for a machine.",
    { machine_id: z.string().optional().describe("Machine identifier") },
    async ({ machine_id }) => ({
      content: [{ type: "text", text: JSON.stringify(buildAppsPlan(machine_id), null, 2) }],
    })
  );

  server.tool(
    "machines_apps_apply",
    "Install manifest-managed apps for a machine.",
    {
      machine_id: z.string().optional().describe("Machine identifier"),
      yes: z.boolean().describe("Confirmation flag for execution"),
    },
    async ({ machine_id, yes }) => ({
      content: [{ type: "text", text: JSON.stringify(runAppsInstall(machine_id, { apply: true, yes }), null, 2) }],
    })
  );

  server.tool("machines_manifest", "Read the current fleet manifest.", {}, async () => ({
    content: [{ type: "text", text: JSON.stringify(manifestList(), null, 2) }],
  }));

  server.tool("machines_manifest_validate", "Validate the current fleet manifest.", {}, async () => ({
    content: [{ type: "text", text: JSON.stringify(manifestValidate(), null, 2) }],
  }));

  server.tool("machines_manifest_bootstrap", "Detect and upsert the current machine into the fleet manifest.", {}, async () => ({
    content: [{ type: "text", text: JSON.stringify(manifestBootstrapCurrentMachine(), null, 2) }],
  }));

  server.tool(
    "machines_manifest_get",
    "Read a single machine from the fleet manifest.",
    { machine_id: z.string().describe("Machine identifier") },
    async ({ machine_id }) => ({
      content: [{ type: "text", text: JSON.stringify(manifestGet(machine_id), null, 2) }],
    })
  );

  server.tool(
    "machines_manifest_remove",
    "Remove a single machine from the fleet manifest.",
    { machine_id: z.string().describe("Machine identifier") },
    async ({ machine_id }) => ({
      content: [{ type: "text", text: JSON.stringify(manifestRemove(machine_id), null, 2) }],
    })
  );

  server.tool("machines_agent_status", "List current machine agent heartbeats.", {}, async () => ({
    content: [{ type: "text", text: JSON.stringify(getAgentStatus(), null, 2) }],
  }));

  server.tool(
    "machines_setup_preview",
    "Preview setup actions for a machine.",
    { machine_id: z.string().optional().describe("Machine identifier") },
    async ({ machine_id }) => ({
      content: [{ type: "text", text: JSON.stringify(buildSetupPlan(machine_id), null, 2) }],
    })
  );

  server.tool(
    "machines_setup_apply",
    "Execute setup actions for a machine.",
    {
      machine_id: z.string().optional().describe("Machine identifier"),
      yes: z.boolean().describe("Confirmation flag for execution"),
    },
    async ({ machine_id, yes }) => ({
      content: [{ type: "text", text: JSON.stringify(runSetup(machine_id, { apply: true, yes }), null, 2) }],
    })
  );

  server.tool(
    "machines_sync_preview",
    "Preview sync actions for a machine.",
    { machine_id: z.string().optional().describe("Machine identifier") },
    async ({ machine_id }) => ({
      content: [{ type: "text", text: JSON.stringify(buildSyncPlan(machine_id), null, 2) }],
    })
  );

  server.tool(
    "machines_sync_apply",
    "Execute sync actions for a machine.",
    {
      machine_id: z.string().optional().describe("Machine identifier"),
      yes: z.boolean().describe("Confirmation flag for execution"),
    },
    async ({ machine_id, yes }) => ({
      content: [{ type: "text", text: JSON.stringify(runSync(machine_id, { apply: true, yes }), null, 2) }],
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
    "machines_install_claude_preview",
    "Preview Claude, Codex, and Gemini CLI install steps for a machine.",
    {
      machine_id: z.string().optional().describe("Machine identifier"),
      tools: z.array(z.enum(["claude", "codex", "gemini"])).optional().describe("AI CLIs to install"),
    },
    async ({ machine_id, tools }) => ({
      content: [{ type: "text", text: JSON.stringify(buildClaudeInstallPlan(machine_id, tools), null, 2) }],
    })
  );

  server.tool(
    "machines_install_claude_apply",
    "Execute Claude, Codex, and Gemini CLI install steps for a machine.",
    {
      machine_id: z.string().optional().describe("Machine identifier"),
      tools: z.array(z.enum(["claude", "codex", "gemini"])).optional().describe("AI CLIs to install"),
      yes: z.boolean().describe("Confirmation flag for execution"),
    },
    async ({ machine_id, tools, yes }) => ({
      content: [{ type: "text", text: JSON.stringify(runClaudeInstall(machine_id, tools, { apply: true, yes }), null, 2) }],
    })
  );

  server.tool(
    "machines_install_tailscale_preview",
    "Preview Tailscale install steps for a machine.",
    { machine_id: z.string().optional().describe("Machine identifier") },
    async ({ machine_id }) => ({
      content: [{ type: "text", text: JSON.stringify(buildTailscaleInstallPlan(machine_id), null, 2) }],
    })
  );

  server.tool(
    "machines_install_tailscale_apply",
    "Execute Tailscale install steps for a machine.",
    {
      machine_id: z.string().optional().describe("Machine identifier"),
      yes: z.boolean().describe("Confirmation flag for execution"),
    },
    async ({ machine_id, yes }) => ({
      content: [{ type: "text", text: JSON.stringify(runTailscaleInstall(machine_id, { apply: true, yes }), null, 2) }],
    })
  );

  server.tool(
    "machines_ssh_resolve",
    "Resolve the best SSH route for a machine.",
    {
      machine_id: z.string().describe("Machine identifier"),
      remote_command: z.string().optional().describe("Optional remote command"),
    },
    async ({ machine_id, remote_command }) => ({
      content: [
        {
          type: "text",
          text: JSON.stringify(
            {
              resolved: resolveSshTarget(machine_id),
              command: buildSshCommand(machine_id, remote_command),
            },
            null,
            2
          ),
        },
      ],
    })
  );

  server.tool(
    "machines_ports",
    "List listening ports on a machine.",
    {
      machine_id: z.string().optional().describe("Machine identifier"),
    },
    async ({ machine_id }) => ({
      content: [{ type: "text", text: JSON.stringify(listPorts(machine_id), null, 2) }],
    })
  );

  server.tool(
    "machines_backup_preview",
    "Preview backup steps for the current machine.",
    {
      bucket: z.string().describe("S3 bucket name"),
      prefix: z.string().optional().describe("S3 key prefix"),
    },
    async ({ bucket, prefix }) => ({
      content: [{ type: "text", text: JSON.stringify(buildBackupPlan(bucket, prefix), null, 2) }],
    })
  );

  server.tool(
    "machines_backup_apply",
    "Execute backup steps for the current machine.",
    {
      bucket: z.string().describe("S3 bucket name"),
      prefix: z.string().optional().describe("S3 key prefix"),
      yes: z.boolean().describe("Confirmation flag for execution"),
    },
    async ({ bucket, prefix, yes }) => ({
      content: [{ type: "text", text: JSON.stringify(runBackup(bucket, prefix, { apply: true, yes }), null, 2) }],
    })
  );

  server.tool(
    "machines_cert_preview",
    "Preview mkcert steps for one or more domains.",
    {
      domains: z.array(z.string()).describe("Domains to issue certificates for"),
    },
    async ({ domains }) => ({
      content: [{ type: "text", text: JSON.stringify(buildCertPlan(domains), null, 2) }],
    })
  );

  server.tool(
    "machines_cert_apply",
    "Execute mkcert steps for one or more domains.",
    {
      domains: z.array(z.string()).describe("Domains to issue certificates for"),
      yes: z.boolean().describe("Confirmation flag for execution"),
    },
    async ({ domains, yes }) => ({
      content: [{ type: "text", text: JSON.stringify(runCertPlan(domains, { apply: true, yes }), null, 2) }],
    })
  );

  server.tool(
    "machines_dns_add",
    "Add or replace a local domain mapping.",
    {
      domain: z.string().describe("Domain name"),
      port: z.number().describe("Target port"),
      target_host: z.string().optional().describe("Target host"),
    },
    async ({ domain, port, target_host }) => ({
      content: [{ type: "text", text: JSON.stringify(addDomainMapping(domain, port, target_host), null, 2) }],
    })
  );

  server.tool("machines_dns_list", "List local domain mappings.", {}, async () => ({
    content: [{ type: "text", text: JSON.stringify(listDomainMappings(), null, 2) }],
  }));

  server.tool(
    "machines_dns_render",
    "Render hosts/proxy configuration for a domain.",
    {
      domain: z.string().describe("Domain name"),
    },
    async ({ domain }) => ({
      content: [{ type: "text", text: JSON.stringify(renderDomainMapping(domain), null, 2) }],
    })
  );

  server.tool(
    "machines_notifications_add",
    "Add or replace a notification channel.",
    {
      channel_id: z.string().describe("Channel identifier"),
      type: z.enum(["email", "webhook", "command"]).describe("Notification transport"),
      target: z.string().describe("Email, webhook URL, or shell command"),
      events: z.array(z.string()).describe("Events routed to this channel"),
      enabled: z.boolean().optional().describe("Whether the channel is enabled"),
    },
    async ({ channel_id, type, target, events, enabled }) => ({
      content: [
        {
          type: "text",
          text: JSON.stringify(
            addNotificationChannel({
              id: channel_id,
              type,
              target,
              events,
              enabled: enabled ?? true,
            }),
            null,
            2
          ),
        },
      ],
    })
  );

  server.tool("machines_notifications_list", "List notification channels.", {}, async () => ({
    content: [{ type: "text", text: JSON.stringify(listNotificationChannels(), null, 2) }],
  }));

  server.tool(
    "machines_notifications_test",
    "Preview or execute a notification test.",
    {
      channel_id: z.string().describe("Channel identifier"),
      event: z.string().optional().describe("Event name"),
      message: z.string().optional().describe("Message body"),
      yes: z.boolean().optional().describe("Execute the test when true"),
    },
    async ({ channel_id, event, message, yes }) => ({
      content: [
        {
          type: "text",
          text: JSON.stringify(
            testNotificationChannel(channel_id, event, message, { apply: Boolean(yes), yes }),
            null,
            2
          ),
        },
      ],
    })
  );

  server.tool(
    "machines_notifications_remove",
    "Remove a notification channel.",
    {
      channel_id: z.string().describe("Channel identifier"),
    },
    async ({ channel_id }) => ({
      content: [{ type: "text", text: JSON.stringify(removeNotificationChannel(channel_id), null, 2) }],
    })
  );

  server.tool(
    "machines_serve_info",
    "Preview the dashboard server bind address and routes.",
    {
      host: z.string().optional().describe("Host interface"),
      port: z.number().optional().describe("Port number"),
    },
    async ({ host, port }) => ({
      content: [{ type: "text", text: JSON.stringify(getServeInfo({ host, port }), null, 2) }],
    })
  );

  server.tool("machines_serve_dashboard", "Render the current dashboard HTML.", {}, async () => ({
    content: [{ type: "text", text: renderDashboardHtml() }],
  }));

  return server;
}
