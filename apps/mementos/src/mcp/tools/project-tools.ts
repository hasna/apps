import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import {
  registerProject,
  listProjects,
  getProject,
} from "../../db/projects.js";
import {
  registerMachine,
  listMachines,
  renameMachine,
  setPrimaryMachine,
} from "../../db/machines.js";
import { compactPageHint, compactText, positiveLimit } from "./memory-utils.js";

function formatError(error: unknown): string {
  if (error instanceof Error) {
    const msg = error.message;
    if (msg.includes("UNIQUE constraint failed: projects.")) {
      return `Project already registered at this path. Use list_projects to find it.`;
    }
    if (msg.includes("UNIQUE constraint failed")) {
      const table = msg.match(/UNIQUE constraint failed: (\w+)\./)?.[1] ?? "unknown";
      return `Duplicate entry in ${table}. The record already exists — use the list or get tool to find it.`;
    }
    if (msg.includes("FOREIGN KEY constraint failed")) {
      return `Referenced record not found. Check that the project_id or agent_id exists.`;
    }
    return msg;
  }
  return String(error);
}

export function registerProjectTools(server: McpServer): void {
  server.tool(
    "register_project",
    "Register a project for memory scoping",
    {
      name: z.string(),
      path: z.string(),
      description: z.string().optional(),
      memory_prefix: z.string().optional(),
    },
    async (args) => {
      try {
        const project = registerProject(args.name, args.path, args.description, args.memory_prefix);
        return {
          content: [{
            type: "text" as const,
            text: `Project registered:\nID: ${project.id}\nName: ${project.name}\nPath: ${project.path}\nCreated: ${project.created_at}`,
          }],
        };
      } catch (e) {
        return { content: [{ type: "text" as const, text: formatError(e) }], isError: true };
      }
    }
  );

  server.tool(
    "list_projects",
    "List all registered projects",
    {
      limit: z.coerce.number().optional().describe("Max projects (default: 10)"),
      offset: z.coerce.number().optional().describe("Cursor offset for the next page"),
    },
    async (args) => {
      try {
        const projects = listProjects();
        if (projects.length === 0) {
          return { content: [{ type: "text" as const, text: "No projects registered." }] };
        }
        const limit = positiveLimit(args.limit, 10);
        const offset = args.offset ?? 0;
        const page = projects.slice(offset, offset + limit + 1);
        const hasMore = page.length > limit;
        const visible = hasMore ? page.slice(0, limit) : page;
        const lines = visible.map((p) => `${p.id.slice(0, 8)} | ${p.name} | ${compactText(p.path, 96)}`);
        const hint = compactPageHint({
          shown: visible.length,
          limit,
          offset,
          hasMore,
          moreCall: "list_projects",
          detailHint: "use get_project(id) for details",
        });
        return { content: [{ type: "text" as const, text: `${visible.length}${hasMore ? "+" : ""} project(s):\n${lines.join("\n")}${hint}` }] };
      } catch (e) {
        return { content: [{ type: "text" as const, text: formatError(e) }], isError: true };
      }
    }
  );

  server.tool(
    "get_project",
    "Get a project by ID, path, or name.",
    {
      id: z.string(),
    },
    async (args) => {
      try {
        const project = getProject(args.id);
        if (!project) {
          return { content: [{ type: "text" as const, text: `Project not found: ${args.id}` }] };
        }
        return {
          content: [{
            type: "text" as const,
            text: `Project:\nID: ${project.id}\nName: ${project.name}\nPath: ${project.path}\nDescription: ${project.description || "-"}\nCreated: ${project.created_at}`,
          }],
        };
      } catch (e) {
        return { content: [{ type: "text" as const, text: formatError(e) }], isError: true };
      }
    }
  );

  // ── Machine registry ──────────────────────────────────────────────────────────

  server.tool(
    "register_machine",
    "Register this machine in the shared registry. The normalized hostname is the account-local idempotency key; the returned machine ID is the stable identity used by mutations and memory attribution.",
    { name: z.string().max(128).optional().describe("Human-readable display name. Defaults to the normalized hostname; repeat registration never renames an existing machine.") },
    async (args) => {
      try {
        const machine = registerMachine(args.name);
        return { content: [{ type: "text" as const, text: `Machine: ${machine.name} | ${machine.id} | hostname:${machine.hostname} | platform:${machine.platform}` }] };
      } catch (e) {
        return { content: [{ type: "text" as const, text: formatError(e) }], isError: true };
      }
    }
  );

  server.tool(
    "list_machines",
    "List registered machines. Machine IDs are stable identities; hostnames are registration idempotency keys, not authorization boundaries.",
    {
      limit: z.coerce.number().int().min(1).max(100).optional().describe("Max machines (default: 10, maximum: 100)"),
      offset: z.coerce.number().int().min(0).optional().describe("Cursor offset for the next page"),
      full: z.boolean().optional().describe("Return complete machine JSON objects for the bounded page. Defaults to compact lines."),
    },
    async (args) => {
      try {
        const machines = listMachines();
        const limit = positiveLimit(args.limit, 10);
        const offset = args.offset ?? 0;
        const page = machines.slice(offset, offset + limit + 1);
        const hasMore = page.length > limit;
        const visible = hasMore ? page.slice(0, limit) : page;
        if (args.full) {
          return { content: [{ type: "text" as const, text: JSON.stringify({
            machines: visible,
            count: visible.length,
            offset,
            limit,
            has_more: hasMore,
            next_offset: hasMore ? offset + visible.length : null,
          }) }] };
        }
        if (visible.length === 0) {
          return { content: [{ type: "text" as const, text: "No machines registered." }] };
        }
        const lines = visible.map((m) =>
          `${m.id} | ${m.name} | ${m.hostname} | ${m.platform}${m.is_primary ? " | primary" : ""} | last_seen=${m.last_seen_at}`
        );
        const hint = compactPageHint({
          shown: visible.length,
          limit,
          offset,
          hasMore,
          moreCall: "list_machines",
          detailHint: "use full=true for complete machine objects",
        });
        return { content: [{ type: "text" as const, text: `${visible.length}${hasMore ? "+" : ""} machine(s):\n${lines.join("\n")}${hint}` }] };
      } catch (e) {
        return { content: [{ type: "text" as const, text: formatError(e) }], isError: true };
      }
    }
  );

  server.tool(
    "rename_machine",
    "Rename a machine by its exact stable machine ID.",
    { id: z.string().min(1).describe("Exact stable machine ID returned by register_machine or list_machines"), new_name: z.string().min(1).max(128) },
    async (args) => {
      try {
        const updated = renameMachine(args.id, args.new_name);
        return { content: [{ type: "text" as const, text: `Renamed machine ${updated.id}: ${updated.name}` }] };
      } catch (e) {
        return { content: [{ type: "text" as const, text: formatError(e) }], isError: true };
      }
    }
  );

  server.tool(
    "set_primary_machine",
    "Mark the exact stable machine ID as primary. The database enforces at most one primary machine.",
    { id: z.string().min(1).describe("Exact stable machine ID") },
    async (args) => {
      try {
        const updated = setPrimaryMachine(args.id);
        return {
          content: [{
            type: "text" as const,
            text: `Primary machine: ${updated.name} | ${updated.id} | hostname:${updated.hostname}`,
          }],
        };
      } catch (e) {
        return { content: [{ type: "text" as const, text: formatError(e) }], isError: true };
      }
    }
  );
}
