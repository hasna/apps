#!/usr/bin/env bun
import { Server } from "@modelcontextprotocol/sdk/server/index.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { CallToolRequestSchema, ListToolsRequestSchema } from "@modelcontextprotocol/sdk/types.js";
import { z } from "zod";
import { createConfig, getConfig, getConfigStats, listConfigs, updateConfig } from "../db/configs.js";
import { applyConfig } from "../lib/apply.js";
import { syncFromDir, syncToDir } from "../lib/sync.js";
import { listProfiles, getProfileConfigs } from "../db/profiles.js";
import { applyConfigs } from "../lib/apply.js";
import { listSnapshots, getSnapshotByVersion } from "../db/snapshots.js";
import type { ConfigAgent, ConfigCategory, ConfigFormat, ConfigKind } from "../types/index.js";

// ── Tool descriptions (full, for describe_tools) ─────────────────────────────
const TOOL_DOCS: Record<string, string> = {
  list_configs: "List configs. Params: category?, agent?, kind?, search?. Returns array of config objects.",
  get_config: "Get a config by id or slug. Returns full config including content.",
  create_config: "Create a new config. Required: name, content, category. Optional: agent, target_path, kind, format, tags, description, is_template.",
  update_config: "Update a config by id or slug. Optional: content, name, tags, description, category, agent, target_path.",
  apply_config: "Apply a config to its target_path on disk. Params: id_or_slug, dry_run?. Returns apply result.",
  sync_directory: "Sync a directory with the DB. Params: dir, direction ('from_disk'|'to_disk'). Returns sync result.",
  list_profiles: "List all profiles. Returns array of profile objects.",
  apply_profile: "Apply all configs in a profile to disk. Params: id_or_slug, dry_run?. Returns array of apply results.",
  get_snapshot: "Get snapshot(s) for a config. Params: config_id_or_slug, version?. Returns latest snapshot or specific version.",
  get_status: "Single-call orientation. Returns: total configs, counts by category, drifted count, unredacted secrets, templates, DB path.",
  sync_known: "Sync all known config files from disk into DB. Params: agent?, category?. Replaces sync_directory for standard use.",
  search_tools: "Search tool descriptions. Params: query. Returns matching tool names and descriptions.",
  describe_tools: "Get full descriptions for tools. Params: names? (array). Returns tool docs.",
};

// ── Agent profiles — CONFIGS_PROFILE env var controls which tools are exposed ─
const PROFILES: Record<string, string[]> = {
  minimal: ["get_status", "get_config", "sync_known"],
  standard: ["list_configs", "get_config", "create_config", "update_config", "apply_config", "sync_known", "get_status", "list_profiles", "apply_profile", "search_tools", "describe_tools"],
  full: [], // empty = all tools
};

const activeProfile = process.env["CONFIGS_PROFILE"] || "full";
const profileFilter = PROFILES[activeProfile];

// ── Lean stubs (minimal schema, no descriptions) ─────────────────────────────
const ALL_LEAN_TOOLS = [
  { name: "list_configs", inputSchema: { type: "object", properties: { category: { type: "string" }, agent: { type: "string" }, kind: { type: "string" }, search: { type: "string" } } } },
  { name: "get_config", inputSchema: { type: "object", properties: { id_or_slug: { type: "string" } }, required: ["id_or_slug"] } },
  { name: "create_config", inputSchema: { type: "object", properties: { name: { type: "string" }, content: { type: "string" }, category: { type: "string" }, agent: { type: "string" }, target_path: { type: "string" }, kind: { type: "string" }, format: { type: "string" }, tags: { type: "array", items: { type: "string" } }, description: { type: "string" }, is_template: { type: "boolean" } }, required: ["name", "content", "category"] } },
  { name: "update_config", inputSchema: { type: "object", properties: { id_or_slug: { type: "string" }, content: { type: "string" }, name: { type: "string" }, tags: { type: "array", items: { type: "string" } }, description: { type: "string" }, category: { type: "string" }, agent: { type: "string" }, target_path: { type: "string" } }, required: ["id_or_slug"] } },
  { name: "apply_config", inputSchema: { type: "object", properties: { id_or_slug: { type: "string" }, dry_run: { type: "boolean" } }, required: ["id_or_slug"] } },
  { name: "sync_directory", inputSchema: { type: "object", properties: { dir: { type: "string" }, direction: { type: "string" } }, required: ["dir"] } },
  { name: "list_profiles", inputSchema: { type: "object", properties: {} } },
  { name: "apply_profile", inputSchema: { type: "object", properties: { id_or_slug: { type: "string" }, dry_run: { type: "boolean" } }, required: ["id_or_slug"] } },
  { name: "get_snapshot", inputSchema: { type: "object", properties: { config_id_or_slug: { type: "string" }, version: { type: "number" } }, required: ["config_id_or_slug"] } },
  { name: "get_status", inputSchema: { type: "object", properties: {} } },
  { name: "sync_known", inputSchema: { type: "object", properties: { agent: { type: "string" }, category: { type: "string" } } } },
  { name: "search_tools", inputSchema: { type: "object", properties: { query: { type: "string" } }, required: ["query"] } },
  { name: "describe_tools", inputSchema: { type: "object", properties: { names: { type: "array", items: { type: "string" } } } } },
];

function ok(data: unknown) {
  return { content: [{ type: "text" as const, text: JSON.stringify(data) }] };
}
function err(msg: string) {
  return { content: [{ type: "text" as const, text: JSON.stringify({ error: msg }) }], isError: true };
}

const server = new Server(
  { name: "configs", version: "0.1.0" },
  { capabilities: { tools: {} } }
);

const LEAN_TOOLS = profileFilter && profileFilter.length > 0
  ? ALL_LEAN_TOOLS.filter((t) => profileFilter.includes(t.name))
  : ALL_LEAN_TOOLS;

server.setRequestHandler(ListToolsRequestSchema, async () => ({ tools: LEAN_TOOLS }));

server.setRequestHandler(CallToolRequestSchema, async (req) => {
  const { name, arguments: args = {} } = req.params;
  try {
    switch (name) {
      case "list_configs": {
        const configs = listConfigs({
          category: (args["category"] as ConfigCategory) || undefined,
          agent: (args["agent"] as ConfigAgent) || undefined,
          kind: (args["kind"] as ConfigKind) || undefined,
          search: (args["search"] as string) || undefined,
        });
        return ok(configs.map((c) => ({ id: c.id, slug: c.slug, name: c.name, category: c.category, agent: c.agent, kind: c.kind, target_path: c.target_path, version: c.version })));
      }
      case "get_config": {
        const c = getConfig(args["id_or_slug"] as string);
        return ok(c);
      }
      case "create_config": {
        const c = createConfig({
          name: args["name"] as string,
          content: args["content"] as string,
          category: args["category"] as ConfigCategory,
          agent: (args["agent"] as ConfigAgent) || undefined,
          target_path: (args["target_path"] as string) || undefined,
          kind: (args["kind"] as ConfigKind) || undefined,
          format: (args["format"] as ConfigFormat) || undefined,
          tags: (args["tags"] as string[]) || undefined,
          description: (args["description"] as string) || undefined,
          is_template: (args["is_template"] as boolean) || undefined,
        });
        return ok({ id: c.id, slug: c.slug, name: c.name });
      }
      case "update_config": {
        const c = updateConfig(args["id_or_slug"] as string, {
          content: args["content"] as string | undefined,
          name: args["name"] as string | undefined,
          tags: args["tags"] as string[] | undefined,
          description: args["description"] as string | undefined,
          category: args["category"] as ConfigCategory | undefined,
          agent: args["agent"] as ConfigAgent | undefined,
          target_path: args["target_path"] as string | undefined,
        });
        return ok({ id: c.id, slug: c.slug, version: c.version });
      }
      case "apply_config": {
        const config = getConfig(args["id_or_slug"] as string);
        const result = await applyConfig(config, { dryRun: args["dry_run"] as boolean });
        return ok(result);
      }
      case "sync_directory": {
        const dir = args["dir"] as string;
        const direction = (args["direction"] as string) || "from_disk";
        const result = direction === "to_disk"
          ? await syncToDir(dir)
          : await syncFromDir(dir);
        return ok(result);
      }
      case "list_profiles": {
        return ok(listProfiles());
      }
      case "apply_profile": {
        const configs = getProfileConfigs(args["id_or_slug"] as string);
        const results = await applyConfigs(configs, { dryRun: args["dry_run"] as boolean });
        return ok(results);
      }
      case "get_snapshot": {
        const config = getConfig(args["config_id_or_slug"] as string);
        if (args["version"]) {
          const snap = getSnapshotByVersion(config.id, args["version"] as number);
          return snap ? ok(snap) : err("Snapshot not found");
        }
        const snaps = listSnapshots(config.id);
        return ok(snaps[0] ?? null);
      }
      case "get_status": {
        const stats = getConfigStats();
        const allConfigs = listConfigs({ kind: "file" });
        let drifted = 0, secrets = 0, templates = 0;
        for (const c of allConfigs) {
          if (c.is_template) templates++;
        }
        return ok({
          total: stats["total"] || 0,
          by_category: Object.fromEntries(Object.entries(stats).filter(([k]) => k !== "total")),
          templates,
          db_path: process.env["CONFIGS_DB_PATH"] || "~/.configs/configs.db",
        });
      }
      case "sync_known": {
        const { syncKnown } = await import("../lib/sync.js");
        const result = await syncKnown({
          agent: (args["agent"] as ConfigAgent) || undefined,
          category: (args["category"] as ConfigCategory) || undefined,
        });
        return ok(result);
      }
      case "search_tools": {
        const query = ((args["query"] as string) || "").toLowerCase();
        const matches = Object.entries(TOOL_DOCS)
          .filter(([k, v]) => k.includes(query) || v.toLowerCase().includes(query))
          .map(([name, description]) => ({ name, description }));
        return ok(matches);
      }
      case "describe_tools": {
        const names = args["names"] as string[] | undefined;
        if (names) {
          return ok(Object.fromEntries(names.map((n) => [n, TOOL_DOCS[n] ?? "Unknown tool"])));
        }
        return ok(TOOL_DOCS);
      }
      default:
        return err(`Unknown tool: ${name}`);
    }
  } catch (e) {
    return err(e instanceof Error ? e.message : String(e));
  }
});

// Handle --claude install flag
if (process.argv.includes("--claude")) {
  const proc = Bun.spawn(
    ["claude", "mcp", "add", "--transport", "stdio", "--scope", "user", "configs", "--", "configs-mcp"],
    { stdout: "inherit", stderr: "inherit" }
  );
  await proc.exited;
  process.exit(0);
}

const transport = new StdioServerTransport();
await server.connect(transport);
