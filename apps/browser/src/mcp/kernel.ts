// ─── Kernel cloud browser tools ──────────────────────────────────────────────

import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { registerTool, z, json, err } from "./helpers.js";
import { resolveKernelRemoteSessionId } from "../lib/session.js";
import {
  captureKernelComputerScreenshotToDownloads,
  deleteKernelBrowser,
  downloadKernelFileToDownloads,
  downloadKernelReplayToDownloads,
  executeKernelPlaywright,
  getKernelFileInfo,
  getKernelStatus,
  listKernelBrowsers,
  listKernelFiles,
  listKernelReplays,
  retrieveKernelBrowser,
  runKernelComputerAction,
  startKernelReplay,
  stopKernelReplay,
} from "../engines/kernel.js";

function kernelId(sessionId: string): string {
  return resolveKernelRemoteSessionId(sessionId);
}

export function register(server: McpServer) {
  registerTool(server,
    "browser_kernel_status",
    "Report Kernel SDK/auth/config status. With remote=true, verifies API access by listing active Kernel browser sessions without exposing secrets.",
    { remote: z.boolean().optional().default(false), limit: z.number().optional().default(25) },
    async ({ remote, limit }) => {
      try {
        return json(await getKernelStatus({ checkRemote: remote, listLimit: limit }));
      } catch (e) { return err(e); }
    },
  );

  registerTool(server,
    "browser_kernel_sessions",
    "List Kernel browser sessions from Kernel. Capability URLs are redacted.",
    { status: z.string().optional(), limit: z.number().optional().default(25) },
    async ({ status, limit }) => {
      try {
        return json({ sessions: await listKernelBrowsers({ status, limit }) });
      } catch (e) { return err(e); }
    },
  );

  registerTool(server,
    "browser_kernel_session_get",
    "Get a Kernel browser session by Kernel session id/name or by an open-browser Kernel session id.",
    { session_id: z.string() },
    async ({ session_id }) => {
      try {
        return json({ session: await retrieveKernelBrowser(kernelId(session_id)) });
      } catch (e) { return err(e); }
    },
  );

  registerTool(server,
    "browser_kernel_session_delete",
    "Delete a Kernel browser session by Kernel session id/name or by an open-browser Kernel session id. Deleting persists profile save_changes when enabled.",
    { session_id: z.string() },
    async ({ session_id }) => {
      try {
        return json(await deleteKernelBrowser(kernelId(session_id)));
      } catch (e) { return err(e); }
    },
  );

  registerTool(server,
    "browser_kernel_files_list",
    "List files inside an active Kernel browser filesystem.",
    { session_id: z.string(), path: z.string().optional().default("/") },
    async ({ session_id, path }) => {
      try {
        return json({ path, files: await listKernelFiles(kernelId(session_id), path) });
      } catch (e) { return err(e); }
    },
  );

  registerTool(server,
    "browser_kernel_file_info",
    "Get metadata for a file or directory inside an active Kernel browser filesystem.",
    { session_id: z.string(), path: z.string() },
    async ({ session_id, path }) => {
      try {
        return json({ file: await getKernelFileInfo(kernelId(session_id), path) });
      } catch (e) { return err(e); }
    },
  );

  registerTool(server,
    "browser_kernel_file_download",
    "Download a file from an active Kernel browser filesystem into open-browser downloads.",
    { session_id: z.string(), path: z.string(), filename: z.string().optional(), local_session_id: z.string().optional() },
    async ({ session_id, path, filename, local_session_id }) => {
      try {
        return json({ download: await downloadKernelFileToDownloads(kernelId(session_id), path, { filename, localSessionId: local_session_id }) });
      } catch (e) { return err(e); }
    },
  );

  registerTool(server,
    "browser_kernel_playwright_execute",
    "Execute Playwright/TypeScript code inside a Kernel browser VM. Code has page, context, and browser in scope.",
    { session_id: z.string(), code: z.string(), timeout_sec: z.number().optional() },
    async ({ session_id, code, timeout_sec }) => {
      try {
        return json(await executeKernelPlaywright(kernelId(session_id), code, { timeoutSec: timeout_sec }));
      } catch (e) { return err(e); }
    },
  );

  registerTool(server,
    "browser_kernel_computer_screenshot",
    "Capture an OS-level screenshot from a Kernel browser VM into open-browser downloads.",
    {
      session_id: z.string(),
      filename: z.string().optional(),
      region: z.object({
        x: z.number(),
        y: z.number(),
        width: z.number(),
        height: z.number(),
      }).optional(),
    },
    async ({ session_id, filename, region }) => {
      try {
        return json({ download: await captureKernelComputerScreenshotToDownloads(kernelId(session_id), { filename, region }) });
      } catch (e) { return err(e); }
    },
  );

  registerTool(server,
    "browser_kernel_computer_action",
    "Run an OS-level Kernel computer-control action: click, move, type, press, scroll, or batch.",
    {
      session_id: z.string(),
      action: z.enum(["click", "move", "type", "press", "scroll", "batch"]),
      params: z.record(z.unknown()),
    },
    async ({ session_id, action, params }) => {
      try {
        return json(await runKernelComputerAction(kernelId(session_id), action, params));
      } catch (e) { return err(e); }
    },
  );

  registerTool(server,
    "browser_kernel_replays",
    "List Kernel replay recordings for a browser session.",
    { session_id: z.string() },
    async ({ session_id }) => {
      try {
        return json({ replays: await listKernelReplays(kernelId(session_id)) });
      } catch (e) { return err(e); }
    },
  );

  registerTool(server,
    "browser_kernel_replay_start",
    "Start a Kernel replay recording for a browser session.",
    {
      session_id: z.string(),
      framerate: z.number().optional(),
      max_duration_seconds: z.number().optional(),
      record_audio: z.boolean().optional(),
    },
    async ({ session_id, framerate, max_duration_seconds, record_audio }) => {
      try {
        return json({ replay: await startKernelReplay(kernelId(session_id), { framerate, maxDurationSeconds: max_duration_seconds, recordAudio: record_audio }) });
      } catch (e) { return err(e); }
    },
  );

  registerTool(server,
    "browser_kernel_replay_stop",
    "Stop a Kernel replay recording.",
    { session_id: z.string(), replay_id: z.string() },
    async ({ session_id, replay_id }) => {
      try {
        return json(await stopKernelReplay(kernelId(session_id), replay_id));
      } catch (e) { return err(e); }
    },
  );

  registerTool(server,
    "browser_kernel_replay_download",
    "Download a Kernel replay recording into open-browser downloads.",
    { session_id: z.string(), replay_id: z.string(), filename: z.string().optional(), local_session_id: z.string().optional() },
    async ({ session_id, replay_id, filename, local_session_id }) => {
      try {
        return json({ download: await downloadKernelReplayToDownloads(kernelId(session_id), replay_id, { filename, localSessionId: local_session_id }) });
      } catch (e) { return err(e); }
    },
  );
}
