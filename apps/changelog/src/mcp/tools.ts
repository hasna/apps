import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import type { CallToolResult } from "@modelcontextprotocol/sdk/types.js";
import { z } from "zod";
import { generateChangelogMarkdown } from "../markdown.js";
import { publishChangelog } from "../publisher.js";
import { LocalChangelogStore } from "../storage.js";
import type { ChangelogEntryInput, ChangelogEntryUpdate, ChangelogStore } from "../types.js";
import { parseChangelogKind, validationErrorMessage } from "../validation.js";

export interface ChangelogMcpToolDefinition {
  name: string;
  description: string;
  paramsSchema: Record<string, z.ZodTypeAny>;
  inputSchema: Record<string, unknown>;
  run: (input: Record<string, unknown>) => CallToolResult | Promise<CallToolResult>;
}

function textContent(text: string): CallToolResult {
  return { content: [{ type: "text", text }] };
}

function jsonContent(value: unknown): CallToolResult {
  return textContent(JSON.stringify(value, null, 2));
}

function errorContent(error: unknown): CallToolResult {
  return { ...textContent(validationErrorMessage(error)), isError: true };
}

function readInput(input: Record<string, unknown>): ChangelogEntryInput {
  return {
    appId: String(input.app_id ?? input.appId ?? input.app ?? ""),
    version: typeof input.version === "string" ? input.version : undefined,
    kind: input.kind as ChangelogEntryInput["kind"],
    category: input.category as ChangelogEntryInput["category"],
    title: String(input.title ?? input.message ?? ""),
    message: typeof input.message === "string" ? input.message : undefined,
    details: typeof input.details === "string" ? input.details : typeof input.body === "string" ? input.body : undefined,
    body: typeof input.body === "string" ? input.body : undefined,
    date: typeof input.date === "string" ? input.date : undefined,
    author: typeof input.author === "string" ? input.author : undefined,
    tags: Array.isArray(input.tags) ? input.tags.map(String) : undefined,
    links: Array.isArray(input.links) ? input.links.map((link) => {
      if (typeof link === "string") return { url: link };
      if (link && typeof link === "object" && !Array.isArray(link)) {
        const record = link as Record<string, unknown>;
        return {
          label: typeof record.label === "string" ? record.label : undefined,
          url: String(record.url ?? ""),
        };
      }
      return { url: String(link) };
    }) : undefined,
    commits: Array.isArray(input.commits) ? input.commits.map(String) : undefined,
    tasks: Array.isArray(input.tasks) ? input.tasks.map(String) : undefined,
    metadata: input.metadata && typeof input.metadata === "object" && !Array.isArray(input.metadata)
      ? input.metadata as ChangelogEntryInput["metadata"]
      : undefined,
  };
}

function readUpdate(input: Record<string, unknown>): ChangelogEntryUpdate {
  return {
    appId: typeof input.app_id === "string" ? input.app_id : typeof input.appId === "string" ? input.appId : undefined,
    version: typeof input.version === "string" ? input.version : undefined,
    kind: input.kind as ChangelogEntryUpdate["kind"],
    category: input.category as ChangelogEntryUpdate["category"],
    title: typeof input.title === "string" ? input.title : undefined,
    message: typeof input.message === "string" ? input.message : undefined,
    details: typeof input.details === "string" ? input.details : typeof input.body === "string" ? input.body : undefined,
    body: typeof input.body === "string" ? input.body : undefined,
    date: typeof input.date === "string" ? input.date : undefined,
    author: typeof input.author === "string" ? input.author : undefined,
    tags: Array.isArray(input.tags) ? input.tags.map(String) : undefined,
    links: Array.isArray(input.links) ? input.links.map((link) => {
      if (typeof link === "string") return { url: link };
      if (link && typeof link === "object" && !Array.isArray(link)) {
        const record = link as Record<string, unknown>;
        return {
          label: typeof record.label === "string" ? record.label : undefined,
          url: String(record.url ?? ""),
        };
      }
      return { url: String(link) };
    }) : undefined,
    commits: Array.isArray(input.commits) ? input.commits.map(String) : undefined,
    tasks: Array.isArray(input.tasks) ? input.tasks.map(String) : undefined,
    metadata: input.metadata && typeof input.metadata === "object" && !Array.isArray(input.metadata)
      ? input.metadata as ChangelogEntryUpdate["metadata"]
      : undefined,
  };
}

export function buildChangelogMcpTools(store: ChangelogStore = new LocalChangelogStore()): ChangelogMcpToolDefinition[] {
  const tools: Omit<ChangelogMcpToolDefinition, "inputSchema">[] = [
    {
      name: "add_changelog_entry",
      description: "Add a changelog entry for an application.",
      paramsSchema: {
        app_id: z.string().describe("Stable application id or slug"),
        version: z.string().optional().describe("Application version, or Unreleased"),
        kind: z.enum(["added", "changed", "deprecated", "removed", "fixed", "security", "other"]).optional(),
        title: z.string().describe("Human-readable changelog title"),
        message: z.string().optional(),
        details: z.string().optional(),
        date: z.string().optional().describe("Entry date as YYYY-MM-DD"),
        author: z.string().optional(),
        tags: z.array(z.string()).optional(),
        links: z.array(z.union([z.string(), z.object({ label: z.string().optional(), url: z.string() })])).optional(),
        commits: z.array(z.string()).optional(),
        tasks: z.array(z.string()).optional(),
        metadata: z.record(z.unknown()).optional(),
      },
      run: async (input) => {
        try {
          return jsonContent(await store.createEntry(readInput(input), { source: "mcp" }));
        } catch (error) {
          return errorContent(error);
        }
      },
    },
    {
      name: "list_changelog_entries",
      description: "List collected changelog entries.",
      paramsSchema: {
        app_id: z.string().optional(),
        version: z.string().optional(),
        kind: z.enum(["added", "changed", "deprecated", "removed", "fixed", "security", "other"]).optional(),
        tag: z.string().optional(),
        limit: z.number().int().min(1).max(500).optional(),
      },
      run: async (input) => jsonContent(await store.listEntries({
        appId: typeof input.app_id === "string" ? input.app_id : undefined,
        version: typeof input.version === "string" ? input.version : undefined,
        kind: typeof input.kind === "string" ? parseChangelogKind(input.kind) : undefined,
        tag: typeof input.tag === "string" ? input.tag : undefined,
        limit: typeof input.limit === "number" ? input.limit : undefined,
      })),
    },
    {
      name: "get_changelog_entry",
      description: "Get one changelog entry by id.",
      paramsSchema: {
        id: z.string(),
      },
      run: async (input) => {
        const item = await store.getEntry(String(input.id));
        return item ? jsonContent(item) : { ...textContent(`Changelog entry not found: ${String(input.id)}`), isError: true };
      },
    },
    {
      name: "update_changelog_entry",
      description: "Update one changelog entry by id.",
      paramsSchema: {
        id: z.string(),
        app_id: z.string().optional(),
        version: z.string().optional(),
        kind: z.enum(["added", "changed", "deprecated", "removed", "fixed", "security", "other"]).optional(),
        title: z.string().optional(),
        message: z.string().optional(),
        details: z.string().optional(),
        date: z.string().optional(),
        author: z.string().optional(),
        tags: z.array(z.string()).optional(),
        links: z.array(z.union([z.string(), z.object({ label: z.string().optional(), url: z.string() })])).optional(),
        commits: z.array(z.string()).optional(),
        tasks: z.array(z.string()).optional(),
        metadata: z.record(z.unknown()).optional(),
      },
      run: async (input) => {
        try {
          const item = await store.updateEntry(String(input.id), readUpdate(input));
          return item ? jsonContent(item) : { ...textContent(`Changelog entry not found: ${String(input.id)}`), isError: true };
        } catch (error) {
          return errorContent(error);
        }
      },
    },
    {
      name: "generate_changelog",
      description: "Generate Keep a Changelog style Markdown.",
      paramsSchema: {
        app_id: z.string().optional(),
        version: z.string().optional(),
        kind: z.enum(["added", "changed", "deprecated", "removed", "fixed", "security", "other"]).optional(),
        tag: z.string().optional(),
        limit: z.number().int().min(1).max(500).optional(),
        title: z.string().optional(),
      },
      run: async (input) => {
        const appId = typeof input.app_id === "string" ? input.app_id : undefined;
        const version = typeof input.version === "string" ? input.version : undefined;
        const kind = typeof input.kind === "string" ? parseChangelogKind(input.kind) : undefined;
        const tag = typeof input.tag === "string" ? input.tag : undefined;
        const limit = typeof input.limit === "number" ? input.limit : undefined;
        const title = typeof input.title === "string" ? input.title : undefined;
        return textContent(generateChangelogMarkdown(await store.listEntries({ appId, version, kind, tag, limit: limit ?? 500 }), { appId, version, kind, tag, limit, title }));
      },
    },
    {
      name: "publish_changelog",
      description: "Preview or explicitly write a generated CHANGELOG.md.",
      paramsSchema: {
        app_id: z.string().optional(),
        version: z.string().optional(),
        kind: z.enum(["added", "changed", "deprecated", "removed", "fixed", "security", "other"]).optional(),
        tag: z.string().optional(),
        limit: z.number().int().min(1).max(500).optional(),
        title: z.string().optional(),
        target_path: z.string().optional(),
        write: z.boolean().optional().describe("Must be true to write; omitted or false is a dry run"),
      },
      run: async (input) => jsonContent(await publishChangelog({
        store,
        appId: typeof input.app_id === "string" ? input.app_id : undefined,
        version: typeof input.version === "string" ? input.version : undefined,
        kind: typeof input.kind === "string" ? parseChangelogKind(input.kind) : undefined,
        tag: typeof input.tag === "string" ? input.tag : undefined,
        limit: typeof input.limit === "number" ? input.limit : undefined,
        title: typeof input.title === "string" ? input.title : undefined,
        targetPath: typeof input.target_path === "string" ? input.target_path : undefined,
        write: input.write === true,
      })),
    },
    {
      name: "changelog_stats",
      description: "Return aggregate changelog counts.",
      paramsSchema: {},
      run: async () => jsonContent(await store.stats()),
    },
    {
      name: "export_changelog_jsonl",
      description: "Export changelog entries as JSONL.",
      paramsSchema: {
        app_id: z.string().optional(),
        version: z.string().optional(),
        kind: z.enum(["added", "changed", "deprecated", "removed", "fixed", "security", "other"]).optional(),
        tag: z.string().optional(),
        limit: z.number().int().min(1).max(500).optional(),
      },
      run: async (input) => textContent(await store.exportJsonl({
        appId: typeof input.app_id === "string" ? input.app_id : undefined,
        version: typeof input.version === "string" ? input.version : undefined,
        kind: typeof input.kind === "string" ? parseChangelogKind(input.kind) : undefined,
        tag: typeof input.tag === "string" ? input.tag : undefined,
        limit: typeof input.limit === "number" ? input.limit : undefined,
      })),
    },
  ];

  return tools.map((tool) => ({
    ...tool,
    inputSchema: zodRawShapeToJsonSchema(tool.paramsSchema),
  }));
}

export function registerChangelogMcpTools(server: McpServer, store?: ChangelogStore): ChangelogMcpToolDefinition[] {
  const tools = buildChangelogMcpTools(store);
  for (const tool of tools) {
    server.tool(tool.name, tool.description, tool.paramsSchema, async (input) => tool.run(readRecord(input)));
  }
  return tools;
}

function readRecord(input: unknown): Record<string, unknown> {
  return input && typeof input === "object" && !Array.isArray(input) ? input as Record<string, unknown> : {};
}

function isOptionalSchema(schema: z.ZodTypeAny): boolean {
  const def = (schema as z.ZodTypeAny & { _def?: { typeName?: unknown; innerType?: z.ZodTypeAny } })._def;
  if (String(def?.typeName ?? "") === z.ZodFirstPartyTypeKind.ZodOptional) return true;
  if (String(def?.typeName ?? "") === z.ZodFirstPartyTypeKind.ZodDefault) return true;
  return false;
}

function zodRawShapeToJsonSchema(shape: Record<string, z.ZodTypeAny>): Record<string, unknown> {
  const properties: Record<string, unknown> = {};
  const required: string[] = [];
  for (const [key, schema] of Object.entries(shape)) {
    properties[key] = zodSchemaToJsonSchema(schema);
    if (!isOptionalSchema(schema)) required.push(key);
  }
  return {
    type: "object",
    properties,
    ...(required.length > 0 ? { required } : {}),
    additionalProperties: false,
  };
}

function zodSchemaToJsonSchema(schema: z.ZodTypeAny): Record<string, unknown> | boolean {
  const def = (schema as z.ZodTypeAny & { _def?: Record<string, unknown> })._def;
  const typeName = String(def?.typeName ?? "");
  const description = schema.description ? { description: schema.description } : {};

  if (typeName === z.ZodFirstPartyTypeKind.ZodOptional || typeName === z.ZodFirstPartyTypeKind.ZodDefault) {
    return { ...asJsonSchemaObject(zodSchemaToJsonSchema(def?.innerType as z.ZodTypeAny)), ...description };
  }
  if (typeName === z.ZodFirstPartyTypeKind.ZodString) return { type: "string", ...description };
  if (typeName === z.ZodFirstPartyTypeKind.ZodBoolean) return { type: "boolean", ...description };
  if (typeName === z.ZodFirstPartyTypeKind.ZodNumber) return { type: "number", ...description };
  if (typeName === z.ZodFirstPartyTypeKind.ZodEnum) return { type: "string", enum: def?.values, ...description };
  if (typeName === z.ZodFirstPartyTypeKind.ZodArray) return { type: "array", items: zodSchemaToJsonSchema(def?.type as z.ZodTypeAny), ...description };
  if (typeName === z.ZodFirstPartyTypeKind.ZodObject) return { type: "object", additionalProperties: true, ...description };
  if (typeName === z.ZodFirstPartyTypeKind.ZodRecord) return { type: "object", additionalProperties: true, ...description };
  if (typeName === z.ZodFirstPartyTypeKind.ZodUnion) return true;
  if (typeName === z.ZodFirstPartyTypeKind.ZodUnknown || typeName === z.ZodFirstPartyTypeKind.ZodAny) return true;
  return Object.keys(description).length > 0 ? description : {};
}

function asJsonSchemaObject(schema: Record<string, unknown> | boolean): Record<string, unknown> {
  return typeof schema === "boolean" ? {} : schema;
}
