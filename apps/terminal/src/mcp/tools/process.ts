// Process tools: bg_start, bg_stop, bg_status, bg_logs, bg_wait_port

import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z, type ToolHelpers } from "./helpers.js";
import { bgStart, bgStatus, bgStop, bgLogs, bgWaitPort } from "../../supervisor.js";
import { compactManagedProcess, truncateText } from "../../compact-output.js";

export function registerProcessTools(server: McpServer, h: ToolHelpers): void {

  // ── bg_start ──────────────────────────────────────────────────────────────

  server.tool(
    "bg_start",
    "Start a background process (e.g., dev server). Auto-detects port from command.",
    {
      command: z.string().describe("Command to run in background"),
      cwd: z.string().optional().describe("Working directory"),
    },
    async ({ command, cwd }) => {
      const result = bgStart(command, cwd);
      return { content: [{ type: "text" as const, text: JSON.stringify(compactManagedProcess(result)) }] };
    }
  );

  // ── bg_status ─────────────────────────────────────────────────────────────

  server.tool(
    "bg_status",
    "List all managed background processes with status, ports, and recent output.",
    {
      verbose: z.boolean().optional().describe("Include more process detail"),
      limit: z.number().optional().describe("Max processes to return (default: 20)"),
    },
    async ({ verbose, limit }) => {
      const processes = bgStatus();
      const pageSize = Math.min(limit ?? 20, 100);
      return { content: [{ type: "text" as const, text: JSON.stringify({
        processes: verbose ? processes.slice(0, pageSize) : processes.slice(0, pageSize).map(compactManagedProcess),
        total: processes.length,
        returned: Math.min(processes.length, pageSize),
        hint: "Use bg_logs({pid, tail}) for more output.",
      }) }] };
    }
  );

  // ── bg_stop ───────────────────────────────────────────────────────────────

  server.tool(
    "bg_stop",
    "Stop a managed background process by PID.",
    { pid: z.number().describe("Process ID to stop") },
    async ({ pid }) => {
      const ok = bgStop(pid);
      return { content: [{ type: "text" as const, text: JSON.stringify({ stopped: ok, pid }) }] };
    }
  );

  // ── bg_logs ───────────────────────────────────────────────────────────────

  server.tool(
    "bg_logs",
    "Get recent output lines from a background process.",
    {
      pid: z.number().describe("Process ID"),
      tail: z.number().optional().describe("Number of lines (default: 20)"),
    },
    async ({ pid, tail }) => {
      const requestedTail = Math.min(tail ?? 20, 200);
      const lines = bgLogs(pid, requestedTail).map((line) => truncateText(line, 220));
      return { content: [{ type: "text" as const, text: JSON.stringify({
        pid,
        lines,
        tail: requestedTail,
        hint: requestedTail >= 200 ? "Output capped at 200 lines." : undefined,
      }) }] };
    }
  );

  // ── bg_wait_port ──────────────────────────────────────────────────────────

  server.tool(
    "bg_wait_port",
    "Wait for a port to start accepting connections. Useful after starting a dev server.",
    {
      port: z.number().describe("Port number to wait for"),
      timeout: z.number().optional().describe("Timeout in ms (default: 30000)"),
    },
    async ({ port, timeout }) => {
      const ready = await bgWaitPort(port, timeout);
      return { content: [{ type: "text" as const, text: JSON.stringify({ port, ready }) }] };
    }
  );

  // ── port_check ──────────────────────────────────────────────────────────

  server.tool(
    "port_check",
    "Check if a port is in use and what process is using it.",
    {
      port: z.number().describe("Port number to check"),
    },
    async ({ port }) => {
      const result = await h.exec(`lsof -i :${port} -P -n 2>/dev/null | head -5`, undefined, 5000);
      const output = result.stdout.trim();
      if (!output || result.exitCode !== 0) {
        return { content: [{ type: "text" as const, text: JSON.stringify({ port, inUse: false }) }] };
      }
      const lines = output.split("\n").filter(l => l.trim());
      return { content: [{ type: "text" as const, text: JSON.stringify({ port, inUse: true, processes: lines.slice(1).map(l => l.split(/\s+/).slice(0, 3).join(" ")) }) }] };
    }
  );
}
