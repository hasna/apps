// Shared helpers for all MCP tools

import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { spawn } from "child_process";
import { stripNoise } from "../../noise-filter.js";
import { rewriteCommand } from "../../command-rewriter.js";
import { invalidateBootCache } from "../../session-boot.js";
import { logInteraction } from "../../sessions-db.js";
import { join } from "path";

export { z } from "zod";

export interface ExecResult {
  exitCode: number;
  stdout: string;
  stderr: string;
  duration: number;
  rewritten?: string;
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
      const proc = spawn("/bin/zsh", ["-c", actualCommand], {
        cwd: cwd ?? process.cwd(),
        stdio: ["ignore", "pipe", "pipe"],
      });

      let stdout = "";
      let stderr = "";

      proc.stdout?.on("data", (d: Buffer) => { stdout += d.toString(); });
      proc.stderr?.on("data", (d: Buffer) => { stderr += d.toString(); });

      const timer = timeout ? setTimeout(() => { try { proc.kill("SIGTERM"); } catch {} }, timeout) : null;

      proc.on("close", (code) => {
        if (timer) clearTimeout(timer);
        const cleanStdout = stripNoise(stdout).cleaned;
        const cleanStderr = stripNoise(stderr).cleaned;
        if (/\bgit\s+(commit|checkout|branch|merge|reset|push|pull|rebase|stash)\b/.test(actualCommand)) {
          invalidateBootCache();
        }
        resolve({ exitCode: code ?? 0, stdout: cleanStdout, stderr: cleanStderr, duration: Date.now() - start, rewritten: rw.changed ? rw.rewritten : undefined });
      });
    });
  }

  function resolvePath(p: string, cwd?: string): string {
    if (!p) return cwd ?? process.cwd();
    if (p.startsWith("/") || p.startsWith("~")) return p;
    return join(cwd ?? process.cwd(), p);
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
