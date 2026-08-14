// Shared helpers for all MCP tools

import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { spawn } from "child_process";
import { stripNoise } from "../../noise-filter.js";
import { rewriteCommand } from "../../command-rewriter.js";
import { invalidateBootCache } from "../../session-boot.js";
import { logInteraction } from "../../sessions-db.js";
import { join } from "path";
import { getShell } from "../../shell.js";
import { expandHomePath } from "../../shell-quote.js";

export { z } from "zod";

export interface ExecResult {
  exitCode: number;
  stdout: string;
  stderr: string;
  duration: number;
  rewritten?: string;
  timedOut?: boolean;
}

export interface LogCallData {
  command?: string;
  outputTokens?: number;
  tokensSaved?: number;
  durationMs?: number;
  exitCode?: number;
  aiProcessed?: boolean;
  model?: string;
}

export interface ToolHelpers {
  exec: (command: string, cwd?: string, timeout?: number, allowRewrite?: boolean) => Promise<ExecResult>;
  resolvePath: (p: string, cwd?: string) => string;
  logCall: (tool: string, data: LogCallData) => void;
  sessionId: string;
}

/** Create shared helpers for tool modules */
export function createHelpers(sessionId: string): ToolHelpers {
  function exec(command: string, cwd?: string, timeout?: number, allowRewrite: boolean = false): Promise<ExecResult> {
    const rw = allowRewrite ? rewriteCommand(command) : { changed: false, rewritten: command };
    const actualCommand = rw.changed ? rw.rewritten : command;
    return new Promise((resolve) => {
      const start = Date.now();
      const useProcessGroup = !!timeout && process.platform !== "win32";
      const proc = spawn(getShell(), ["-c", actualCommand], {
        cwd: expandHomePath(cwd ?? process.cwd()),
        stdio: ["ignore", "pipe", "pipe"],
        detached: useProcessGroup,
      });

      let stdout = "";
      let stderr = "";
      let timedOut = false;
      let killTimer: ReturnType<typeof setTimeout> | null = null;

      const killWindowsProcessTree = () => {
        if (!proc.pid) return;
        const killer = spawn("taskkill", ["/pid", String(proc.pid), "/t", "/f"], {
          stdio: "ignore",
          windowsHide: true,
        });
        const fallback = () => { try { proc.kill("SIGKILL"); } catch {} };
        killer.on("error", fallback);
        killer.on("exit", (code) => { if (code !== 0) fallback(); });
      };

      const killProcess = (signal: NodeJS.Signals) => {
        if (!proc.pid) return;
        if (process.platform === "win32") {
          if (signal === "SIGKILL") killWindowsProcessTree();
          else {
            try { proc.kill(signal); } catch {}
          }
          return;
        }
        try {
          if (useProcessGroup) process.kill(-proc.pid, signal);
          else proc.kill(signal);
        } catch {
          try { proc.kill(signal); } catch {}
        }
      };

      proc.stdout?.on("data", (d: Buffer) => { stdout += d.toString(); });
      proc.stderr?.on("data", (d: Buffer) => { stderr += d.toString(); });

      const timer = timeout ? setTimeout(() => {
        timedOut = true;
        if (process.platform === "win32") {
          killWindowsProcessTree();
        } else {
          killProcess("SIGTERM");
          killTimer = setTimeout(() => killProcess("SIGKILL"), 250);
        }
      }, timeout) : null;

      proc.on("close", (code) => {
        if (timer) clearTimeout(timer);
        if (killTimer) clearTimeout(killTimer);
        if (timedOut) {
          stderr += `${stderr.endsWith("\n") || stderr.length === 0 ? "" : "\n"}Command timed out after ${timeout}ms`;
        }
        const cleanStdout = stripNoise(stdout).cleaned;
        const cleanStderr = stripNoise(stderr).cleaned;
        if (/\bgit\s+(commit|checkout|branch|merge|reset|push|pull|rebase|stash)\b/.test(actualCommand)) {
          invalidateBootCache();
        }
        resolve({
          exitCode: timedOut ? 124 : code ?? 0,
          stdout: cleanStdout,
          stderr: cleanStderr,
          duration: Date.now() - start,
          rewritten: rw.changed ? rw.rewritten : undefined,
          ...(timedOut ? { timedOut: true } : {}),
        });
      });
    });
  }

  function resolvePath(p: string, cwd?: string): string {
    const base = expandHomePath(cwd ?? process.cwd());
    if (!p) return base;
    const expandedPath = expandHomePath(p);
    if (expandedPath.startsWith("/") || p.startsWith("~")) return expandedPath;
    return join(base, expandedPath);
  }

  function logCall(tool: string, data: LogCallData) {
    try {
      logInteraction(sessionId, {
        nl: `[mcp:${tool}]${data.command ? ` ${data.command.slice(0, 200)}` : ""}`,
        command: data.command?.slice(0, 500),
        exitCode: data.exitCode,
        tokensUsed: data.aiProcessed ? (data.outputTokens ?? 0) : 0,
        tokensSaved: data.tokensSaved ?? 0,
        durationMs: data.durationMs,
        model: data.model,
        cached: false,
      });
    } catch {}
  }

  return { exec, resolvePath, logCall, sessionId };
}
