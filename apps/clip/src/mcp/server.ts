import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import { captureScreenshot } from "../capture/index.js";
import { shareClipboard } from "../clipboard.js";
import { createClipClient } from "../sdk.js";
import type { ClipClientOptions } from "../types.js";

function jsonText(value: unknown) {
  return { content: [{ type: "text" as const, text: JSON.stringify(value, null, 2) }] };
}

function jsonResource(uri: string, value: unknown) {
  return {
    contents: [{
      uri,
      mimeType: "application/json",
      text: JSON.stringify(value, null, 2),
    }],
  };
}

export function buildServer(options: ClipClientOptions = {}): McpServer {
  const server = new McpServer({
    name: "clip",
    version: "0.1.0",
  });

  server.registerResource(
    "clip-status",
    "clip://status",
    {
      title: "Open Clip Status",
      description: "Local Open Clip storage and platform capability context.",
      mimeType: "application/json",
    },
    async () => jsonResource("clip://status", await createClipClient(options).status()),
  );

  server.registerResource(
    "clip-shares",
    "clip://shares",
    {
      title: "Open Clip Shares",
      description: "Recent non-deleted Open Clip shares.",
      mimeType: "application/json",
    },
    async () => jsonResource("clip://shares", {
      shares: createClipClient(options).listShares({ limit: 25 }),
      cli_equivalent: "clip list --json",
    }),
  );

  server.tool(
    "clip_status",
    "Show local storage, capture, and clipboard capability context.",
    {},
    async () => jsonText(await createClipClient(options).status()),
  );

  server.tool(
    "clip_capture",
    "Capture a screenshot with best-effort local OS tools.",
    {
      mode: z.enum(["full", "window", "region"]).optional(),
      title: z.string().optional(),
    },
    async (input) => jsonText(await captureScreenshot(input.mode ?? "full", { ...options, title: input.title })),
  );

  server.tool(
    "clip_share_clipboard",
    "Share clipboard text, image, or file content using local platform tools.",
    {
      kind: z.enum(["auto", "text", "image", "file"]).optional(),
      title: z.string().optional(),
    },
    async (input) => jsonText(await shareClipboard(input.kind ?? "auto", { ...options, title: input.title })),
  );

  server.tool(
    "clip_share_text",
    "Create a text share in the local Open Clip store.",
    {
      text: z.string(),
      title: z.string().optional(),
    },
    async (input) => jsonText(createClipClient(options).createTextShare(input.text, { title: input.title })),
  );

  server.tool(
    "clip_list",
    "List recent shares.",
    {
      limit: z.number().int().positive().max(500).optional(),
    },
    async (input) => jsonText({ shares: createClipClient(options).listShares({ limit: input.limit }) }),
  );

  server.tool(
    "clip_get",
    "Get one share by id or slug.",
    {
      ref: z.string(),
    },
    async (input) => {
      const record = createClipClient(options).getShare(input.ref);
      return jsonText(record ?? { error: "Share not found", ref: input.ref });
    },
  );

  server.tool(
    "clip_delete",
    "Soft-delete one share by id or slug.",
    {
      ref: z.string(),
    },
    async (input) => jsonText({ deleted: createClipClient(options).deleteShare(input.ref), ref: input.ref }),
  );

  return server;
}
