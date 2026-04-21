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
        primary: z.boolean().optional().describe("Set as primary machine"),
      },
      async (params: { name?: string; hostname?: string; ssh_address?: string; primary?: boolean }) => {
        try {
          const db = getDb();
          const name = params.name || osHostname();
          const machine = registerMachine(name, {
            hostname: params.hostname,
            ssh_address: params.ssh_address,
            primary: params.primary,
          }, db);
          return {
            content: [
              {
                type: "text" as const,
                text: `Machine registered: ${machine.name} (${machine.id.slice(0, 8)})\nHost: ${machine.hostname}\nPlatform: ${machine.platform}\nPrimary: ${machine.is_primary}\nSSH: ${machine.ssh_address ?? "(not set)"}`,
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
