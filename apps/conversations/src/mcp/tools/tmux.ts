/**
 * Tmux dispatch tools: tmux_send, tmux_broadcast
 *
 * Send messages to tmux windows (other Claude Code sessions) with
 * smart paste → wait → Enter → verify behavior.
 */

import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import { tmuxSend } from "../../cli/commands/tmux.js";

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

export function registerTmuxTools(server: McpServer): void {
  server.registerTool("tmux_send", {
    description:
      "Send a message to a tmux window (e.g. another agent's Claude Code session). " +
      "Pastes the text literally, waits for the pane to be idle, hits Enter, then verifies the message was submitted. " +
      "Retries up to N times on failure.",
    inputSchema: {
      target: z.string().describe("Tmux target: session:window or session:window.pane (e.g. platform-alumia:1)"),
      message: z.string().describe("Message text to send"),
      delay_ms: z.coerce.number().optional().describe("Wait time (ms) after paste before hitting Enter. Default: max(12000, message_length * 50)"),
      retries: z.coerce.number().optional().describe("Max retry attempts (default: 3)"),
      verify: z.coerce.boolean().optional().describe("Verify message was submitted after Enter (default: true)"),
    },
  }, async (args: Record<string, any>) => {
    const { target, message, delay_ms, retries, verify } = args;

    if (!target || !target.trim()) {
      return { content: [{ type: "text", text: "target is required" }], isError: true };
    }
    if (!message || !message.trim()) {
      return { content: [{ type: "text", text: "message cannot be empty" }], isError: true };
    }

    try {
      const result = await tmuxSend(target.trim(), message, {
        delayMs: typeof delay_ms === "number" && delay_ms > 0 ? delay_ms : undefined,
        retries: typeof retries === "number" && retries > 0 ? retries : undefined,
        verify: verify !== false,
      });

      return {
        content: [{ type: "text", text: JSON.stringify({ target, result }) }],
        isError: !result.success,
      };
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      return { content: [{ type: "text", text: `tmux error: ${msg}` }], isError: true };
    }
  });

  server.registerTool("tmux_broadcast", {
    description:
      "Send the same message to multiple tmux windows simultaneously. " +
      "Useful for broadcasting instructions to several agent sessions at once. " +
      "Supports staggered sending and per-target retry.",
    inputSchema: {
      targets: z.array(z.string()).describe("List of tmux targets (session:window or session:window.pane)"),
      message: z.string().describe("Message text to send to all targets"),
      delay_ms: z.coerce.number().optional().describe("Wait time (ms) after paste before Enter. Default: max(12000, message_length * 50)"),
      stagger_ms: z.coerce.number().optional().describe("Delay (ms) between sending to each target (default: 0)"),
      retries: z.coerce.number().optional().describe("Max retry attempts per target (default: 3)"),
      verify: z.coerce.boolean().optional().describe("Verify each message was submitted (default: true)"),
    },
  }, async (args: Record<string, any>) => {
    const { targets, message, delay_ms, stagger_ms, retries, verify } = args;

    if (!Array.isArray(targets) || targets.length === 0) {
      return { content: [{ type: "text", text: "targets must be a non-empty array" }], isError: true };
    }
    if (!message || !message.trim()) {
      return { content: [{ type: "text", text: "message cannot be empty" }], isError: true };
    }

    const stagger = typeof stagger_ms === "number" && stagger_ms > 0 ? stagger_ms : 0;
    const results: Array<{ target: string; success: boolean; attempts: number; error?: string }> = [];

    for (let i = 0; i < targets.length; i++) {
      const target = (targets[i] as string).trim();
      if (i > 0 && stagger > 0) await sleep(stagger);

      try {
        const result = await tmuxSend(target, message, {
          delayMs: typeof delay_ms === "number" && delay_ms > 0 ? delay_ms : undefined,
          retries: typeof retries === "number" && retries > 0 ? retries : undefined,
          verify: verify !== false,
        });
        results.push({ target, ...result });
      } catch (err) {
        const errMsg = err instanceof Error ? err.message : String(err);
        results.push({ target, success: false, attempts: 0, error: errMsg });
      }
    }

    const succeeded = results.filter((r) => r.success).length;
    const failed = results.length - succeeded;

    return {
      content: [{
        type: "text",
        text: JSON.stringify({ results, succeeded, failed, total: results.length }),
      }],
      isError: failed > 0,
    };
  });
}
