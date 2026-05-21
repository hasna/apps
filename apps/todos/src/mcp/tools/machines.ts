import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import {
  registerMachine,
  listMachines,
  getMachineByName,
  setPrimaryMachine,
  archiveMachine,
  unarchiveMachine,
  deleteMachine,
  updateMachineHeartbeat,
  getMachineTopologyDiagnostics,
} from "../../db/machines.js";
import { getDatabase } from "../../db/database.js";
import { hostname as osHostname } from "node:os";

function getDb() {
  return getDatabase();
}

interface ToolContext {
  shouldRegisterTool: (name: string) => boolean;
  formatError: (error: unknown) => string;
}

export function registerMachineTools(server: McpServer, ctx: ToolContext) {
  // === machines_register ===
  if (ctx.shouldRegisterTool("machines_register")) {
    server.tool(
      "machines_register",
      "Register a machine in the todos machine registry",
      {
        name: z.string().optional().describe("Machine name (defaults to hostname if omitted)"),
        hostname: z.string().optional().describe("OS hostname"),
        ssh_address: z.string().optional().describe("SSH address for cross-machine access (e.g. user@host)"),
        tailscale_name: z.string().optional().describe("User-provided Tailscale/MagicDNS name"),
        tailscale_ip: z.string().optional().describe("User-provided Tailscale IP"),
        lan_address: z.string().optional().describe("User-provided LAN address"),
        workspace_path: z.string().optional().describe("Local workspace path"),
        git_root: z.string().optional().describe("Local git root"),
        arch: z.string().optional().describe("Machine architecture"),
        primary: z.boolean().optional().describe("Set as primary machine"),
      },
      async (params: {
        name?: string;
        hostname?: string;
        ssh_address?: string;
        tailscale_name?: string;
        tailscale_ip?: string;
        lan_address?: string;
        workspace_path?: string;
        git_root?: string;
        arch?: string;
        primary?: boolean;
      }) => {
        try {
          const db = getDb();
          const name = params.name || osHostname();
          const machine = registerMachine(name, {
            hostname: params.hostname,
            ssh_address: params.ssh_address,
            tailscale_name: params.tailscale_name,
            tailscale_ip: params.tailscale_ip,
            lan_address: params.lan_address,
            workspace_path: params.workspace_path,
            git_root: params.git_root,
            arch: params.arch,
            primary: params.primary,
          }, db);
          return {
            content: [
              {
                type: "text" as const,
                text: `Machine registered: ${machine.name} (${machine.id.slice(0, 8)})\nHost: ${machine.hostname}\nPlatform: ${machine.platform}\nPrimary: ${machine.is_primary}\nSSH: ${machine.ssh_address ?? "(not set)"}\nTailscale: ${machine.metadata["tailscale_ip"] ?? machine.metadata["tailscale_name"] ?? "(not set)"}\nLAN: ${machine.metadata["lan_address"] ?? "(not set)"}`,
              },
            ],
          };
        } catch (error) {
          return { content: [{ type: "text" as const, text: ctx.formatError(error) }] };
        }
      },
    );
  }

  // === machines_list ===
  if (ctx.shouldRegisterTool("machines_list")) {
    server.tool(
      "machines_list",
      "List all registered machines",
      {
        include_archived: z.boolean().optional().describe("Include archived machines"),
      },
      async (params: { include_archived?: boolean }) => {
        try {
          const db = getDb();
          const machines = listMachines(db, params.include_archived);
          if (machines.length === 0) {
            return {
              content: [{ type: "text" as const, text: "No machines registered. Use machines_register to add one." }],
            };
          }
          const lines = machines.map((m) => {
            const primaryTag = m.is_primary ? " [PRIMARY]" : "";
            const archivedTag = m.archived_at ? " [ARCHIVED]" : "";
            return `${m.name} (${m.id.slice(0, 8)}) | ${m.hostname ?? "unknown"} | ${m.platform ?? "unknown"} | last: ${m.last_seen_at}${primaryTag}${archivedTag}`;
          });
          return { content: [{ type: "text" as const, text: `Machines:\n${lines.join("\n")}` }] };
        } catch (error) {
          return { content: [{ type: "text" as const, text: ctx.formatError(error) }] };
        }
      },
    );
  }

  // === machines_heartbeat ===
  if (ctx.shouldRegisterTool("machines_heartbeat")) {
    server.tool(
      "machines_heartbeat",
      "Update local last-seen and topology metadata for a machine",
      {
        name: z.string().optional().describe("Machine name or ID; defaults to local machine name"),
        hostname: z.string().optional().describe("OS hostname"),
        ssh_address: z.string().optional().describe("SSH address for cross-machine access"),
        tailscale_name: z.string().optional().describe("User-provided Tailscale/MagicDNS name"),
        tailscale_ip: z.string().optional().describe("User-provided Tailscale IP"),
        lan_address: z.string().optional().describe("User-provided LAN address"),
        workspace_path: z.string().optional().describe("Local workspace path"),
        git_root: z.string().optional().describe("Local git root"),
        arch: z.string().optional().describe("Machine architecture"),
      },
      async (params: {
        name?: string;
        hostname?: string;
        ssh_address?: string;
        tailscale_name?: string;
        tailscale_ip?: string;
        lan_address?: string;
        workspace_path?: string;
        git_root?: string;
        arch?: string;
      }) => {
        try {
          const machine = updateMachineHeartbeat(params.name, {
            hostname: params.hostname,
            ssh_address: params.ssh_address,
            tailscale_name: params.tailscale_name,
            tailscale_ip: params.tailscale_ip,
            lan_address: params.lan_address,
            workspace_path: params.workspace_path,
            git_root: params.git_root,
            arch: params.arch,
          }, getDb());
          return { content: [{ type: "text" as const, text: `Heartbeat recorded for ${machine.name} (${machine.id.slice(0, 8)}) at ${machine.last_seen_at}` }] };
        } catch (error) {
          return { content: [{ type: "text" as const, text: ctx.formatError(error) }] };
        }
      },
    );
  }

  // === machines_topology ===
  if (ctx.shouldRegisterTool("machines_topology")) {
    server.tool(
      "machines_topology",
      "Show local machine topology diagnostics without network probing",
      {
        stale_minutes: z.number().optional().describe("Minutes before a machine is considered stale"),
        include_archived: z.boolean().optional().describe("Include archived machines"),
      },
      async (params: { stale_minutes?: number; include_archived?: boolean }) => {
        try {
          const diagnostics = getMachineTopologyDiagnostics({
            stale_minutes: params.stale_minutes,
            include_archived: params.include_archived,
          }, getDb());
          const machineLines = diagnostics.machines.map((machine) => {
            const topology = machine.topology;
            const addresses = [
              topology.tailscale_ip ? `tailscale=${topology.tailscale_ip}` : null,
              topology.lan_address ? `lan=${topology.lan_address}` : null,
              topology.workspace_path ? `workspace=${topology.workspace_path}` : null,
            ].filter(Boolean).join(" ");
            return `${machine.name} ${machine.stale ? `stale:${machine.stale_minutes}m` : "fresh"} ${addresses}`.trim();
          });
          const issues = diagnostics.path_issues.map((issue) => `${issue.type}: ${issue.message}`);
          return {
            content: [{
              type: "text" as const,
              text: `Machines:\n${machineLines.join("\n") || "(none)"}${issues.length ? `\n\nPath diagnostics:\n${issues.join("\n")}` : ""}`,
            }],
          };
        } catch (error) {
          return { content: [{ type: "text" as const, text: ctx.formatError(error) }] };
        }
      },
    );
  }

  // === machines_set_primary ===
  if (ctx.shouldRegisterTool("machines_set_primary")) {
    server.tool(
      "machines_set_primary",
      "Set the primary machine",
      {
        name: z.string().describe("Machine name to set as primary"),
      },
      async (params: { name: string }) => {
        try {
          const db = getDb();
          const machine = setPrimaryMachine(params.name, db);
          return {
            content: [
              { type: "text" as const, text: `Primary machine set to: ${machine.name} (${machine.id.slice(0, 8)})` },
            ],
          };
        } catch (error) {
          return { content: [{ type: "text" as const, text: ctx.formatError(error) }] };
        }
      },
    );
  }

  // === machines_archive ===
  if (ctx.shouldRegisterTool("machines_archive")) {
    server.tool(
      "machines_archive",
      "Archive (soft-delete) a machine. Cannot archive primary or machines with active tasks.",
      {
        name: z.string().describe("Machine name to archive"),
      },
      async (params: { name: string }) => {
        try {
          const db = getDb();
          const machine = getMachineByName(params.name, db);
          if (!machine) {
            return { content: [{ type: "text" as const, text: `Machine '${params.name}' not found` }] };
          }
          archiveMachine(machine.id, db);
          return { content: [{ type: "text" as const, text: `Machine '${params.name}' archived` }] };
        } catch (error) {
          return { content: [{ type: "text" as const, text: ctx.formatError(error) }] };
        }
      },
    );
  }

  // === machines_unarchive ===
  if (ctx.shouldRegisterTool("machines_unarchive")) {
    server.tool(
      "machines_unarchive",
      "Unarchive a machine",
      {
        name: z.string().describe("Machine name to unarchive"),
      },
      async (params: { name: string }) => {
        try {
          const db = getDb();
          const machine = getMachineByName(params.name, db);
          if (!machine) {
            return { content: [{ type: "text" as const, text: `Machine '${params.name}' not found` }] };
          }
          const result = unarchiveMachine(machine.id, db);
          return {
            content: [
              { type: "text" as const, text: `Machine '${params.name}' unarchived${result ? ` (${result.id.slice(0, 8)})` : ""}` },
            ],
          };
        } catch (error) {
          return { content: [{ type: "text" as const, text: ctx.formatError(error) }] };
        }
      },
    );
  }

  // === machines_delete ===
  if (ctx.shouldRegisterTool("machines_delete")) {
    server.tool(
      "machines_delete",
      "Hard-delete a machine. Cannot delete primary or machines with active tasks.",
      {
        name: z.string().describe("Machine name to delete"),
      },
      async (params: { name: string }) => {
        try {
          const db = getDb();
          const machine = getMachineByName(params.name, db);
          if (!machine) {
            return { content: [{ type: "text" as const, text: `Machine '${params.name}' not found` }] };
          }
          const result = deleteMachine(machine.id, db);
          return {
            content: [
              { type: "text" as const, text: result ? `Machine '${params.name}' deleted` : `Failed to delete machine '${params.name}'` },
            ],
          };
        } catch (error) {
          return { content: [{ type: "text" as const, text: ctx.formatError(error) }] };
        }
      },
    );
  }
}
