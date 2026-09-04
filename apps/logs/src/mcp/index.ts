#!/usr/bin/env bun
import {
  type AgentEventsClient,
  registerAgentTools,
} from "./agent-registry.ts";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { z } from "zod";
import type { McpEventWatchArgs } from "../lib/event-watch.ts";
import { PACKAGE_VERSION, exitIfMetadataRequest } from "../lib/package-meta.ts";
import { parseTime } from "../lib/parse-time.ts";
import { scoreLabel } from "../lib/perf.ts";
import {
  UNIVERSAL_EVENT_TYPES,
  type UniversalEventInput,
  type UniversalEventType,
} from "../lib/universal-ingest.ts";
import {
  localStoreIfAvailable,
  resolveStore,
} from "../store/index.ts";
import type { LogLevel, LogRow } from "../types/index.ts";

exitIfMetadataRequest({
  name: "logs-mcp",
  description: "Start the @hasna/logs MCP server (stdio by default).",
  options: [
    "  --http           Serve MCP over Streamable HTTP (127.0.0.1)",
    "  --port <number>  HTTP port (default: 8864, env: MCP_HTTP_PORT)",
  ],
});

// Best-effort local store for internal self-telemetry (agent lifecycle + tool
// calls). It is `null` when the API transport is live — MCP tool-call telemetry
// is deliberately not mirrored into the shared hosted sink (volume), so it is
// silently skipped there. Telemetry must NEVER change tool behavior. The event
// catalog itself is a transport-resolved data-plane feature: `event_watch`
// below works on both tiers through the unified Store.
const telemetryStore = localStoreIfAvailable();

// register_agent / heartbeat / set_focus / list_agents are the canonical,
// persistent agent-lifecycle tools (SQLite-backed registry) — implemented
// locally in src/mcp/agent-registry.ts since the @hasna/agent-registry
// package was deleted (hasna/apps#1529) rather than a hand-rolled in-memory
// Map. `send_feedback` stays local (see
// below) since it persists into logs' own `feedback` table with a category
// enum. Lifecycle activity is still mirrored into logs' own durable event
// store via `agentRegistryEvents` below, preserving prior self-telemetry.
const agentRegistryEvents: AgentEventsClient = {
  emit(input) {
    try {
      const phase = input.type.startsWith("agent.")
        ? input.type.slice("agent.".length)
        : input.type;
      const displayPhase = phase === "focus_changed" ? "focus" : phase;
      const name = input.subject ?? "unknown";
      const data = (input.data ?? {}) as Record<string, unknown>;
      const sessionId =
        typeof data.session_id === "string" ? data.session_id : undefined;
      const agentId =
        typeof data.agent_id === "string" ? data.agent_id : undefined;
      const projectId =
        typeof data.project_id === "string" ? data.project_id : undefined;
      telemetryStore?.ingestUniversalEvent({
        type: "agent",
        source: "mcp",
        severity: "info",
        privacy: "internal",
        message: input.message ?? `MCP agent ${displayPhase}: ${name}`,
        session_id: sessionId,
        attributes: {
          category: "mcp_agent_session",
          phase: displayPhase,
          agent_id: agentId,
          agent_name: name,
          session_id: sessionId,
          project_id: projectId,
        },
        body: {
          agent: {
            id: agentId ?? null,
            name,
            session_id: sessionId ?? null,
            project_id: projectId ?? null,
            phase: displayPhase,
          },
        },
      });
    } catch {
      // Agent registry telemetry must not affect MCP tool behavior.
    }
  },
};

export function buildServer(): McpServer {
  const server = new McpServer({ name: "logs", version: PACKAGE_VERSION });

  const BRIEF_FIELDS: (keyof LogRow)[] = [
    "id",
    "timestamp",
    "level",
    "message",
    "service",
  ];

  // biome-ignore lint/suspicious/noExplicitAny: MCP SDK tool handlers are dynamically typed from their Zod schemas.
  type McpToolHandler = (...args: any[]) => any;

  interface LogPushBatchEntry {
    level: LogLevel;
    message: string;
    project_id?: string;
    service?: string;
    trace_id?: string;
    metadata?: Record<string, unknown>;
  }

  function applyBrief(rows: LogRow[], brief = true): unknown[] {
    if (!brief) return rows;
    return rows.map((r) => ({
      id: r.id,
      timestamp: r.timestamp,
      level: r.level,
      message: r.message,
      service: r.service,
      age_seconds: Math.floor(
        (Date.now() - new Date(r.timestamp).getTime()) / 1000,
      ),
    }));
  }

  // The unified data-plane Store: LocalStore (SQLite) or ApiStore (HTTP /v1 +
  // bearer key), resolved from the environment. Every data-plane tool routes
  // through this — no per-tool transport branching, no `getDb()` reads
  // in handlers. Fully reversible: unset HASNA_LOGS_API_URL/KEY -> local.
  const store = resolveStore();

  // Resolve a project name-or-id through the live store (local db or /v1).
  const rid = (idOrName?: string): Promise<string | undefined> =>
    store.resolveProjectId(idOrName);

  // Tool registry with param signatures for discoverability
  const TOOLS: Record<string, { desc: string; params: string }> = {
    register_project: {
      desc: "Register a project",
      params: "(name, github_repo?, base_url?, description?)",
    },
    register_page: {
      desc: "Register a page URL to a project",
      params: "(project_id, url, path?, name?)",
    },
    create_scan_job: {
      desc: "Schedule headless page scans",
      params: "(project_id, schedule, page_id?)",
    },
    resolve_project: { desc: "Resolve project name to ID", params: "(name)" },
    log_push: {
      desc: "Push a single log entry",
      params: "(level, message, project_id?, service?, trace_id?, metadata?)",
    },
    log_push_batch: {
      desc: "Push multiple log entries in one call",
      params:
        "(entries: Array<{level, message, project_id?, service?, trace_id?}>)",
    },
    log_search: {
      desc: "Search logs",
      params:
        "(project_id?, level?, since?, until?, text?, service?, limit?=100, brief?=true)",
    },
    log_tail: {
      desc: "Get N most recent logs",
      params: "(project_id?, n?=50, brief?=true)",
    },
    log_count: {
      desc: "Count logs — zero token cost, pure signal",
      params: "(project_id?, service?, level?, since?, until?)",
    },
    log_recent_errors: {
      desc: "Shortcut: recent errors + fatals",
      params: "(project_id?, since?='1h', limit?=20)",
    },
    log_summary: {
      desc: "Error/warn counts by service",
      params: "(project_id?, since?)",
    },
    log_context: {
      desc: "All logs for a trace_id",
      params: "(trace_id, brief?=true)",
    },
    log_context_from_id: {
      desc: "Trace context from a log ID (no trace_id needed)",
      params: "(log_id, brief?=true)",
    },
    log_export: {
      desc: "Export matching logs as JSON or CSV",
      params:
        "(project_id?, format?='json', since?, until?, level?, service?, limit?=100000)",
    },
    log_diagnose: {
      desc: "Full diagnosis: score, top errors, failing pages, perf regressions",
      params:
        "(project_id, since?='24h', include?=['top_errors','error_rate','failing_pages','perf'])",
    },
    log_compare: {
      desc: "Diff two time windows for new/resolved errors",
      params: "(project_id, a_since, a_until, b_since, b_until)",
    },
    log_session_context: {
      desc: "Logs + session metadata for a session_id",
      params: "(session_id, brief?=true)",
    },
    event_push: {
      desc: "Push one raw-first universal telemetry event",
      params:
        "(type, source?, severity?, message?, event_id?, event_time?, trace_id?, span_id?, run_id?, body?, attributes?)",
    },
    event_search: {
      desc: "Search raw-backed event_records across event types and identity dimensions",
      params:
        "(event_type?, source?, severity?, project_id?, machine_id?, repo_id?, app_id?, process_id?, run_id?, trace_id?, session_id?, text?, limit?=100, include_raw?=false, include_internal?=false)",
    },
    event_get: {
      desc: "Get one event record and optionally reconstruct its raw segment envelope",
      params: "(event_id, include_raw?=true)",
    },
    event_export: {
      desc: "Export matching raw-backed event records as JSON",
      params:
        "(event_type?, source?, severity?, project_id?, trace_id?, run_id?, text?, limit?=100000, include_raw?=false)",
    },
    event_watch: {
      desc: "Poll event_records after a cursor for MCP live-tail consumers",
      params:
        "(last_event_id?, event_type?, source?, severity?, project_id?, trace_id?, run_id?, limit?=100, include_raw?=false, from_start?=false, include_internal?=false)",
    },
    test_report_search: {
      desc: "Search projected test_reports and optionally include bounded test_cases",
      params:
        "(report_id?, event_id?, project_id?, run_id?, process_id?, parser?, parse_status?, case_status?, outcome?, min_failures?, min_errors?, text?, limit?=100, include_cases?=false)",
    },
    test_report_get: {
      desc: "Get one projected test report with bounded test case rows by default",
      params: "(report_id, include_cases?=true)",
    },
    perf_snapshot: {
      desc: "Latest performance snapshot",
      params: "(project_id, page_id?)",
    },
    perf_trend: {
      desc: "Performance over time",
      params: "(project_id, page_id?, since?, limit?=50)",
    },
    scan_status: { desc: "Last scan jobs", params: "(project_id?)" },
    list_projects: { desc: "List all projects", params: "()" },
    list_pages: { desc: "List pages for a project", params: "(project_id)" },
    list_issues: {
      desc: "List grouped error issues",
      params: "(project_id?, status?, limit?=50)",
    },
    resolve_issue: {
      desc: "Update issue status",
      params: "(id, status: open|resolved|ignored)",
    },
    create_alert_rule: {
      desc: "Create alert rule",
      params:
        "(project_id, name, level?, threshold_count?, window_seconds?, webhook_url?)",
    },
    list_alert_rules: { desc: "List alert rules", params: "(project_id?)" },
    delete_alert_rule: { desc: "Delete alert rule", params: "(id)" },
    get_health: { desc: "Server health + DB stats", params: "()" },
    log_stats: {
      desc: "Aggregate DB-level log statistics for a project",
      params: "(project_id?)",
    },
    search_tools: {
      desc: "Search tools by keyword — returns names, descriptions, param signatures",
      params: "(query)",
    },
    describe_tools: {
      desc: "List all tools with descriptions and param signatures",
      params: "()",
    },
  };

  // Fellow agents: keep MCP registrations behind this helper so descriptions and schemas stay aligned with the current SDK.
  function registerTool(
    name: keyof typeof TOOLS,
    schema: Record<string, z.ZodTypeAny>,
    handler: McpToolHandler,
  ) {
    const tool = TOOLS[name];
    if (!tool) throw new Error(`Unknown MCP tool: ${name}`);
    return registerTrackedTool(name, tool.desc, schema, handler);
  }

  function registerTrackedTool(
    name: string,
    desc: string,
    schema: Record<string, z.ZodTypeAny>,
    handler: McpToolHandler,
  ) {
    // Cast the schema to `any` at the call site to stop the MCP SDK's generic
    // inference from recursing into every zod shape (TS2589 "excessively deep").
    return (server.tool as (...a: unknown[]) => unknown)(
      name,
      desc,
      schema,
      async (...args: Parameters<McpToolHandler>) => {
        const startedAt = performance.now();
        try {
          const result = await handler(...args);
          recordMcpToolCall(name, args[0], result, null, startedAt);
          return result;
        } catch (error) {
          recordMcpToolCall(name, args[0], null, error, startedAt);
          throw error;
        }
      },
    );
  }

  registerTool("search_tools", { query: z.string() }, ({ query }) => {
    const q = query.toLowerCase();
    const matches = Object.entries(TOOLS).filter(
      ([k, v]) => k.includes(q) || v.desc.toLowerCase().includes(q),
    );
    const text =
      matches.map(([k, v]) => `${k}${v.params} — ${v.desc}`).join("\n") ||
      "No matches";
    return { content: [{ type: "text", text }] };
  });

  registerTool("describe_tools", {}, () => ({
    content: [
      {
        type: "text",
        text: Object.entries(TOOLS)
          .map(([k, v]) => `${k}${v.params} — ${v.desc}`)
          .join("\n"),
      },
    ],
  }));

  registerTool("resolve_project", { name: z.string() }, async ({ name }) => {
    const id = await rid(name);
    const project = id ? await store.getProject(id) : null;
    return {
      content: [
        {
          type: "text",
          text: JSON.stringify(
            project ?? { error: `Project '${name}' not found` },
          ),
        },
      ],
    };
  });

  registerTool(
    "register_project",
    {
      name: z.string(),
      github_repo: z.string().optional(),
      base_url: z.string().optional(),
      description: z.string().optional(),
    },
    async (args) => ({
      content: [
        { type: "text", text: JSON.stringify(await store.createProject(args)) },
      ],
    }),
  );

  registerTool(
    "register_page",
    {
      project_id: z.string(),
      url: z.string(),
      path: z.string().optional(),
      name: z.string().optional(),
    },
    async (args) => ({
      content: [
        {
          type: "text",
          text: JSON.stringify(
            await store.createPage({
              ...args,
              project_id: (await rid(args.project_id)) ?? args.project_id,
            }),
          ),
        },
      ],
    }),
  );

  registerTool(
    "create_scan_job",
    {
      project_id: z.string(),
      schedule: z.string(),
      page_id: z.string().optional(),
    },
    async (args) => ({
      content: [
        {
          type: "text",
          text: JSON.stringify(
            await store.createJob({
              ...args,
              project_id: (await rid(args.project_id)) ?? args.project_id,
            }),
          ),
        },
      ],
    }),
  );

  registerTool(
    "log_push",
    {
      level: z.enum(["debug", "info", "warn", "error", "fatal"]),
      message: z.string(),
      project_id: z.string().optional(),
      service: z.string().optional(),
      trace_id: z.string().optional(),
      session_id: z.string().optional(),
      agent: z.string().optional(),
      url: z.string().optional(),
      metadata: z.record(z.string(), z.unknown()).optional(),
    },
    async (args) => {
      const row = await store.ingestLog({
        ...args,
        project_id: await rid(args.project_id),
      });
      return { content: [{ type: "text", text: `Logged: ${row.id}` }] };
    },
  );

  registerTool(
    "log_push_batch",
    {
      entries: z.array(
        z.object({
          level: z.enum(["debug", "info", "warn", "error", "fatal"]),
          message: z.string(),
          project_id: z.string().optional(),
          service: z.string().optional(),
          trace_id: z.string().optional(),
          metadata: z.record(z.string(), z.unknown()).optional(),
        }),
      ),
      trace_id: z
        .string()
        .optional()
        .describe(
          "Shared trace_id applied to all entries that don't have their own trace_id",
        ),
      project_id: z
        .string()
        .optional()
        .describe(
          "Shared project_id applied to all entries (individual entry project_id takes precedence)",
        ),
    },
    async ({
      entries,
      trace_id,
      project_id,
    }: {
      entries: LogPushBatchEntry[];
      trace_id?: string;
      project_id?: string;
    }) => {
      const rows: { id: string }[] = [];
      for (const e of entries) {
        rows.push(
          await store.ingestLog({
            ...e,
            project_id: await rid(e.project_id ?? project_id),
            trace_id: e.trace_id ?? trace_id,
          }),
        );
      }
      return {
        content: [
          {
            type: "text",
            text: `Logged ${rows.length} entries${trace_id ? ` (trace: ${trace_id})` : ""}`,
          },
        ],
      };
    },
  );

  registerTool(
    "log_search",
    {
      project_id: z.string().optional(),
      page_id: z.string().optional(),
      level: z.string().optional(),
      service: z.string().optional(),
      since: z.string().optional(),
      until: z.string().optional(),
      text: z.string().optional(),
      trace_id: z.string().optional(),
      limit: z.number().optional(),
      brief: z.boolean().optional(),
    },
    async (args) => {
      const rows = await store.listLogs({
        project_id: await rid(args.project_id),
        page_id: args.page_id,
        level: args.level ? (args.level.split(",") as LogLevel[]) : undefined,
        service: args.service,
        trace_id: args.trace_id,
        text: args.text,
        since: parseTime(args.since) ?? args.since,
        until: parseTime(args.until) ?? args.until,
        limit: args.limit,
      });
      return {
        content: [
          {
            type: "text",
            text: JSON.stringify(applyBrief(rows, args.brief !== false)),
          },
        ],
      };
    },
  );

  registerTool(
    "log_tail",
    {
      project_id: z.string().optional(),
      n: z.number().optional(),
      brief: z.boolean().optional(),
    },
    async ({ project_id, n, brief }) => {
      const rows = await store.tailLogs(await rid(project_id), n ?? 50);
      return {
        content: [
          {
            type: "text",
            text: JSON.stringify(applyBrief(rows, brief !== false)),
          },
        ],
      };
    },
  );

  registerTool(
    "log_count",
    {
      project_id: z.string().optional(),
      service: z.string().optional(),
      level: z.string().optional(),
      since: z.string().optional(),
      until: z.string().optional(),
      group_by: z
        .enum(["level", "service"])
        .optional()
        .describe(
          "Return breakdown by 'level' or 'service' in addition to totals",
        ),
    },
    async (args) => {
      const count = await store.countLogs({
        project_id: await rid(args.project_id),
        service: args.service,
        level: args.level,
        since: args.since,
        until: args.until,
        group_by: args.group_by,
      });
      return {
        content: [{ type: "text", text: JSON.stringify(count) }],
      };
    },
  );

  registerTool(
    "log_recent_errors",
    {
      project_id: z.string().optional(),
      since: z.string().optional(),
      limit: z.number().optional(),
    },
    async ({ project_id, since, limit }) => {
      const rows = await store.listLogs({
        project_id: await rid(project_id),
        level: ["error", "fatal"],
        since: parseTime(since ?? "1h"),
        limit: limit ?? 20,
      });
      return {
        content: [
          { type: "text", text: JSON.stringify(applyBrief(rows, true)) },
        ],
      };
    },
  );

  registerTool(
    "log_summary",
    {
      project_id: z.string().optional(),
      since: z.string().optional(),
    },
    async ({ project_id, since }) => ({
      content: [
        {
          type: "text",
          text: JSON.stringify(
            await store.summarize(
              await rid(project_id),
              parseTime(since) ?? since,
            ),
          ),
        },
      ],
    }),
  );

  registerTool(
    "log_context",
    {
      trace_id: z.string(),
      brief: z.boolean().optional(),
    },
    async ({ trace_id, brief }) => ({
      content: [
        {
          type: "text",
          text: JSON.stringify(
            applyBrief(await store.getLogContext(trace_id), brief !== false),
          ),
        },
      ],
    }),
  );

  registerTool(
    "log_context_from_id",
    {
      log_id: z.string(),
      brief: z.boolean().optional(),
      window: z
        .number()
        .int()
        .min(0)
        .optional()
        .describe(
          "Return N logs before and after the target log's timestamp (in addition to trace context)",
        ),
    },
    async ({ log_id, brief, window }) => {
      const rows = await store.getLogContextFromId(log_id, window ?? 0);
      return {
        content: [
          {
            type: "text",
            text: JSON.stringify(applyBrief(rows, brief !== false)),
          },
        ],
      };
    },
  );

  registerTool(
    "log_export",
    {
      project_id: z.string().optional().describe("Project name or ID"),
      format: z
        .enum(["json", "csv"])
        .optional()
        .default("json")
        .describe("Output format"),
      since: z.string().optional().describe("Since time (1h, 24h, 7d, ISO)"),
      until: z.string().optional(),
      level: z.array(z.string()).optional().describe("Filter by levels"),
      service: z.string().optional(),
      limit: z.number().optional().default(100000),
    },
    async (args) => {
      const rows = await store.listLogs({
        project_id: await rid(args.project_id),
        level: args.level ? (args.level as LogLevel[]) : undefined,
        service: args.service,
        since: parseTime(args.since) ?? args.since,
        until: parseTime(args.until) ?? args.until,
        limit: args.limit ?? 100000,
      });
      let text: string;
      if (args.format === "csv") {
        const cols = [
          "id",
          "timestamp",
          "level",
          "service",
          "message",
          "trace_id",
        ];
        const esc = (v: unknown) => `"${String(v ?? "").replace(/"/g, '""')}"`;
        text = `${cols.join(",")}\n${rows
          .map((r) =>
            cols
              .map((c) => esc((r as unknown as Record<string, unknown>)[c]))
              .join(","),
          )
          .join("\n")}\n`;
      } else {
        text = JSON.stringify(rows);
      }
      return { content: [{ type: "text" as const, text }] };
    },
  );

  registerTool(
    "log_diagnose",
    {
      project_id: z.string(),
      since: z.string().optional(),
      include: z
        .array(z.enum(["top_errors", "error_rate", "failing_pages", "perf"]))
        .optional(),
    },
    async ({ project_id, since, include }) => {
      const resolved = (await store.resolveProjectId(project_id)) ?? project_id;
      return {
        content: [
          {
            type: "text",
            text: JSON.stringify(
              await store.diagnose(resolved, since, include),
            ),
          },
        ],
      };
    },
  );

  registerTool(
    "log_compare",
    {
      project_id: z.string(),
      a_since: z.string(),
      a_until: z.string(),
      b_since: z.string(),
      b_until: z.string(),
    },
    async ({ project_id, a_since, a_until, b_since, b_until }) => {
      const resolved = (await store.resolveProjectId(project_id)) ?? project_id;
      return {
        content: [
          {
            type: "text",
            text: JSON.stringify(
              await store.compareWindows(
                resolved,
                parseTime(a_since) ?? a_since,
                parseTime(a_until) ?? a_until,
                parseTime(b_since) ?? b_since,
                parseTime(b_until) ?? b_until,
              ),
            ),
          },
        ],
      };
    },
  );

  registerTool(
    "log_session_context",
    {
      session_id: z.string(),
      brief: z.boolean().optional(),
    },
    async ({ session_id, brief }) => {
      const ctx = await store.sessionContext(session_id);
      return {
        content: [
          {
            type: "text",
            text: JSON.stringify({
              ...ctx,
              logs: applyBrief(ctx.logs, brief !== false),
            }),
          },
        ],
      };
    },
  );

  registerTool(
    "event_push",
    {
      type: z.enum(
        UNIVERSAL_EVENT_TYPES as [UniversalEventType, ...UniversalEventType[]],
      ),
      event_id: z.string().optional(),
      source_event_id: z.string().optional(),
      event_time: z.string().optional(),
      source: z.string().optional(),
      severity: z.enum(["debug", "info", "warn", "error", "fatal"]).optional(),
      privacy: z
        .enum(["public", "internal", "sensitive", "secret", "pii"])
        .optional(),
      message: z.string().optional(),
      project_id: z.string().optional(),
      machine_id: z.string().optional(),
      repo_id: z.string().optional(),
      app_id: z.string().optional(),
      process_id: z.string().optional(),
      run_id: z.string().optional(),
      trace_id: z.string().optional(),
      span_id: z.string().optional(),
      parent_span_id: z.string().optional(),
      session_id: z.string().optional(),
      release_id: z.string().optional(),
      artifact_id: z.string().optional(),
      environment: z.string().optional(),
      body: z.record(z.string(), z.unknown()).optional(),
      attributes: z.record(z.string(), z.unknown()).optional(),
    },
    async (args) => {
      const projectId = await store.resolveProjectId(args.project_id);
      const hasExplicitIdentity = Boolean(
        args.machine_id || args.repo_id || args.app_id,
      );
      const eventInput: UniversalEventInput = {
        ...args,
        project_id: projectId,
        environment: args.environment ?? process.env.NODE_ENV ?? "development",
      };
      const result = await store.pushEvent(eventInput, {
        detectIdentity: !hasExplicitIdentity,
        projectNameOrId: args.project_id,
        environment: args.environment,
      });
      return {
        content: [
          {
            type: "text",
            text: JSON.stringify({
              inserted: result.inserted,
              event: result.event,
            }),
          },
        ],
      };
    },
  );

  registerTool(
    "event_search",
    {
      event_type: z.string().optional(),
      source: z.string().optional(),
      severity: z.string().optional(),
      project_id: z.string().optional(),
      machine_id: z.string().optional(),
      repo_id: z.string().optional(),
      app_id: z.string().optional(),
      process_id: z.string().optional(),
      run_id: z.string().optional(),
      trace_id: z.string().optional(),
      session_id: z.string().optional(),
      environment: z.string().optional(),
      since: z.string().optional(),
      until: z.string().optional(),
      text: z.string().optional(),
      limit: z.number().optional(),
      include_raw: z.boolean().optional(),
      include_internal: z.boolean().optional(),
    },
    async (args) => ({
      content: [
        {
          type: "text",
          text: JSON.stringify(
            await store.listEvents({
              ...args,
              project_id: await rid(args.project_id),
              since: parseTime(args.since) ?? args.since,
              until: parseTime(args.until) ?? args.until,
              limit: args.limit ?? 100,
              include_raw: args.include_raw === true,
              exclude_mcp_tool_telemetry: args.include_internal !== true,
            }),
          ),
        },
      ],
    }),
  );

  registerTool(
    "event_get",
    {
      event_id: z.string(),
      include_raw: z.boolean().optional(),
    },
    async ({ event_id, include_raw }) => ({
      content: [
        {
          type: "text",
          text: JSON.stringify(
            await store.getEvent(event_id, include_raw !== false),
          ),
        },
      ],
    }),
  );

  registerTool(
    "event_export",
    {
      event_type: z.string().optional(),
      source: z.string().optional(),
      severity: z.string().optional(),
      project_id: z.string().optional(),
      trace_id: z.string().optional(),
      run_id: z.string().optional(),
      text: z.string().optional(),
      since: z.string().optional(),
      until: z.string().optional(),
      limit: z.number().optional(),
      include_raw: z.boolean().optional(),
    },
    async (args) => {
      const chunks: string[] = [];
      const count = await store.exportEvents(
        {
          ...args,
          project_id: await store.resolveProjectId(args.project_id),
          since: parseTime(args.since) ?? args.since,
          until: parseTime(args.until) ?? args.until,
          limit: args.limit ?? 100_000,
          include_raw: args.include_raw === true,
        },
        (s) => chunks.push(s),
      );
      return {
        content: [
          {
            type: "text" as const,
            text: JSON.stringify({
              count,
              events: JSON.parse(chunks.join("\n")),
            }),
          },
        ],
      };
    },
  );

  registerTool(
    "event_watch",
    {
      last_event_id: z.string().optional(),
      event_type: z.string().optional(),
      source: z.string().optional(),
      severity: z.string().optional(),
      project_id: z.string().optional(),
      machine_id: z.string().optional(),
      repo_id: z.string().optional(),
      app_id: z.string().optional(),
      process_id: z.string().optional(),
      run_id: z.string().optional(),
      trace_id: z.string().optional(),
      session_id: z.string().optional(),
      environment: z.string().optional(),
      limit: z.number().optional(),
      include_raw: z.boolean().optional(),
      from_start: z.boolean().optional(),
      include_internal: z.boolean().optional(),
    },
    async (args) => {
      const watchArgs: McpEventWatchArgs = {
        ...args,
        project_id: await store.resolveProjectId(args.project_id),
        limit: args.limit ?? 100,
        include_raw: args.include_raw === true,
        from_start: args.from_start === true,
        include_internal: args.include_internal === true,
      };
      return {
        content: [
          {
            type: "text",
            text: JSON.stringify(await store.watchEvents(watchArgs)),
          },
        ],
      };
    },
  );

  registerTool(
    "test_report_search",
    {
      report_id: z.string().optional(),
      event_id: z.string().optional(),
      project_id: z.string().optional(),
      machine_id: z.string().optional(),
      repo_id: z.string().optional(),
      app_id: z.string().optional(),
      process_id: z.string().optional(),
      run_id: z.string().optional(),
      environment: z.string().optional(),
      source: z.string().optional(),
      parser: z.string().optional(),
      parse_status: z.string().optional(),
      path: z.string().optional(),
      case_status: z.string().optional(),
      outcome: z
        .enum([
          "failed",
          "error",
          "nonpassing",
          "skipped",
          "passed",
          "parse_problem",
        ])
        .optional(),
      min_failures: z.number().optional(),
      min_errors: z.number().optional(),
      min_skipped: z.number().optional(),
      since: z.string().optional(),
      until: z.string().optional(),
      text: z.string().optional(),
      limit: z.number().optional(),
      include_cases: z.boolean().optional(),
    },
    async (args) => ({
      content: [
        {
          type: "text",
          text: JSON.stringify(
            await store.listTestReports({
              ...args,
              project_id: await rid(args.project_id),
              since: parseTime(args.since) ?? args.since,
              until: parseTime(args.until) ?? args.until,
              limit: args.limit ?? 100,
              include_cases: args.include_cases === true,
            }),
          ),
        },
      ],
    }),
  );

  registerTool(
    "test_report_get",
    {
      report_id: z.string(),
      include_cases: z.boolean().optional(),
    },
    async ({ report_id, include_cases }) => ({
      content: [
        {
          type: "text",
          text: JSON.stringify(
            await store.getTestReport(report_id, include_cases !== false),
          ),
        },
      ],
    }),
  );

  registerTool(
    "perf_snapshot",
    {
      project_id: z.string(),
      page_id: z.string().optional(),
    },
    async ({ project_id, page_id }) => {
      const resolved = (await store.resolveProjectId(project_id)) ?? project_id;
      const snap = await store.latestPerfSnapshot(resolved, page_id);
      return {
        content: [
          {
            type: "text",
            text: JSON.stringify(
              snap ? { ...snap, label: scoreLabel(snap.score) } : null,
            ),
          },
        ],
      };
    },
  );

  registerTool(
    "perf_trend",
    {
      project_id: z.string(),
      page_id: z.string().optional(),
      since: z.string().optional(),
      limit: z.number().optional(),
    },
    async ({ project_id, page_id, since, limit }) => {
      const resolved = (await store.resolveProjectId(project_id)) ?? project_id;
      return {
        content: [
          {
            type: "text",
            text: JSON.stringify(
              await store.perfTrend(
                resolved,
                page_id,
                parseTime(since) ?? since,
                limit ?? 50,
              ),
            ),
          },
        ],
      };
    },
  );

  registerTool(
    "scan_status",
    {
      project_id: z.string().optional(),
    },
    async ({ project_id }) => ({
      content: [
        {
          type: "text",
          text: JSON.stringify(await store.listJobs(await rid(project_id))),
        },
      ],
    }),
  );

  registerTool("list_projects", {}, async () => ({
    content: [
      { type: "text", text: JSON.stringify(await store.listProjects()) },
    ],
  }));

  registerTool(
    "list_pages",
    { project_id: z.string() },
    async ({ project_id }) => ({
      content: [
        {
          type: "text",
          text: JSON.stringify(
            await store.listPages((await rid(project_id)) ?? project_id),
          ),
        },
      ],
    }),
  );

  registerTool(
    "list_issues",
    {
      project_id: z.string().optional(),
      status: z.string().optional(),
      limit: z.number().optional(),
    },
    async ({ project_id, status, limit }) => {
      const resolved = await store.resolveProjectId(project_id);
      return {
        content: [
          {
            type: "text",
            text: JSON.stringify(
              await store.listIssues(resolved, status, limit ?? 50),
            ),
          },
        ],
      };
    },
  );

  registerTool(
    "resolve_issue",
    {
      id: z.string(),
      status: z.enum(["open", "resolved", "ignored"]),
    },
    async ({ id, status }) => {
      return {
        content: [
          {
            type: "text",
            text: JSON.stringify(await store.updateIssueStatus(id, status)),
          },
        ],
      };
    },
  );

  registerTool(
    "create_alert_rule",
    {
      project_id: z.string(),
      name: z.string(),
      level: z.string().optional(),
      service: z.string().optional(),
      threshold_count: z.number().optional(),
      window_seconds: z.number().optional(),
      action: z.enum(["webhook", "log"]).optional(),
      webhook_url: z.string().optional(),
    },
    async (args) => {
      const resolved =
        (await store.resolveProjectId(args.project_id)) ?? args.project_id;
      return {
        content: [
          {
            type: "text",
            text: JSON.stringify(
              await store.createAlertRule({ ...args, project_id: resolved }),
            ),
          },
        ],
      };
    },
  );

  registerTool(
    "list_alert_rules",
    {
      project_id: z.string().optional(),
    },
    async ({ project_id }) => {
      const resolved = await store.resolveProjectId(project_id);
      return {
        content: [
          {
            type: "text",
            text: JSON.stringify(await store.listAlertRules(resolved)),
          },
        ],
      };
    },
  );

  registerTool("delete_alert_rule", { id: z.string() }, async ({ id }) => {
    await store.deleteAlertRule(id);
    return { content: [{ type: "text", text: "deleted" }] };
  });

  registerTool("get_health", {}, async () => ({
    content: [{ type: "text", text: JSON.stringify(await store.health()) }],
  }));

  registerTool(
    "log_stats",
    {
      project_id: z
        .string()
        .optional()
        .describe("Project name or ID (scope stats to a project)"),
    },
    async (args) => {
      const rows = await store.listLogs({
        project_id: await rid(args.project_id),
        limit: 100000,
      });
      const total = rows.length;
      const byLevel: Record<string, number> = {};
      const byService: Record<string, number> = {};
      const byDay: Record<string, number> = {};
      const weekAgo = Date.now() - 7 * 24 * 3600 * 1000;
      let oldest: string | null = null;
      let newest: string | null = null;
      for (const r of rows) {
        byLevel[r.level] = (byLevel[r.level] ?? 0) + 1;
        const svc = r.service ?? "-";
        byService[svc] = (byService[svc] ?? 0) + 1;
        if (r.timestamp) {
          if (oldest === null || r.timestamp < oldest) oldest = r.timestamp;
          if (newest === null || r.timestamp > newest) newest = r.timestamp;
          const t = new Date(r.timestamp).getTime();
          if (Number.isFinite(t) && t >= weekAgo) {
            const day = r.timestamp.slice(0, 10);
            byDay[day] = (byDay[day] ?? 0) + 1;
          }
        }
      }
      const errors = (byLevel.error ?? 0) + (byLevel.fatal ?? 0);
      const error_rate_pct =
        total > 0 ? Number.parseFloat(((errors / total) * 100).toFixed(2)) : 0;
      const top_services = Object.entries(byService)
        .sort((a, b) => b[1] - a[1])
        .slice(0, 5)
        .map(([service, c]) => ({ service, c }));
      const last_7_days = Object.entries(byDay)
        .sort((a, b) => a[0].localeCompare(b[0]))
        .map(([day, c]) => ({ day, c }));
      return {
        content: [
          {
            type: "text" as const,
            text: JSON.stringify({
              total,
              oldest,
              newest,
              by_level: byLevel,
              top_services,
              last_7_days,
              error_rate_pct,
            }),
          },
        ],
      };
    },
  );

  registerTrackedTool(
    "send_feedback",
    "Send feedback about this service",
    {
      message: z.string(),
      email: z.string().optional(),
      category: z.enum(["bug", "feature", "general"]).optional(),
    },
    async (params) => {
      try {
        await store.recordFeedback(
          params.message,
          params.email || null,
          params.category || "general",
          PACKAGE_VERSION,
        );
        return {
          content: [
            { type: "text" as const, text: "Feedback saved. Thank you!" },
          ],
        };
      } catch (e) {
        return {
          content: [{ type: "text" as const, text: String(e) }],
          isError: true,
        };
      }
    },
  );

  function recordMcpToolCall(
    toolName: string,
    args: unknown,
    result: unknown,
    error: unknown,
    startedAt: number,
  ): void {
    const durationMs = Math.max(0, Math.round(performance.now() - startedAt));
    const status = error ? "error" : isMcpErrorResult(result) ? "error" : "ok";
    const argsSummary = summarizeMcpArguments(args);
    const resultSummary = summarizeMcpResult(result);
    try {
      telemetryStore?.ingestUniversalEvent({
        type: "agent",
        source: "mcp",
        severity: status === "ok" ? "info" : "error",
        privacy: "internal",
        message: `MCP tool ${toolName} ${status === "ok" ? "completed" : "failed"}`,
        body: {
          mcp: {
            tool_call: {
              tool_name: toolName,
              status,
              duration_ms: durationMs,
              arguments: argsSummary,
              result: resultSummary,
              error: error ? summarizeError(error) : null,
            },
          },
        },
        attributes: {
          category: "mcp_tool_call",
          tool_name: toolName,
          status,
          duration_ms: durationMs,
          argument_keys: argsSummary.keys.join(","),
          argument_count: argsSummary.keys.length,
          result_content_count: resultSummary.content_count,
          result_text_length: resultSummary.text_length,
        },
      });
    } catch {
      // Telemetry must not change MCP tool behavior.
    }
  }

  interface McpArgumentSummary {
    keys: string[];
    shape: unknown;
    values_captured: boolean;
  }

  interface McpResultSummary {
    is_error: boolean;
    content_count: number;
    content_types: string[];
    text_length: number;
  }

  function summarizeMcpArguments(args: unknown): McpArgumentSummary {
    const keys = isRecord(args) ? Object.keys(args).sort() : [];
    return {
      keys,
      shape: summarizeShape(args),
      values_captured: false,
    };
  }

  function summarizeMcpResult(result: unknown): McpResultSummary {
    if (!isRecord(result))
      return {
        is_error: false,
        content_count: 0,
        content_types: [],
        text_length: 0,
      };
    const content = Array.isArray(result.content) ? result.content : [];
    let textLength = 0;
    const types = new Set<string>();
    for (const item of content) {
      if (!isRecord(item)) continue;
      if (typeof item.type === "string") types.add(item.type);
      if (typeof item.text === "string") textLength += item.text.length;
    }
    return {
      is_error: result.isError === true,
      content_count: content.length,
      content_types: [...types].sort(),
      text_length: textLength,
    };
  }

  function summarizeShape(value: unknown, depth = 0): unknown {
    if (value === null) return { type: "null" };
    if (typeof value === "string")
      return { type: "string", length: value.length };
    const valueType = typeof value;
    if (
      valueType === "number" ||
      valueType === "boolean" ||
      valueType === "bigint"
    )
      return { type: valueType };
    if (Array.isArray(value))
      return {
        type: "array",
        length: value.length,
        items: depth >= 2 ? undefined : summarizeArrayItems(value, depth + 1),
      };
    if (isRecord(value)) {
      const keys = Object.keys(value).sort();
      return {
        type: "object",
        keys: depth === 0 ? keys : undefined,
        field_count: keys.length,
        fields:
          depth >= 1
            ? undefined
            : Object.fromEntries(
                keys
                  .slice(0, 25)
                  .map((key) => [key, summarizeShape(value[key], depth + 1)]),
              ),
      };
    }
    return { type: valueType };
  }

  function summarizeArrayItems(values: unknown[], depth: number): unknown[] {
    return values.slice(0, 10).map((value) => summarizeShape(value, depth));
  }

  function summarizeError(error: unknown): Record<string, unknown> {
    const message = error instanceof Error ? error.message : String(error);
    return {
      name: error instanceof Error ? error.name : typeof error,
      message_length: message.length,
      message_present: message.length > 0,
    };
  }

  function isMcpErrorResult(value: unknown): boolean {
    return isRecord(value) && value.isError === true;
  }

  function isRecord(value: unknown): value is Record<string, unknown> {
    return Boolean(value) && typeof value === "object" && !Array.isArray(value);
  }

  // --- Agent Tools ---
  // register_agent / heartbeat / set_focus / list_agents via the local,
  // persistent SQLite-backed registry in src/mcp/agent-registry.ts (inlined
  // from the deleted @hasna/agent-registry package, hasna/apps#1529).
  // `send_feedback` stays local below since it persists into logs'
  // own `feedback` table with a category enum. Lifecycle activity is
  // mirrored into logs' own durable event store via `agentRegistryEvents`.
  registerAgentTools(server, {
    service: "logs",
    events: agentRegistryEvents,
  });

  return server;
}

async function main(): Promise<void> {
  const { isHttpMode, isStdioMode, resolveMcpHttpPort, startMcpHttpServer } =
    await import("./http.ts");

  if (isStdioMode() || !isHttpMode()) {
    const server = buildServer();
    const transport = new StdioServerTransport();
    await server.connect(transport);
    return;
  }

  // Default: shared Streamable HTTP server (one process per MCP, many agents).
  const handle = await startMcpHttpServer(buildServer, {
    port: resolveMcpHttpPort(),
  });
  process.on(
    "SIGINT",
    () => void handle.close().finally(() => process.exit(0)),
  );
  process.on(
    "SIGTERM",
    () => void handle.close().finally(() => process.exit(0)),
  );
}

if (import.meta.main) {
  main().catch((err) => {
    console.error(err);
    process.exit(1);
  });
}
