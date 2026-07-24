import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import type { CallToolResult } from "@modelcontextprotocol/sdk/types.js";
import { z } from "zod";
import { captureScreenshot } from "../capture/index.js";
import { CaptureAnnotationError, parseCaptureAnnotations } from "../capture/annotate.js";
import { shareClipboard } from "../clipboard.js";
import { publicClipRecord, publicClipRecords, publicStorageStatus } from "../public.js";
import { createClipClient } from "../sdk.js";
import type { CaptureAnnotation, CaptureMode, ClipboardKind, ClipClientOptions, ClipStatus } from "../types.js";

const CAPTURE_MODES = ["full", "window", "region"] as const;
const CLIPBOARD_KINDS = ["auto", "text", "image", "file"] as const;
const TOOL_NAMES = [
  "clip_status",
  "clip_capture",
  "clip_share_clipboard",
  "clip_share_text",
  "clip_list",
  "clip_get",
  "clip_delete",
] as const;
const refSchema = z.string().regex(/\S/, "ref must include a non-whitespace character");

type ToolName = typeof TOOL_NAMES[number];
type RawToolArgs = Record<string, unknown> | undefined;
type ToolHandler = (args: RawToolArgs) => Promise<CallToolResult> | CallToolResult;
type RawToolCallRequest = {
  params?: {
    name?: unknown;
    arguments?: unknown;
  };
};
type ServerWithRawRequestHandlers = {
  removeRequestHandler(method: string): void;
  _requestHandlers?: Map<string, (request: unknown, extra: unknown) => Promise<unknown> | unknown>;
};

class ToolInputError extends Error {
  readonly details: Record<string, unknown>;

  constructor(message: string, details: Record<string, unknown>) {
    super(message);
    this.name = "ToolInputError";
    this.details = details;
  }
}

function structured(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" && !Array.isArray(value) ? value as Record<string, unknown> : { value };
}

function jsonText(value: unknown): CallToolResult {
  return {
    content: [{ type: "text" as const, text: JSON.stringify(value, null, 2) }],
    structuredContent: structured(value),
  };
}

function errorPayload(code: string, message: string, details?: Record<string, unknown>): Record<string, unknown> {
  return {
    ok: false,
    error: {
      code,
      message,
      ...(details ? { details } : {}),
    },
  };
}

function jsonError(code: string, message: string, details?: Record<string, unknown>): CallToolResult {
  return {
    content: [{ type: "text" as const, text: JSON.stringify(errorPayload(code, message, details), null, 2) }],
    structuredContent: errorPayload(code, message, details),
    isError: true,
  };
}

const captureRectSchema = {
  x: z.number(),
  y: z.number(),
  width: z.number(),
  height: z.number(),
};

const captureAnnotationSchema = z.union([
  z.object({ type: z.literal("crop"), ...captureRectSchema }),
  z.object({ type: z.literal("box"), ...captureRectSchema, color: z.string().optional(), lineWidth: z.number().optional() }),
  z.object({ type: z.literal("blur"), ...captureRectSchema, radius: z.number().optional() }),
  z.object({
    type: z.literal("arrow"),
    from: z.object({ x: z.number(), y: z.number() }),
    to: z.object({ x: z.number(), y: z.number() }),
    color: z.string().optional(),
    lineWidth: z.number().optional(),
  }),
]);

function jsonResource(uri: string, value: unknown) {
  return {
    contents: [{
      uri,
      mimeType: "application/json",
      text: JSON.stringify(value, null, 2),
    }],
  };
}

async function safeJsonResource(uri: string, read: () => Promise<unknown>): Promise<ReturnType<typeof jsonResource>> {
  try {
    return jsonResource(uri, await read());
  } catch {
    return jsonResource(uri, errorPayload("internal_error", "Resource unavailable"));
  }
}

function publicStatus(status: ClipStatus): Record<string, unknown> {
  return {
    ...status,
    storage: publicStorageStatus(status.storage),
  };
}

function readArgs(args: RawToolArgs): Record<string, unknown> {
  return args ?? {};
}

function parseToolCallRequest(request: RawToolCallRequest): { ok: true; toolName: string; args: RawToolArgs } | { ok: false; result: CallToolResult } {
  const params = request.params;
  if (!params || typeof params !== "object") {
    return { ok: false, result: jsonError("invalid_input", "Tool call params must be an object", { field: "params", expected: "object" }) };
  }
  if (typeof params.name !== "string" || params.name.length === 0) {
    return { ok: false, result: jsonError("invalid_input", "Tool name must be a string", { field: "name", expected: "string" }) };
  }
  if (params.arguments === undefined) {
    return { ok: true, toolName: params.name, args: undefined };
  }
  if (!params.arguments || typeof params.arguments !== "object" || Array.isArray(params.arguments)) {
    return { ok: false, result: jsonError("invalid_input", "Tool arguments must be an object", { field: "arguments", expected: "object" }) };
  }
  return { ok: true, toolName: params.name, args: params.arguments as Record<string, unknown> };
}

function rejectUnexpectedArgs(args: Record<string, unknown>, allowed: readonly string[], toolName: ToolName): void {
  const unexpected = Object.keys(args).filter((key) => !allowed.includes(key));
  if (unexpected.length > 0) {
    throw new ToolInputError(`${toolName} received unsupported input`, {
      fields: unexpected,
      expectedFields: allowed,
    });
  }
}

function optionalString(args: Record<string, unknown>, field: string): string | undefined {
  const value = args[field];
  if (value === undefined) return undefined;
  if (typeof value !== "string") {
    throw new ToolInputError(`${field} must be a string`, { field, expected: "string" });
  }
  return value;
}

function requiredString(args: Record<string, unknown>, field: string, options: { nonEmpty?: boolean } = {}): string {
  const value = optionalString(args, field);
  if (value === undefined) {
    throw new ToolInputError(`${field} is required`, { field, expected: "string" });
  }
  if (options.nonEmpty && value.trim().length === 0) {
    throw new ToolInputError(`${field} must not be empty`, { field, expected: "non-empty string" });
  }
  return options.nonEmpty ? value.trim() : value;
}

function optionalEnum<T extends string>(
  args: Record<string, unknown>,
  field: string,
  values: readonly T[],
  fallback: T,
): T {
  const value = args[field];
  if (value === undefined) return fallback;
  if (typeof value !== "string" || !values.includes(value as T)) {
    throw new ToolInputError(`${field} must be a supported value`, { field, expected: [...values] });
  }
  return value as T;
}

function optionalLimit(args: Record<string, unknown>): number | undefined {
  const value = args["limit"];
  if (value === undefined) return undefined;
  if (typeof value !== "number" || !Number.isFinite(value) || !Number.isInteger(value) || value < 1 || value > 500) {
    throw new ToolInputError("limit must be an integer from 1 through 500", {
      field: "limit",
      expected: "integer 1..500",
    });
  }
  return value;
}

function registerMcpTool(
  server: McpServer,
  handlers: Map<string, ToolHandler>,
  name: ToolName,
  description: string,
  inputSchema: z.ZodType,
  handler: ToolHandler,
): void {
  handlers.set(name, handler);
  server.registerTool(name, { description, inputSchema }, async () => jsonError("internal_error", "Tool handler unavailable"));
}

function installToolCallHandler(server: McpServer, handlers: Map<string, ToolHandler>): void {
  // The SDK validates tools/call before handlers run; replace that wrapper so malformed tool arguments still return structured tool errors.
  const rawServer = server.server as unknown as ServerWithRawRequestHandlers;
  rawServer.removeRequestHandler("tools/call");
  if (!rawServer._requestHandlers) throw new Error("MCP server request handler registry is unavailable");
  rawServer._requestHandlers.set("tools/call", async (request) => {
    const parsed = parseToolCallRequest(request as RawToolCallRequest);
    if (!parsed.ok) return parsed.result;
    const handler = handlers.get(parsed.toolName);
    if (!handler) return jsonError("not_found", "Tool not found", { tool: parsed.toolName });

    try {
      return await handler(parsed.args);
    } catch (error) {
      if (error instanceof ToolInputError) {
        return jsonError("invalid_input", error.message, error.details);
      }
      return jsonError("internal_error", "Tool failed");
    }
  });
}

export function buildServer(options: ClipClientOptions = {}): McpServer {
  const server = new McpServer({
    name: "clip",
    version: "0.1.0",
  });
  const handlers = new Map<string, ToolHandler>();

  server.registerResource(
    "clip-status",
    "clip://status",
    {
      title: "Open Clip Status",
      description: "Local Open Clip storage and platform capability context.",
      mimeType: "application/json",
    },
    async () => safeJsonResource("clip://status", async () => publicStatus(await createClipClient(options).status())),
  );

  server.registerResource(
    "clip-shares",
    "clip://shares",
    {
      title: "Open Clip Shares",
      description: "Recent non-deleted Open Clip shares.",
      mimeType: "application/json",
    },
    async () => safeJsonResource("clip://shares", async () => ({
      shares: publicClipRecords(createClipClient(options).listShares({ limit: 25 })),
      cli_equivalent: "clip list --json",
    })),
  );

  registerMcpTool(
    server,
    handlers,
    "clip_status",
    "Show local storage, capture, and clipboard capability context.",
    z.object({}).strict(),
    async (input) => {
      const args = readArgs(input);
      rejectUnexpectedArgs(args, [], "clip_status");
      return jsonText(publicStatus(await createClipClient(options).status()));
    },
  );

  registerMcpTool(
    server,
    handlers,
    "clip_capture",
    "Capture a screenshot with best-effort local OS tools.",
    z.object({
      mode: z.enum(["full", "window", "region"]).optional(),
      title: z.string().optional(),
      annotations: z.array(captureAnnotationSchema).optional(),
    }).strict(),
    async (input) => {
      const args = readArgs(input);
      rejectUnexpectedArgs(args, ["mode", "title", "annotations"], "clip_capture");
      const mode = optionalEnum(args, "mode", CAPTURE_MODES, "full") as CaptureMode;
      let annotations: CaptureAnnotation[] | undefined;
      try {
        annotations = parseCaptureAnnotations(args["annotations"]);
      } catch (error) {
        if (error instanceof CaptureAnnotationError) {
          throw new ToolInputError(error.message, { field: "annotations" });
        }
        throw error;
      }
      return jsonText(publicClipRecord(await captureScreenshot(mode, {
        ...options,
        title: optionalString(args, "title"),
        annotations,
      })));
    },
  );

  registerMcpTool(
    server,
    handlers,
    "clip_share_clipboard",
    "Share clipboard text, image, or file content using local platform tools.",
    z.object({
      kind: z.enum(["auto", "text", "image", "file"]).optional(),
      title: z.string().optional(),
    }).strict(),
    async (input) => {
      const args = readArgs(input);
      rejectUnexpectedArgs(args, ["kind", "title"], "clip_share_clipboard");
      const kind = optionalEnum(args, "kind", CLIPBOARD_KINDS, "auto") as ClipboardKind;
      return jsonText(publicClipRecord(await shareClipboard(kind, { ...options, title: optionalString(args, "title") })));
    },
  );

  registerMcpTool(
    server,
    handlers,
    "clip_share_text",
    "Create a text share in the local Open Clip store.",
    z.object({
      text: z.string(),
      title: z.string().optional(),
    }).strict(),
    async (input) => {
      const args = readArgs(input);
      rejectUnexpectedArgs(args, ["text", "title"], "clip_share_text");
      return jsonText(publicClipRecord(createClipClient(options).createTextShare(requiredString(args, "text"), {
        title: optionalString(args, "title"),
      })));
    },
  );

  registerMcpTool(
    server,
    handlers,
    "clip_list",
    "List recent shares.",
    z.object({
      limit: z.number().int().positive().max(500).optional(),
    }).strict(),
    async (input) => {
      const args = readArgs(input);
      rejectUnexpectedArgs(args, ["limit"], "clip_list");
      return jsonText({ shares: publicClipRecords(createClipClient(options).listShares({ limit: optionalLimit(args) })) });
    },
  );

  registerMcpTool(
    server,
    handlers,
    "clip_get",
    "Get one share by id or slug.",
    z.object({ ref: refSchema }).strict(),
    async (input) => {
      const args = readArgs(input);
      rejectUnexpectedArgs(args, ["ref"], "clip_get");
      const record = createClipClient(options).getShare(requiredString(args, "ref", { nonEmpty: true }));
      return record ? jsonText(publicClipRecord(record)) : jsonError("not_found", "Share not found", { field: "ref" });
    },
  );

  registerMcpTool(
    server,
    handlers,
    "clip_delete",
    "Soft-delete one share by id or slug.",
    z.object({ ref: refSchema }).strict(),
    async (input) => {
      const args = readArgs(input);
      rejectUnexpectedArgs(args, ["ref"], "clip_delete");
      const deleted = createClipClient(options).deleteShare(requiredString(args, "ref", { nonEmpty: true }));
      return deleted ? jsonText({ deleted: true }) : jsonError("not_found", "Share not found", { field: "ref" });
    },
  );

  installToolCallHandler(server, handlers);
  return server;
}
