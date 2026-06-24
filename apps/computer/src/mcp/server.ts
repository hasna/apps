#!/usr/bin/env bun
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { timingSafeEqual } from "node:crypto";
import { z } from "zod";
import { resumeTask, runTask } from "../agent/loop.js";
import { saveScreenshotToFile, getScreenSize } from "../drivers/mac/screenshot.js";
import { executeComputerAction, formatPolicyRejection, guardTerminalCommandPolicy } from "../agent/policy.js";
import { loadConfig } from "../lib/config.js";
import { listSessions, getActionLogs, deleteSession, getStats, searchSessions, searchActionLogs, logAuditEvent, resolveSessionId } from "../db/index.js";
import { registerAgent, heartbeat as agentHeartbeat, setFocus, listAgents } from "../db/agents.js";
import { queryAccessibilityTree, summarizeAccessibilityTree } from "../drivers/mac/accessibility.js";
import { getAppDriver, listAppDrivers } from "../apps/registry.js";
import { parseGrid, parseTabsSpec } from "../apps/ghostty/applescript.js";
import {
  assertStorageRemoteAllowed,
  getStorageStatus,
  storagePull,
  storagePush,
  storageSync,
} from "../db/storage-sync.js";
import { cancelSession, clearEmergencyStop, getEmergencyStopSignal, pauseSession, requestEmergencyStop } from "../agent/control.js";
import { VERSION } from "../version.js";
import {
  DEFAULT_DETAIL_LOG_LIMIT,
  DEFAULT_ROW_LIMIT,
  pageSlice,
  parseCursor,
  parseLimit,
  renderSearchResults,
  renderSessionDetail,
  renderSessionList,
  renderStatsSummary,
  truncateText,
} from "../cli/output.js";

function storageResult(value: unknown) {
  return { content: [{ type: "text" as const, text: JSON.stringify(value, null, 2) }] };
}

function textResult(text: string) {
  return { content: [{ type: "text" as const, text }] };
}

function jsonResult(value: unknown) {
  return textResult(JSON.stringify(value, null, 2));
}

const OUTPUT_FORMAT_SCHEMA = z.enum(["summary", "json"]).default("summary");

function renderStorageStatusSummary(
  info: ReturnType<typeof getStorageStatus>,
  options: { verbose?: boolean; limit: number; cursor: number },
): string {
  const lines = [
    `Storage configured: ${info.configured ? "yes" : "no"}`,
    `Mode: ${info.mode} | Active env: ${info.activeEnv ?? "none"} | Service: ${info.service}`,
    `Tables: ${info.tables.length} (${info.tables.join(", ")})`,
  ];
  if (info.sync.length === 0) {
    lines.push("Sync: no local sync history");
  } else {
    const visible = options.verbose ? info.sync : info.sync.slice(options.cursor, options.cursor + options.limit);
    lines.push(`Sync history (${visible.length}/${info.sync.length}${options.verbose ? ", verbose" : ""})`);
    for (const entry of visible) {
      lines.push(`  ${entry.table_name} ${entry.direction}: ${entry.last_synced_at ?? "never"}`);
    }
    if (!options.verbose && info.sync.length > options.cursor + visible.length) {
      lines.push(`More sync history available: use cursor ${options.cursor + visible.length}, limit ${options.limit}, or verbose true.`);
    }
  }
  lines.push("Full storage state: call with `format: \"json\"`.");
  return lines.join("\n");
}

async function guardedStorageMutation(capability: string, run: () => Promise<unknown>) {
  try {
    assertStorageRemoteAllowed();
    await logAuditEvent({
      event: "storage.policy_decision",
      transport: "mcp",
      capability,
      decision: "allowed",
    });
    return storageResult(await run());
  } catch (error) {
    const reason = error instanceof Error ? error.message : String(error);
    await logAuditEvent({
      event: "storage.policy_decision",
      transport: "mcp",
      capability,
      decision: "denied",
      reason,
    });
    return storageResult({ ok: false, error: reason });
  }
}
import { SESSION_STATUSES, type ActionLog, type Provider, type DriverAction, type MouseButton, type Session } from "../types/index.js";

async function executeMcpAction(action: DriverAction) {
  return executeComputerAction(action, {
    safety: loadConfig().safety,
    transport: "mcp",
    capability: `computer.${action.type}`,
  });
}

export function buildServer(): McpServer {
  const server = new McpServer({
    name: "computer",
    version: VERSION,
  });

// ── computer_run_task ────────────────────────────────────────────────
server.tool(
  "computer_run_task",
  "Run a computer use task — the AI sees your screen and controls mouse/keyboard to complete it",
  {
    task: z.string().describe("Natural language description of what to do"),
    provider: z.enum(["anthropic", "openai"]).default("anthropic").describe("AI provider"),
    model: z.string().optional().describe("Specific model to use"),
    max_steps: z.number().default(50).describe("Maximum steps before stopping"),
    save_screenshots: z.boolean().default(false).describe("Save screenshots to disk"),
    dry_run: z.boolean().default(false).describe("Plan actions without executing them"),
    format: OUTPUT_FORMAT_SCHEMA.describe("summary is compact; json returns the full session record"),
  },
  async (params) => {
    const session = await runTask({
      task: params.task,
      provider: params.provider as Provider,
      model: params.model,
      maxSteps: params.max_steps,
      saveScreenshots: params.save_screenshots,
      dryRun: params.dry_run,
    });

    if (params.format === "json") return jsonResult(session);
    return textResult(renderSessionDetail(session, [], { limit: 0 })
      .replace("Full machine-readable detail: use `computer session <id> --json`.", "Full machine-readable detail: call with `format: \"json\"`."));
  }
);

// ── computer_screenshot ──────────────────────────────────────────────
server.tool(
  "computer_screenshot",
  "Capture a screenshot of the current screen",
  {
    save_to: z.string().optional().describe("Optional file path to save the screenshot"),
  },
  async (params) => {
    const result = await executeMcpAction({ type: "screenshot" });
    if (!result.success || !result.screenshot) {
      return { content: [{ type: "text", text: `Screenshot failed: ${result.error ?? "policy blocked"}` }] };
    }
    const ss = result.screenshot;

    if (params.save_to) {
      const dir = params.save_to.substring(0, params.save_to.lastIndexOf("/"));
      const file = params.save_to.substring(params.save_to.lastIndexOf("/") + 1);
      await saveScreenshotToFile(ss, dir, file);
    }

    return {
      content: [
        {
          type: "image",
          data: ss.base64,
          mimeType: "image/png",
        },
        {
          type: "text",
          text: `Screen: ${ss.size.width}x${ss.size.height}`,
        },
      ],
    };
  }
);

// ── computer_click ───────────────────────────────────────────────────
server.tool(
  "computer_click",
  "Click at a specific screen coordinate",
  {
    x: z.number().describe("X coordinate"),
    y: z.number().describe("Y coordinate"),
    button: z.enum(["left", "right", "middle"]).default("left").describe("Mouse button"),
    count: z.number().default(1).describe("Click count (1=single, 2=double, 3=triple)"),
  },
  async (params) => {
    const result = await executeMcpAction({
      type: "click",
      point: { x: params.x, y: params.y },
      button: params.button as MouseButton,
      count: params.count,
    });

    const content: any[] = [{ type: "text", text: result.success ? "Click executed" : `Click failed: ${result.error}` }];
    if (result.screenshot) {
      content.push({ type: "image", data: result.screenshot.base64, mimeType: "image/png" });
    }
    return { content };
  }
);

// ── computer_type ────────────────────────────────────────────────────
server.tool(
  "computer_type",
  "Type text using the keyboard",
  {
    text: z.string().describe("Text to type"),
  },
  async (params) => {
    const result = await executeMcpAction({ type: "type", text: params.text });
    const content: any[] = [{ type: "text", text: result.success ? "Text typed" : `Type failed: ${result.error}` }];
    if (result.screenshot) {
      content.push({ type: "image", data: result.screenshot.base64, mimeType: "image/png" });
    }
    return { content };
  }
);

// ── computer_key ─────────────────────────────────────────────────────
server.tool(
  "computer_key",
  "Press a key or key combination (e.g. 'enter', 'cmd+c', 'ctrl+shift+a')",
  {
    keys: z.string().describe("Key or combination to press"),
  },
  async (params) => {
    const result = await executeMcpAction({ type: "key", keys: params.keys });
    const content: any[] = [{ type: "text", text: result.success ? "Key pressed" : `Key failed: ${result.error}` }];
    if (result.screenshot) {
      content.push({ type: "image", data: result.screenshot.base64, mimeType: "image/png" });
    }
    return { content };
  }
);

// ── computer_scroll ──────────────────────────────────────────────────
server.tool(
  "computer_scroll",
  "Scroll at a specific position",
  {
    x: z.number().describe("X coordinate"),
    y: z.number().describe("Y coordinate"),
    direction: z.enum(["up", "down"]).describe("Scroll direction"),
    amount: z.number().default(3).describe("Scroll amount"),
  },
  async (params) => {
    const dy = params.direction === "down" ? params.amount : -params.amount;
    const result = await executeMcpAction({
      type: "scroll",
      point: { x: params.x, y: params.y },
      deltaX: 0,
      deltaY: dy,
    });
    const content: any[] = [{ type: "text", text: result.success ? "Scrolled" : `Scroll failed: ${result.error}` }];
    if (result.screenshot) {
      content.push({ type: "image", data: result.screenshot.base64, mimeType: "image/png" });
    }
    return { content };
  }
);

// ── computer_mouse_move ──────────────────────────────────────────────
server.tool(
  "computer_mouse_move",
  "Move the mouse to a position",
  {
    x: z.number().describe("X coordinate"),
    y: z.number().describe("Y coordinate"),
  },
  async (params) => {
    const result = await executeMcpAction({ type: "mouse_move", point: { x: params.x, y: params.y } });
    return { content: [{ type: "text", text: result.success ? "Mouse moved" : `Move failed: ${result.error}` }] };
  }
);

// ── computer_open_url ────────────────────────────────────────────────
server.tool(
  "computer_open_url",
  "Open a URL in the default browser",
  {
    url: z.string().describe("URL to open"),
  },
  async (params) => {
    const result = await executeMcpAction({ type: "open_url", url: params.url });
    const content: any[] = [{ type: "text", text: result.success ? "URL opened" : `Open failed: ${result.error}` }];
    if (result.screenshot) {
      content.push({ type: "image", data: result.screenshot.base64, mimeType: "image/png" });
    }
    return { content };
  }
);

// ── computer_open_app ────────────────────────────────────────────────
server.tool(
  "computer_open_app",
  "Open a macOS application. Apps with a registered driver (see computer_list_apps) support deterministic orchestration: pane grids, multiple tabs, a command per pane, working directory, and maximize. Other apps open normally.",
  {
    app: z.string().optional().describe("Application or driver name (e.g. 'ghostty', 'Safari', 'Slack')"),
    name: z.string().optional().describe("Deprecated alias for `app`"),
    grid: z.string().optional().describe('Pane grid RxC, e.g. "2x2" (driver apps only)'),
    tabs: z.string().optional().describe('Comma-separated grid specs, one per tab, e.g. "2x2,1x2,1x2" (driver apps only)'),
    run: z.array(z.string()).optional().describe("Commands per pane in row-major order across tabs (driver apps only)"),
    all: z.boolean().default(false).describe("Run the single `run` command in every pane"),
    dir: z.string().optional().describe("Working directory — every pane cds here first"),
    max: z.boolean().default(false).describe("Maximize the new window (not native fullscreen)"),
    approved: z.boolean().default(false).describe("Deprecated. Terminal command execution requires approval_token."),
    approval_token: z.string().optional().describe("Operator-provided terminal approval token"),
  },
  async (params) => {
    const appName = params.app ?? params.name;
    if (!appName) {
      return { content: [{ type: "text", text: "Missing required parameter: app" }] };
    }

    const driver = getAppDriver(appName);
    if (driver) {
      try {
        const terminalDecision = await guardTerminalCommandPolicy(
          { app: appName, run: params.run, dir: params.dir },
          {
            approved: validateTerminalApprovalToken(params.approval_token),
            transport: "mcp",
            capability: "computer.terminal",
            metadata: { tool: "computer_open_app", app: appName, command_count: params.run?.length ?? 0 },
          },
        );
        if (!terminalDecision.allowed) {
          return { content: [{ type: "text", text: formatPolicyRejection(terminalDecision) }] };
        }
        const result = await driver.open({
          grid: params.grid ? parseGrid(params.grid) : undefined,
          tabs: params.tabs ? parseTabsSpec(params.tabs) : undefined,
          run: params.run,
          all: params.all,
          dir: params.dir,
          max: params.max,
          terminalApproval: {
            approved: validateTerminalApprovalToken(params.approval_token),
            audit: false,
            transport: "mcp",
            metadata: { tool: "computer_open_app", app: appName, command_count: params.run?.length ?? 0 },
            signal: getEmergencyStopSignal(),
          },
        });
        if (result.transcript) {
          await logAuditEvent({
            event: "terminal.transcript_created",
            transport: "mcp",
            capability: "computer.terminal",
            action_type: "terminal_command",
            action_data: {
              app: appName,
              transcript_id: result.transcript.id,
              command_count: result.transcript.commandCount,
              redacted: true,
            },
            decision: "created",
            metadata: {
              tool: "computer_open_app",
              manifest_path: result.transcript.manifestPath,
              pane_count: result.transcript.panes.length,
            },
          });
        }
        const transcriptNote = result.transcript
          ? `\nTranscript manifest: ${result.transcript.manifestPath}`
          : "";
        return { content: [{ type: "text", text: `${result.message}${transcriptNote}` }] };
      } catch (err) {
        return { content: [{ type: "text", text: `Open failed: ${err instanceof Error ? err.message : err}` }] };
      }
    }

    if (params.grid || params.tabs || params.run?.length || params.dir) {
      return {
        content: [
          { type: "text", text: `No app driver registered for "${appName}" — grid/tabs/run/dir need a driver (see computer_list_apps). Opening normally requires dropping those params.` },
        ],
      };
    }

    const result = await executeMcpAction({ type: "open_app", name: appName });
    const content: any[] = [{ type: "text", text: result.success ? `Opened ${appName}` : `Open failed: ${result.error}` }];
    if (result.screenshot) {
      content.push({ type: "image", data: result.screenshot.base64, mimeType: "image/png" });
    }
    return { content };
  }
);

// ── computer_list_apps ───────────────────────────────────────────────
server.tool(
  "computer_list_apps",
  "List registered app drivers (deterministic orchestration) and their availability on this machine",
  {},
  async () => {
    const apps = listAppDrivers().map((driver) => {
      const availability = driver.available();
      return {
        name: driver.name,
        description: driver.description,
        available: availability.available,
        ...(availability.reason ? { reason: availability.reason } : {}),
      };
    });
    return { content: [{ type: "text", text: JSON.stringify(apps, null, 2) }] };
  }
);

// ── computer_screen_size ─────────────────────────────────────────────
server.tool(
  "computer_screen_size",
  "Get the current screen resolution",
  {},
  async () => {
    const size = await getScreenSize();
    return { content: [{ type: "text", text: `${size.width}x${size.height}` }] };
  }
);

// ── computer_list_sessions ───────────────────────────────────────────
server.tool(
  "computer_list_sessions",
  "List past computer use sessions",
  {
    limit: z.number().default(DEFAULT_ROW_LIMIT).describe("Max sessions to return"),
    cursor: z.number().default(0).describe("Zero-based result offset for pagination"),
    status: z.enum(SESSION_STATUSES).optional().describe("Filter by status"),
    format: OUTPUT_FORMAT_SCHEMA.describe("summary is compact; json returns the full session records"),
  },
  async (params) => {
    const limit = parseLimit(params.limit);
    const cursor = parseCursor(params.cursor);
    const result = listSessions({ limit: limit + 1, offset: cursor, status: params.status as any });
    const { page: sessions, hasMore, nextCursor } = pageSlice(result, limit, cursor);
    if (params.format === "json") {
      return jsonResult({
        sessions,
        limit,
        cursor,
        has_more: hasMore,
        next_cursor: hasMore ? nextCursor : null,
      });
    }
    return textResult(renderSessionList(sessions, {
      limit,
      cursor,
      hasMore,
      nextCursor,
      detailHint: "Details: call `computer_get_session` with `verbose: true`; full data: use `format: \"json\"`.",
    }));
  }
);

// ── computer_get_session ─────────────────────────────────────────────
server.tool(
  "computer_get_session",
  "Get details of a specific session including action log",
  {
    id: z.string().describe("Session ID"),
    verbose: z.boolean().default(false).describe("Show all action-log rows in summary format"),
    limit: z.number().default(DEFAULT_DETAIL_LOG_LIMIT).describe("Action-log rows to include when verbose is false"),
    cursor: z.number().default(0).describe("Zero-based action-log offset for pagination"),
    format: OUTPUT_FORMAT_SCHEMA.describe("summary is compact; json returns the full session and action logs"),
  },
  async (params) => {
    const session = resolveSessionId(params.id);
    if (!session) return textResult("Session not found");

    const logs = getActionLogs(session.id);
    const limit = parseLimit(params.limit, DEFAULT_DETAIL_LOG_LIMIT);
    const cursor = parseCursor(params.cursor);
    const hasMore = !params.verbose && logs.length > cursor + limit;
    const nextCursor = cursor + Math.min(limit, Math.max(0, logs.length - cursor));
    if (params.format === "json") {
      return jsonResult({
        session,
        action_logs: logs,
        action_log_count: logs.length,
        has_more: false,
        next_cursor: null,
      });
    }
    return textResult(renderSessionDetail(session, logs, {
      verbose: params.verbose,
      limit,
      cursor,
      hasMore,
      nextCursor,
    }).replace("Full machine-readable detail: use `computer session <id> --json`.", "Full machine-readable detail: call this tool with `format: \"json\"`."));
  }
);

// ── computer_delete_session ──────────────────────────────────────────
server.tool(
  "computer_delete_session",
  "Delete a session and its action logs",
  {
    id: z.string().describe("Session ID"),
  },
  async (params) => {
    const session = resolveSessionId(params.id);
    const deleted = session ? deleteSession(session.id) : false;
    await logAuditEvent({
      event: "session.delete",
      transport: "mcp",
      capability: "computer.delete_session",
      decision: deleted ? "deleted" : "not_found",
      metadata: { session_id: session?.id ?? params.id },
    });
    return { content: [{ type: "text", text: deleted ? "Session deleted" : "Session not found" }] };
  }
);

// ── computer_search ──────────────────────────────────────────────────
server.tool(
  "computer_search",
  "Full-text search across sessions (by task) and action logs (by reasoning)",
  {
    query: z.string().describe("Search query"),
    scope: z.enum(["sessions", "actions", "both"]).default("both").describe("Where to search"),
    limit: z.number().default(DEFAULT_ROW_LIMIT).describe("Max results per selected scope"),
    cursor: z.number().default(0).describe("Zero-based result offset for pagination"),
    format: OUTPUT_FORMAT_SCHEMA.describe("summary is compact; json returns the full result records"),
  },
  async (params) => {
    const limit = parseLimit(params.limit);
    const cursor = parseCursor(params.cursor);
    let sessions: Session[] | undefined;
    let actionLogs: ActionLog[] | undefined;
    if (params.scope === "sessions" || params.scope === "both") {
      sessions = searchSessions(params.query, limit + 1, cursor);
    }
    if (params.scope === "actions" || params.scope === "both") {
      actionLogs = searchActionLogs(params.query, limit + 1, cursor);
    }
    if (params.format === "json") {
      const hasMore = Boolean((sessions && sessions.length > limit) || (actionLogs && actionLogs.length > limit));
      return jsonResult({
        sessions: sessions ? sessions.slice(0, limit) : undefined,
        action_logs: actionLogs ? actionLogs.slice(0, limit) : undefined,
        limit,
        cursor,
        has_more: hasMore,
        next_cursor: hasMore ? cursor + limit : null,
      });
    }
    const sessionPage = sessions ? pageSlice(sessions, limit, cursor) : { page: [] as Session[], hasMore: false, nextCursor: cursor };
    const actionPage = actionLogs ? pageSlice(actionLogs, limit, cursor) : { page: [] as ActionLog[], hasMore: false, nextCursor: cursor };
    return textResult(renderSearchResults(
      { sessions: sessionPage.page, actionLogs: actionPage.page },
      {
        query: params.query,
        limit,
        cursor,
        hasMore: sessionPage.hasMore || actionPage.hasMore,
        nextCursor: Math.max(sessionPage.nextCursor, actionPage.nextCursor),
      },
    ).replace("Details: use `computer session <id> --verbose`; use `--json` for full search results.", "Details: call `computer_get_session`; use `format: \"json\"` for full search results."));
  }
);

// ── computer_stats ───────────────────────────────────────────────────
server.tool(
  "computer_stats",
  "Get usage statistics for computer use",
  {
    format: OUTPUT_FORMAT_SCHEMA.describe("summary is compact; json returns the full stats object"),
  },
  async (params) => {
    const stats = getStats();
    if (params.format === "json") return jsonResult(stats);
    return textResult(renderStatsSummary(stats));
  }
);

// ── computer_emergency_stop ─────────────────────────────────────────
server.tool(
  "computer_emergency_stop",
  "Activate the process-local emergency stop. New computer actions are blocked until cleared.",
  {
    reason: z.string().optional().describe("Reason for activating the emergency stop"),
  },
  async (params) => {
    const state = requestEmergencyStop(params.reason);
    await logAuditEvent({
      event: "run_control.emergency_stop",
      transport: "mcp",
      capability: "computer.emergency_stop",
      decision: "requested",
      reason: params.reason,
    });
    return { content: [{ type: "text", text: JSON.stringify(state, null, 2) }] };
  }
);

server.tool(
  "computer_clear_emergency_stop",
  "Clear the process-local emergency stop after operator review.",
  {},
  async () => {
    const state = clearEmergencyStop();
    await logAuditEvent({
      event: "run_control.clear_emergency_stop",
      transport: "mcp",
      capability: "computer.clear_emergency_stop",
      decision: "cleared",
    });
    return { content: [{ type: "text", text: JSON.stringify(state, null, 2) }] };
  }
);

server.tool(
  "computer_cancel_session",
  "Request cancellation for an active in-process computer use session",
  {
    id: z.string().describe("Session ID to cancel"),
    reason: z.string().optional().describe("Cancellation reason"),
  },
  async (params) => {
    cancelSession(params.id, params.reason);
    await logAuditEvent({
      event: "run_control.cancel_session",
      transport: "mcp",
      capability: "computer.cancel_session",
      decision: "requested",
      reason: params.reason,
      metadata: { session_id: params.id },
    });
    return { content: [{ type: "text", text: JSON.stringify({ cancelled: true, id: params.id }, null, 2) }] };
  }
);

server.tool(
  "computer_pause_session",
  "Pause an active computer use session before its next action",
  {
    id: z.string().describe("Session ID to pause"),
    reason: z.string().optional().describe("Pause reason"),
  },
  async (params) => {
    const state = pauseSession(params.id, params.reason);
    await logAuditEvent({
      event: "run_control.pause_session",
      transport: "mcp",
      capability: "computer.pause_session",
      decision: "requested",
      reason: params.reason,
      metadata: { session_id: params.id },
    });
    return { content: [{ type: "text", text: JSON.stringify(state, null, 2) }] };
  }
);

server.tool(
  "computer_resume_session",
  "Resume a paused computer use session from persisted state",
  {
    id: z.string().describe("Paused session ID to resume"),
    provider: z.enum(["anthropic", "openai"]).optional().describe("AI provider override"),
    model: z.string().optional().describe("Model override"),
    max_steps: z.number().optional().describe("Maximum total steps before stopping"),
    dry_run: z.boolean().default(false).describe("Plan actions without executing them"),
    format: OUTPUT_FORMAT_SCHEMA.describe("summary is compact; json returns the full resumed session record"),
  },
  async (params) => {
    const session = await resumeTask(params.id, {
      provider: params.provider as Provider | undefined,
      model: params.model,
      maxSteps: params.max_steps,
      dryRun: params.dry_run,
    });
    await logAuditEvent({
      event: "run_control.resume_session",
      transport: "mcp",
      capability: "computer.resume_session",
      decision: session.status,
      metadata: { session_id: params.id },
    });
    if (params.format === "json") return jsonResult(session);
    return textResult(renderSessionDetail(session, [], { limit: 0 })
      .replace("Full machine-readable detail: use `computer session <id> --json`.", "Full machine-readable detail: call with `format: \"json\"`."));
  }
);

// ── computer_accessibility ───────────────────────────────────────────
server.tool(
  "computer_accessibility",
  "Query the macOS accessibility tree — get structured UI elements (buttons, fields, labels) with positions. Much more precise than pixel-guessing from screenshots.",
  {
    app: z.string().optional().describe("App name to query (default: frontmost)"),
    focused_only: z.boolean().default(false).describe("Only get focused element's subtree"),
    depth: z.number().default(3).describe("Max tree traversal depth"),
    format: z.enum(["json", "summary"]).default("summary").describe("Output format"),
  },
  async (params) => {
    try {
      const elements = await queryAccessibilityTree({
        app: params.app,
        focusedOnly: params.focused_only,
        depth: params.depth,
      });
      const text = params.format === "json"
        ? JSON.stringify(elements, null, 2)
        : summarizeAccessibilityTree(elements);
      return { content: [{ type: "text", text }] };
    } catch (err) {
      return { content: [{ type: "text", text: `Accessibility query failed: ${err instanceof Error ? err.message : err}` }] };
    }
  }
);

// ── computer_register_agent ──────────────────────────────────────────
server.tool(
  "computer_register_agent",
  "Register an agent for multi-agent coordination",
  {
    name: z.string().describe("Agent name"),
    description: z.string().optional().describe("Agent description"),
    capabilities: z.array(z.string()).optional().describe("Agent capabilities"),
  },
  async (params) => {
    const agent = registerAgent(params);
    return { content: [{ type: "text", text: JSON.stringify(agent, null, 2) }] };
  }
);

// ── computer_heartbeat ───────────────────────────────────────────────
server.tool(
  "computer_heartbeat",
  "Send a heartbeat to mark an agent as active",
  {
    agent_id: z.string().describe("Agent ID"),
  },
  async (params) => {
    const ok = agentHeartbeat(params.agent_id);
    return { content: [{ type: "text", text: ok ? "Heartbeat received" : "Agent not found" }] };
  }
);

// ── computer_set_focus ───────────────────────────────────────────────
server.tool(
  "computer_set_focus",
  "Set what an agent is currently focused on",
  {
    agent_id: z.string().describe("Agent ID"),
    focus: z.string().describe("Current focus description"),
  },
  async (params) => {
    const ok = setFocus(params.agent_id, params.focus);
    return { content: [{ type: "text", text: ok ? "Focus updated" : "Agent not found" }] };
  }
);

// ── computer_list_agents ─────────────────────────────────────────────
server.tool(
  "computer_list_agents",
  "List all registered agents",
  {
    limit: z.number().default(DEFAULT_ROW_LIMIT).describe("Max agents to return"),
    cursor: z.number().default(0).describe("Zero-based result offset for pagination"),
    format: OUTPUT_FORMAT_SCHEMA.describe("summary is compact; json returns the full agent records"),
  },
  async (params) => {
    const limit = parseLimit(params.limit);
    const cursor = parseCursor(params.cursor);
    const agents = listAgents();
    if (params.format === "json") return jsonResult(agents);
    const visible = agents.slice(cursor, cursor + limit);
    const lines = ["Agents", "id       last heartbeat        focus"];
    for (const agent of visible) {
      lines.push(`${agent.id.slice(0, 8).padEnd(8)} ${agent.last_heartbeat.slice(0, 19).padEnd(19)} ${truncateText(agent.focus ?? agent.description ?? agent.name, 100)}`);
    }
    if (visible.length === 0) lines.push("No agents registered.");
    if (agents.length > cursor + visible.length) lines.push(`More agents available: use cursor ${cursor + visible.length} and limit ${limit}.`);
    lines.push("Full agent records: call with `format: \"json\"`.");
    return textResult(lines.join("\n"));
  }
);

  // ── Storage tools ───────────────────────────────────────────────────
  server.tool(
    "storage_status",
    "Show computer storage sync configuration and local sync history",
    {
      format: OUTPUT_FORMAT_SCHEMA.describe("summary is compact; json returns the full storage status object"),
      verbose: z.boolean().default(false).describe("Show all sync history rows in summary format"),
      limit: z.number().default(DEFAULT_ROW_LIMIT).describe("Sync history rows to include when verbose is false"),
      cursor: z.number().default(0).describe("Zero-based sync history offset for pagination"),
    },
    async (params) => {
      const info = getStorageStatus();
      if (params.format === "json") return storageResult(info);
      return textResult(renderStorageStatusSummary(info, {
        verbose: params.verbose,
        limit: parseLimit(params.limit),
        cursor: parseCursor(params.cursor),
      }));
    },
  );

  server.tool(
    "storage_push",
    "Push local computer data to storage PostgreSQL",
    { tables: z.array(z.string()).optional() },
    async ({ tables }) => guardedStorageMutation(
      "computer.storage_push",
      () => storagePush(tables ? { tables } : undefined),
    ),
  );

  server.tool(
    "storage_pull",
    "Pull computer data from storage PostgreSQL to local SQLite",
    { tables: z.array(z.string()).optional() },
    async ({ tables }) => guardedStorageMutation(
      "computer.storage_pull",
      () => storagePull(tables ? { tables } : undefined),
    ),
  );

  server.tool(
    "storage_sync",
    "Bidirectional computer sync: pull then push",
    { tables: z.array(z.string()).optional() },
    async ({ tables }) => guardedStorageMutation(
      "computer.storage_sync",
      () => storageSync(tables ? { tables } : undefined),
    ),
  );

  return server;
}

function validateTerminalApprovalToken(token?: string): boolean {
  const expected = process.env["COMPUTER_TERMINAL_APPROVAL_TOKEN"];
  if (!expected || !token) return false;
  const expectedBuffer = Buffer.from(expected);
  const tokenBuffer = Buffer.from(token);
  if (expectedBuffer.length !== tokenBuffer.length) return false;
  return timingSafeEqual(expectedBuffer, tokenBuffer);
}
