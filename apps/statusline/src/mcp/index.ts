#!/usr/bin/env bun
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { resolve } from "node:path";
import { z } from "zod";
import {
  configPath,
  defaultConfig,
  disableSegments,
  enableSegments,
  listSegments,
  loadConfig,
  orderSegments,
  previewStatusline,
  renderStatusline,
  saveConfig,
  setSeparator,
  statuslineVersion,
  type StatuslineConfig,
} from "../index.js";

type ToolContent = { type: "text"; text: string };
type ToolResult = { content: ToolContent[]; isError?: boolean };

const configPathSchema = z
  .string()
  .min(1)
  .optional()
  .describe("Path to statusline config JSON. Defaults to STATUSLINE_CONFIG or ~/.config/statusline/config.json.");

const configSchema = z
  .object({
    separator: z.string().min(1).optional(),
    segments: z.array(z.string().min(1)).optional(),
  })
  .optional();

function jsonResult(value: unknown): ToolResult {
  return { content: [{ type: "text", text: JSON.stringify(value, null, 2) }] };
}

async function safeTool(fn: () => Promise<unknown> | unknown): Promise<ToolResult> {
  try {
    return jsonResult(await fn());
  } catch (error) {
    return {
      ...jsonResult({
        ok: false,
        error: { message: error instanceof Error ? error.message : String(error) },
      }),
      isError: true,
    };
  }
}

function pathFor(path: string | undefined): string {
  return configPath(path);
}

function defaultWritablePath(): string {
  return configPath();
}

function loadConfigFor(path: string | undefined): { path: string; config: StatuslineConfig } {
  const resolvedPath = pathFor(path);
  return { path: resolvedPath, config: loadConfig(resolvedPath) };
}

function assertWritableConfigPath(path: string): void {
  if (resolve(path) !== resolve(defaultWritablePath())) {
    throw new Error("config writes are restricted to the server's configured statusline config path.");
  }
}

function requireWrite(input: { dry_run?: boolean; confirm_write?: boolean }): void {
  if (!input.dry_run && !input.confirm_write) {
    throw new Error("config mutation requires confirm_write=true unless dry_run=true.");
  }
}

function maybeWrite(path: string, config: StatuslineConfig, input: { dry_run?: boolean }): void {
  assertWritableConfigPath(path);
  if (!input.dry_run) saveConfig(config, path);
}

export function buildServer(): McpServer {
  const server = new McpServer({
    name: "statusline",
    version: statuslineVersion,
  });

  server.tool("statusline_health", "Return statusline MCP server health.", {}, async () =>
    safeTool(() => ({
      ok: true,
      name: "statusline-mcp",
      version: statuslineVersion,
      defaultConfigPath: configPath(),
    })),
  );

  server.tool(
    "render_statusline",
    "Render a statusline from an agent JSON payload without changing config.",
    {
      input: z.record(z.unknown()).optional(),
      config_path: configPathSchema,
      config: configSchema.describe("Optional in-memory config override for this render only."),
    },
    async ({ input, config_path, config }) =>
      safeTool(async () => {
        const loaded = loadConfigFor(config_path);
        const effectiveConfig = { ...loaded.config, ...(config ?? {}) };
        return {
          line: await renderStatusline(input ?? {}, effectiveConfig),
          configPath: loaded.path,
        };
      }),
  );

  server.tool(
    "preview_statusline",
    "Render the built-in preview payload from an optional cwd.",
    {
      config_path: configPathSchema,
      cwd: z.string().min(1).optional(),
    },
    async ({ config_path, cwd }) =>
      safeTool(async () => {
        const loaded = loadConfigFor(config_path);
        return {
          line: await previewStatusline(loaded.config, cwd ?? process.cwd()),
          configPath: loaded.path,
        };
      }),
  );

  server.tool(
    "list_segments",
    "List all segment definitions with enabled state for the selected config.",
    { config_path: configPathSchema },
    async ({ config_path }) =>
      safeTool(() => {
        const loaded = loadConfigFor(config_path);
        return { configPath: loaded.path, segments: listSegments(loaded.config) };
      }),
  );

  server.tool(
    "get_config",
    "Read the current statusline config.",
    { config_path: configPathSchema },
    async ({ config_path }) =>
      safeTool(() => {
        const loaded = loadConfigFor(config_path);
        return { configPath: loaded.path, config: loaded.config };
      }),
  );

  server.tool(
    "update_config",
    "Update separator and/or the full enabled segment list.",
    {
      config_path: configPathSchema,
      separator: z.string().min(1).optional(),
      segments: z.array(z.string().min(1)).optional(),
      dry_run: z.boolean().default(false),
      confirm_write: z.boolean().default(false),
    },
    async (input) =>
      safeTool(() => {
        requireWrite(input);
        const loaded = loadConfigFor(input.config_path);
        let next = loaded.config;
        if (input.separator !== undefined) next = setSeparator(input.separator, next).config;
        if (input.segments !== undefined) next = orderSegments(input.segments, next).config;
        maybeWrite(loaded.path, next, input);
        return { configPath: loaded.path, dryRun: input.dry_run, config: next };
      }),
  );

  server.tool(
    "enable_segments",
    "Enable segment ids, appending them to the current order.",
    {
      config_path: configPathSchema,
      ids: z.array(z.string().min(1)).min(1),
      dry_run: z.boolean().default(false),
      confirm_write: z.boolean().default(false),
    },
    async (input) =>
      safeTool(() => {
        requireWrite(input);
        const loaded = loadConfigFor(input.config_path);
        const result = enableSegments(input.ids, loaded.config);
        maybeWrite(loaded.path, result.config, input);
        return { configPath: loaded.path, dryRun: input.dry_run, changed: result.changed, config: result.config };
      }),
  );

  server.tool(
    "disable_segments",
    "Disable segment ids from the current order.",
    {
      config_path: configPathSchema,
      ids: z.array(z.string().min(1)).min(1),
      dry_run: z.boolean().default(false),
      confirm_write: z.boolean().default(false),
    },
    async (input) =>
      safeTool(() => {
        requireWrite(input);
        const loaded = loadConfigFor(input.config_path);
        const result = disableSegments(input.ids, loaded.config);
        maybeWrite(loaded.path, result.config, input);
        return { configPath: loaded.path, dryRun: input.dry_run, changed: result.changed, config: result.config };
      }),
  );

  server.tool(
    "order_segments",
    "Replace enabled segment order with the exact ids provided.",
    {
      config_path: configPathSchema,
      ids: z.array(z.string().min(1)).min(1),
      dry_run: z.boolean().default(false),
      confirm_write: z.boolean().default(false),
    },
    async (input) =>
      safeTool(() => {
        requireWrite(input);
        const loaded = loadConfigFor(input.config_path);
        const result = orderSegments(input.ids, loaded.config);
        maybeWrite(loaded.path, result.config, input);
        return { configPath: loaded.path, dryRun: input.dry_run, changed: result.changed, config: result.config };
      }),
  );

  server.tool(
    "reset_config",
    "Reset config to defaults.",
    {
      config_path: configPathSchema,
      dry_run: z.boolean().default(false),
      confirm_write: z.boolean().default(false),
    },
    async (input) =>
      safeTool(() => {
        requireWrite(input);
        const path = pathFor(input.config_path);
        const config = defaultConfig();
        maybeWrite(path, config, input);
        return { configPath: path, dryRun: input.dry_run, config };
      }),
  );

  return server;
}

export async function startMcpServer(): Promise<void> {
  const server = buildServer();
  const transport = new StdioServerTransport();
  await server.connect(transport);
  console.error("statusline MCP server running on stdio");
}

if (import.meta.main) {
  await startMcpServer();
}
