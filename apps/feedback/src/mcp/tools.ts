import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import type { CallToolResult } from "@modelcontextprotocol/sdk/types.js";
import { z } from "zod";
import { LocalFeedbackStore } from "../storage.js";
import type { FeedbackInput, FeedbackStore } from "../types.js";
import { parseFeedbackStatus, validationErrorMessage } from "../validation.js";

export interface FeedbackMcpToolDefinition {
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

function readInput(input: Record<string, unknown>): FeedbackInput {
  return {
    appId: String(input.app_id ?? input.appId ?? ""),
    message: String(input.message ?? ""),
    kind: input.kind as FeedbackInput["kind"],
    severity: input.severity as FeedbackInput["severity"],
    userId: typeof input.user_id === "string" ? input.user_id : typeof input.userId === "string" ? input.userId : undefined,
    email: typeof input.email === "string" ? input.email : undefined,
    url: typeof input.url === "string" ? input.url : undefined,
    rating: typeof input.rating === "number" ? input.rating : undefined,
    tags: Array.isArray(input.tags) ? input.tags.map(String) : undefined,
    metadata: input.metadata && typeof input.metadata === "object" && !Array.isArray(input.metadata) ? input.metadata as FeedbackInput["metadata"] : undefined,
    context: input.context && typeof input.context === "object" && !Array.isArray(input.context) ? input.context as FeedbackInput["context"] : undefined,
  };
}

function listFilterFromInput(input: Record<string, unknown>) {
  return {
    appId: typeof input.app_id === "string" ? input.app_id : undefined,
    status: typeof input.status === "string" ? parseFeedbackStatus(input.status) : undefined,
    tag: typeof input.tag === "string" ? input.tag : undefined,
    limit: typeof input.limit === "number" ? input.limit : undefined,
  };
}

export function buildFeedbackMcpTools(store: FeedbackStore = new LocalFeedbackStore()): FeedbackMcpToolDefinition[] {
  const tools: Omit<FeedbackMcpToolDefinition, "inputSchema">[] = [
    {
      name: "submit_feedback",
      description: "Submit product feedback for an application.",
      paramsSchema: {
        app_id: z.string().describe("Stable application id or slug"),
        message: z.string().describe("Feedback text"),
        kind: z.enum(["bug", "idea", "question", "praise", "other"]).optional(),
        severity: z.enum(["low", "medium", "high", "critical"]).optional(),
        user_id: z.string().optional(),
        email: z.string().email().optional(),
        url: z.string().url().optional(),
        rating: z.number().int().min(1).max(5).optional(),
        tags: z.array(z.string()).optional(),
        metadata: z.record(z.unknown()).optional(),
        context: z.record(z.unknown()).optional(),
      },
      run: async (input) => {
        try {
          return jsonContent(await store.createFeedback(readInput(input), { source: "mcp" }));
        } catch (error) {
          return errorContent(error);
        }
      },
    },
    {
      name: "list_feedback",
      description: "List collected feedback entries.",
      paramsSchema: {
        app_id: z.string().optional(),
        status: z.enum(["new", "triaged", "closed"]).optional(),
        tag: z.string().optional(),
        limit: z.number().int().min(1).max(500).optional(),
      },
      run: async (input) => jsonContent(await store.listFeedback(listFilterFromInput(input))),
    },
    {
      name: "get_feedback",
      description: "Get one feedback entry by id.",
      paramsSchema: {
        id: z.string(),
      },
      run: async (input) => {
        const item = await store.getFeedback(String(input.id));
        return item ? jsonContent(item) : { ...textContent(`Feedback not found: ${String(input.id)}`), isError: true };
      },
    },
    {
      name: "update_feedback_status",
      description: "Update the triage status for one feedback entry.",
      paramsSchema: {
        id: z.string(),
        status: z.enum(["new", "triaged", "closed"]),
      },
      run: async (input) => {
        const item = await store.updateFeedbackStatus(String(input.id), parseFeedbackStatus(input.status));
        return item ? jsonContent(item) : { ...textContent(`Feedback not found: ${String(input.id)}`), isError: true };
      },
    },
    {
      name: "feedback_stats",
      description: "Return aggregate feedback counts.",
      paramsSchema: {},
      run: async () => jsonContent(await store.stats()),
    },
    {
      name: "export_feedback",
      description: "Export collected feedback as JSONL or JSON.",
      paramsSchema: {
        app_id: z.string().optional(),
        status: z.enum(["new", "triaged", "closed"]).optional(),
        tag: z.string().optional(),
        limit: z.number().int().min(1).max(500).optional(),
        format: z.enum(["jsonl", "json"]).optional(),
      },
      run: async (input) => {
        const filter = listFilterFromInput(input);
        return input.format === "json"
          ? jsonContent(await store.listFeedback(filter))
          : textContent(await store.exportJsonl(filter));
      },
    },
  ];

  return tools.map((tool) => ({
    ...tool,
    inputSchema: zodRawShapeToJsonSchema(tool.paramsSchema),
  }));
}

export function registerFeedbackMcpTools(server: McpServer, store?: FeedbackStore): FeedbackMcpToolDefinition[] {
  const tools = buildFeedbackMcpTools(store);
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
  if (typeName === z.ZodFirstPartyTypeKind.ZodNumber) return { type: "number", ...description };
  if (typeName === z.ZodFirstPartyTypeKind.ZodEnum) return { type: "string", enum: def?.values, ...description };
  if (typeName === z.ZodFirstPartyTypeKind.ZodArray) return { type: "array", items: zodSchemaToJsonSchema(def?.type as z.ZodTypeAny), ...description };
  if (typeName === z.ZodFirstPartyTypeKind.ZodRecord) return { type: "object", additionalProperties: true, ...description };
  if (typeName === z.ZodFirstPartyTypeKind.ZodUnknown || typeName === z.ZodFirstPartyTypeKind.ZodAny) return true;
  return Object.keys(description).length > 0 ? description : {};
}

function asJsonSchemaObject(schema: Record<string, unknown> | boolean): Record<string, unknown> {
  return typeof schema === "boolean" ? {} : schema;
}
