#!/usr/bin/env bun
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { z } from "zod";
import { UptimeService } from "../service.js";
import { packageVersion } from "../version.js";
import {
  MAX_INTERVAL_SECONDS,
  MAX_RESULT_LIMIT,
  MAX_RETRY_COUNT,
  MAX_TIMEOUT_MS,
  MIN_INTERVAL_SECONDS,
  MIN_RETRY_COUNT,
  MIN_TIMEOUT_MS,
} from "../limits.js";

export interface CreateMcpServerOptions {
  service?: UptimeService;
}

export function createMcpServer(options: CreateMcpServerOptions = {}): McpServer {
  const server = new McpServer({ name: "uptime", version: packageVersion() });
  const service = options.service ?? new UptimeService({ mode: "local" });

  server.registerResource(
    "uptime_summary",
    "uptime://summary",
    {
      title: "Open Uptime Summary",
      description: "Current monitor status, uptime percentages, latency, and incident totals.",
      mimeType: "application/json",
    },
    async (uri) => jsonResource(uri, service.summary()),
  );

  server.registerResource(
    "uptime_monitors",
    "uptime://monitors",
    {
      title: "Open Uptime Monitors",
      description: "All configured monitors, including disabled monitors.",
      mimeType: "application/json",
    },
    async (uri) => jsonResource(uri, service.listMonitors({ includeDisabled: true })),
  );

  server.registerResource(
    "uptime_incidents",
    "uptime://incidents",
    {
      title: "Open Uptime Incidents",
      description: "Recent downtime incidents.",
      mimeType: "application/json",
    },
    async (uri) => jsonResource(uri, service.listIncidents({ limit: 100 })),
  );

  server.registerTool(
    "uptime_create_monitor",
    {
      title: "Create an uptime monitor",
      description: "Create an HTTP or TCP uptime monitor in the local Open Uptime store.",
      inputSchema: {
        name: z.string(),
        kind: z.enum(["http", "tcp"]),
        url: z.string().optional(),
        host: z.string().optional(),
        port: z.number().int().min(1).max(65_535).optional(),
        method: z.string().optional(),
        expectedStatus: z.number().int().min(100).max(599).nullable().optional(),
        intervalSeconds: z.number().int().min(MIN_INTERVAL_SECONDS).max(MAX_INTERVAL_SECONDS).optional(),
        timeoutMs: z.number().int().min(MIN_TIMEOUT_MS).max(MAX_TIMEOUT_MS).optional(),
        retryCount: z.number().int().min(MIN_RETRY_COUNT).max(MAX_RETRY_COUNT).optional(),
        enabled: z.boolean().optional(),
      },
    },
    async (args) => jsonResult(service.createMonitor(args)),
  );

  server.registerTool(
    "uptime_list_monitors",
    {
      title: "List uptime monitors",
      description: "List configured monitors.",
      inputSchema: {
        includeDisabled: z.boolean().optional(),
      },
    },
    async (args) => jsonResult(service.listMonitors({ includeDisabled: args.includeDisabled })),
  );

  server.registerTool(
    "uptime_get_monitor",
    {
      title: "Get an uptime monitor",
      description: "Get one monitor by id or name.",
      inputSchema: { idOrName: z.string() },
    },
    async (args) => {
      const monitor = service.getMonitor(args.idOrName);
      return monitor ? jsonResult(monitor) : errorResult(`Monitor not found: ${args.idOrName}`);
    },
  );

  server.registerTool(
    "uptime_update_monitor",
    {
      title: "Update an uptime monitor",
      description: "Update monitor settings.",
      inputSchema: {
        idOrName: z.string(),
        name: z.string().optional(),
        kind: z.enum(["http", "tcp"]).optional(),
        url: z.string().optional(),
        host: z.string().optional(),
        port: z.number().int().min(1).max(65_535).optional(),
        method: z.string().optional(),
        expectedStatus: z.number().int().min(100).max(599).nullable().optional(),
        intervalSeconds: z.number().int().min(MIN_INTERVAL_SECONDS).max(MAX_INTERVAL_SECONDS).optional(),
        timeoutMs: z.number().int().min(MIN_TIMEOUT_MS).max(MAX_TIMEOUT_MS).optional(),
        retryCount: z.number().int().min(MIN_RETRY_COUNT).max(MAX_RETRY_COUNT).optional(),
        enabled: z.boolean().optional(),
      },
    },
    async (args) => {
      const { idOrName, ...input } = args;
      return jsonResult(service.updateMonitor(idOrName, input));
    },
  );

  server.registerTool(
    "uptime_delete_monitor",
    {
      title: "Delete an uptime monitor",
      description: "Delete a monitor and its local check history.",
      inputSchema: { idOrName: z.string() },
    },
    async (args) => jsonResult({ deleted: service.deleteMonitor(args.idOrName) }),
  );

  server.registerTool(
    "uptime_check_monitor",
    {
      title: "Run one uptime check",
      description: "Run a check for one monitor and record the result.",
      inputSchema: { idOrName: z.string() },
    },
    async (args) => jsonResult(await service.checkMonitor(args.idOrName)),
  );

  server.registerTool(
    "uptime_check_all",
    {
      title: "Run all uptime checks",
      description: "Run checks for all enabled monitors and record results.",
      inputSchema: {},
    },
    async () => jsonResult(await service.checkAll()),
  );

  server.registerTool(
    "uptime_summary",
    {
      title: "Uptime summary",
      description: "Summarize monitor status, uptime percentages, latency, and open incidents.",
      inputSchema: {},
    },
    async () => jsonResult(service.summary()),
  );

  server.registerTool(
    "uptime_send_report",
    {
      title: "Send an uptime report",
      description: "Build an uptime report and send it through Mailery email, Telephony SMS, and/or Open Logs structured logs.",
      inputSchema: {
        subject: z.string().optional(),
        email: z.object({
          apiUrl: z.string().url().optional(),
          sendKey: z.string().optional(),
          from: z.string().optional(),
          to: z.union([z.string(), z.array(z.string())]).optional(),
          providerId: z.string().optional(),
        }).optional(),
        sms: z.object({
          apiUrl: z.string().url().optional(),
          from: z.string().optional(),
          to: z.union([z.string(), z.array(z.string())]).optional(),
        }).optional(),
        logs: z.object({
          apiUrl: z.string().url().optional(),
          apiKey: z.string().optional(),
          projectId: z.string().optional(),
          environment: z.string().optional(),
          service: z.string().optional(),
        }).optional(),
        timeoutMs: z.number().int().min(1000).max(60000).optional(),
      },
    },
    async (args) => jsonResult(await service.sendReport({
      subject: args.subject,
      email: args.email,
      sms: args.sms,
      logs: args.logs,
      timeoutMs: args.timeoutMs,
    })),
  );

  server.registerTool(
    "uptime_import_preview",
    {
      title: "Preview an uptime inventory import",
      description: "Preview monitor candidates from manual, projects, servers, domains, or deployment records without writing.",
      inputSchema: {
        source: z.enum(["manual", "projects", "servers", "domains", "deployment"]),
        records: z.array(z.unknown()),
      },
    },
    async (args) => jsonResult(service.previewImport({ source: args.source, records: args.records })),
  );

  server.registerTool(
    "uptime_import_apply",
    {
      title: "Apply an uptime inventory import",
      description: "Apply monitor candidates from manual, projects, servers, domains, or deployment records idempotently.",
      inputSchema: {
        source: z.enum(["manual", "projects", "servers", "domains", "deployment"]),
        records: z.array(z.unknown()),
      },
    },
    async (args) => jsonResult(service.applyImport({ source: args.source, records: args.records })),
  );

  server.registerTool(
    "uptime_import_rollback",
    {
      title: "Rollback an uptime import batch",
      description: "Rollback config changes from an import batch while preserving check history.",
      inputSchema: {
        batchId: z.string(),
      },
    },
    async (args) => jsonResult(service.rollbackImport(args.batchId)),
  );

  server.registerTool(
    "uptime_results",
    {
      title: "List uptime check results",
      description: "List recent check results.",
      inputSchema: {
        monitorId: z.string().optional(),
        limit: z.number().int().min(1).max(MAX_RESULT_LIMIT).optional(),
      },
    },
    async (args) => jsonResult(service.listResults({ monitorId: args.monitorId, limit: args.limit })),
  );

  server.registerTool(
    "uptime_incidents",
    {
      title: "List uptime incidents",
      description: "List open or closed downtime incidents.",
      inputSchema: {
        monitorId: z.string().optional(),
        status: z.enum(["open", "closed"]).optional(),
        limit: z.number().int().min(1).max(MAX_RESULT_LIMIT).optional(),
      },
    },
    async (args) => jsonResult(service.listIncidents({ monitorId: args.monitorId, status: args.status, limit: args.limit })),
  );

  return server;
}

async function main(): Promise<void> {
  const server = createMcpServer();
  const transport = new StdioServerTransport();
  await server.connect(transport);
}

function jsonResult(value: unknown) {
  return { content: [{ type: "text" as const, text: JSON.stringify(value, null, 2) }] };
}

function jsonResource(uri: URL, value: unknown) {
  return {
    contents: [{
      uri: uri.toString(),
      mimeType: "application/json",
      text: JSON.stringify(value, null, 2),
    }],
  };
}

function errorResult(message: string) {
  return { content: [{ type: "text" as const, text: message }], isError: true };
}

if (import.meta.main) {
  main().catch((error) => {
    console.error(error instanceof Error ? error.message : String(error));
    process.exit(1);
  });
}
