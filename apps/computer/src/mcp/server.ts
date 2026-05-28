#!/usr/bin/env bun
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import { runTask } from "../agent/loop.js";
import { captureScreenshot, saveScreenshotToFile, getScreenSize } from "../drivers/mac/screenshot.js";
import { executeAction } from "../drivers/mac/input.js";
import { listSessions, getSession, getActionLogs, deleteSession, getStats, searchSessions, searchActionLogs } from "../db/index.js";
import { registerAgent, heartbeat as agentHeartbeat, setFocus, listAgents } from "../db/agents.js";
import { queryAccessibilityTree, summarizeAccessibilityTree } from "../drivers/mac/accessibility.js";
import { registerCloudTools } from "@hasna/cloud";
import type { Provider, DriverAction, MouseButton } from "../types/index.js";

export function buildServer(): McpServer {
  const server = new McpServer({
    name: "computer",
    version: "0.1.0",
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

    return {
      content: [
        {
          type: "text",
          text: JSON.stringify(session, null, 2),
        },
      ],
    };
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
    const ss = await captureScreenshot();

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
    const result = await executeAction({
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
    const result = await executeAction({ type: "type", text: params.text });
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
    const result = await executeAction({ type: "key", keys: params.keys });
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
    const result = await executeAction({
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
    const result = await executeAction({ type: "mouse_move", point: { x: params.x, y: params.y } });
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
    const result = await executeAction({ type: "open_url", url: params.url });
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
  "Open a macOS application by name",
  {
    name: z.string().describe("Application name (e.g. 'Safari', 'Terminal', 'Slack')"),
  },
  async (params) => {
    const result = await executeAction({ type: "open_app", name: params.name });
    const content: any[] = [{ type: "text", text: result.success ? `Opened ${params.name}` : `Open failed: ${result.error}` }];
    if (result.screenshot) {
      content.push({ type: "image", data: result.screenshot.base64, mimeType: "image/png" });
    }
    return { content };
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
    limit: z.number().default(20).describe("Max sessions to return"),
    status: z.enum(["running", "paused", "completed", "failed", "cancelled"]).optional().describe("Filter by status"),
  },
  async (params) => {
    const sessions = listSessions({ limit: params.limit, status: params.status as any });
    return { content: [{ type: "text", text: JSON.stringify(sessions, null, 2) }] };
  }
);

// ── computer_get_session ─────────────────────────────────────────────
server.tool(
  "computer_get_session",
  "Get details of a specific session including action log",
  {
    id: z.string().describe("Session ID"),
  },
  async (params) => {
    const session = getSession(params.id);
    if (!session) return { content: [{ type: "text", text: "Session not found" }] };

    const logs = getActionLogs(params.id);
    return {
      content: [
        { type: "text", text: JSON.stringify({ session, action_logs: logs }, null, 2) },
      ],
    };
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
    const deleted = deleteSession(params.id);
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
    limit: z.number().default(20).describe("Max results"),
  },
  async (params) => {
    const results: any = {};
    if (params.scope === "sessions" || params.scope === "both") {
      results.sessions = searchSessions(params.query, params.limit);
    }
    if (params.scope === "actions" || params.scope === "both") {
      results.action_logs = searchActionLogs(params.query, params.limit);
    }
    return { content: [{ type: "text", text: JSON.stringify(results, null, 2) }] };
  }
);

// ── computer_stats ───────────────────────────────────────────────────
server.tool(
  "computer_stats",
  "Get usage statistics for computer use",
  {},
  async () => {
    const stats = getStats();
    return { content: [{ type: "text", text: JSON.stringify(stats, null, 2) }] };
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
  {},
  async () => {
    const agents = listAgents();
    return { content: [{ type: "text", text: JSON.stringify(agents, null, 2) }] };
  }
);

  // ── Cloud tools (sync, feedback) ─────────────────────────────────────
  registerCloudTools(server, "computer");

  return server;
}
