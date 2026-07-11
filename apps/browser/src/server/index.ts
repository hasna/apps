#!/usr/bin/env bun

import { join, resolve } from "node:path";
import { existsSync, readFileSync } from "node:fs";
import { ZodError, type ZodSchema } from "zod";
import { createSession, closeSession, listSessions, getSessionPage, resolveKernelRemoteSessionId } from "../lib/session.js";
import { navigate, click, type as typeAction, scroll } from "../lib/actions.js";
import { getText, getHTML, getLinks, extract } from "../lib/extractor.js";
import { takeScreenshot, generatePDF } from "../lib/screenshot.js";
import { enableNetworkLogging, startHAR } from "../lib/network.js";
import { getPerformanceMetrics } from "../lib/performance.js";
import { enableConsoleCapture } from "../lib/console.js";
import { crawl } from "../lib/crawler.js";
import { startRecording, stopRecording, replayRecording } from "../lib/recorder.js";
import { startVideoRecording, stopVideoRecording, listVideos, getVideo, deleteVideo } from "../lib/video-recording.js";
import { attachExtensionSocket, createExtensionPairing, detachExtensionSocket, dispatchExtensionJob, getExtensionBridgeStatus, handleExtensionSocketMessage, prepareExtensionSocketUpgrade, revokeExtensionToken, type ExtensionSocketData } from "../lib/extension-bridge.js";
import { registerAgent, heartbeat, listAgents, getAgent } from "../lib/agents.js";
import { ensureProject, listProjects, getProject } from "../db/projects.js";
import { getNetworkLog, clearNetworkLog } from "../db/network-log.js";
import { getConsoleLog } from "../db/console-log.js";
import { listRecordings, getRecording } from "../db/recordings.js";
import { listEntries, getEntry, tagEntry, favoriteEntry, deleteEntry, searchEntries, getGalleryStats } from "../db/gallery.js";
import { listDownloads, getDownload, deleteDownload, cleanStaleDownloads } from "../lib/downloads.js";
import { diffImages } from "../lib/gallery-diff.js";
import type { BrowserEngine } from "../types/index.js";
import { authenticate, corsHeaders, resolveSecurityConfig } from "./security.js";
import {
  createSessionRequestSchema,
  extensionDispatchRequestSchema,
  extensionPairRequestSchema,
  formatZodError,
  kernelComputerScreenshotRequestSchema,
  kernelPlaywrightRequestSchema,
  kernelReplayStartRequestSchema,
  videoStartRequestSchema,
} from "./schemas.js";
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
  redactKernelSensitiveText,
  retrieveKernelBrowser,
  startKernelReplay,
  stopKernelReplay,
} from "../engines/kernel.js";

const PORT = resolveServerPort();
const SECURITY = resolveSecurityConfig();
const startTime = Date.now();
const PKG = JSON.parse(readFileSync(join(import.meta.dir, "../../package.json"), "utf8")) as { version: string };

function hasFlag(...flags: string[]): boolean {
  return process.argv.some((arg) => flags.includes(arg));
}

function resolveServerPort(): number {
  const index = process.argv.indexOf("--port");
  const fromArg = index >= 0 ? Number(process.argv[index + 1]) : NaN;
  if (Number.isInteger(fromArg) && fromArg > 0) return fromArg;
  return parseInt(process.env["BROWSER_SERVER_PORT"] ?? "7030", 10);
}

function printHelp(): void {
  process.stdout.write(
    `Usage: browser-serve [options]

@hasna/browser REST server

Options:
  --port <number>  Port to serve on (default: ${PORT}, env: BROWSER_SERVER_PORT)
  -h, --help       Show help
  -V, --version    Show version
`,
  );
}

if (import.meta.main && hasFlag("--help", "-h")) {
  printHelp();
  process.exit(0);
}

if (import.meta.main && hasFlag("--version", "-V")) {
  process.stdout.write(`${PKG.version}\n`);
  process.exit(0);
}

// ─── Active state ─────────────────────────────────────────────────────────────
const networkCleanup = new Map<string, () => void>();
const consoleCleanup = new Map<string, () => void>();
const harCaptures = new Map<string, ReturnType<typeof startHAR>>();

// ─── Helpers ──────────────────────────────────────────────────────────────────

// Safely parse request JSON — returns { body, error } instead of throwing
async function safeJson(req: Request): Promise<{ body: Record<string, unknown> } | { error: Response }> {
  try {
    const contentType = req.headers.get("content-type") ?? "";
    if (!contentType.includes("application/json")) {
      return { error: badRequest("Content-Type must be application/json") };
    }
    const body = await req.json() as Record<string, unknown>;
    return { body };
  } catch {
    return { error: badRequest("Invalid or missing JSON body") };
  }
}

function parseBody<T>(body: Record<string, unknown>, schema: ZodSchema<T>, extraHeaders?: Record<string, string>): { value: T } | { error: Response } {
  try {
    return { value: schema.parse(body) };
  } catch (error) {
    if (error instanceof ZodError) {
      return { error: badRequest(formatZodError(error), extraHeaders) };
    }
    return { error: badRequest("Invalid request body", extraHeaders) };
  }
}

function ok(data: unknown, status = 200, extraHeaders?: Record<string, string>): Response {
  return new Response(JSON.stringify(data), {
    status,
    headers: { "Content-Type": "application/json", ...(extraHeaders ?? {}) },
  });
}

function notFound(msg: string, extraHeaders?: Record<string, string>): Response {
  return new Response(JSON.stringify({ error: msg }), {
    status: 404,
    headers: { "Content-Type": "application/json", ...(extraHeaders ?? {}) },
  });
}

function badRequest(msg: string, extraHeaders?: Record<string, string>): Response {
  return new Response(JSON.stringify({ error: msg }), {
    status: 400,
    headers: { "Content-Type": "application/json", ...(extraHeaders ?? {}) },
  });
}

function serverError(e: unknown, extraHeaders?: Record<string, string>): Response {
  const msg = redactKernelSensitiveText(e instanceof Error ? e.message : String(e));
  return new Response(JSON.stringify({ error: msg }), {
    status: 500,
    headers: { "Content-Type": "application/json", ...(extraHeaders ?? {}) },
  });
}

// ─── Router ───────────────────────────────────────────────────────────────────

const server = Bun.serve<ExtensionSocketData>({
  port: PORT,
  async fetch(req, server) {
    const url = new URL(req.url);
    const path = url.pathname;
    const method = req.method;
    const origin = req.headers.get("Origin") ?? undefined;
    const headers = corsHeaders(origin ?? null, SECURITY);
    const dashboardDist = process.env["BROWSER_DASHBOARD_DIST"] ?? join(import.meta.dir, "../../dashboard/dist");
    const hasDashboard = existsSync(dashboardDist);

    const withHeaders = (response: Response): Response => {
      for (const [key, value] of Object.entries(headers)) {
        if (!response.headers.has(key)) response.headers.set(key, value);
      }
      return response;
    };
    const ok = (data: unknown, status = 200, extraHeaders?: Record<string, string>) => withHeaders(new Response(JSON.stringify(data), {
      status,
      headers: { "Content-Type": "application/json", ...(extraHeaders ?? {}) },
    }));
    const notFound = (msg: string, extraHeaders?: Record<string, string>) => withHeaders(new Response(JSON.stringify({ error: msg }), {
      status: 404,
      headers: { "Content-Type": "application/json", ...(extraHeaders ?? {}) },
    }));
    const badRequest = (msg: string, extraHeaders?: Record<string, string>) => withHeaders(new Response(JSON.stringify({ error: msg }), {
      status: 400,
      headers: { "Content-Type": "application/json", ...(extraHeaders ?? {}) },
    }));
    const serverError = (error: unknown, extraHeaders?: Record<string, string>) => {
      const msg = redactKernelSensitiveText(error instanceof Error ? error.message : String(error));
      return withHeaders(new Response(JSON.stringify({ error: msg }), {
        status: 500,
        headers: { "Content-Type": "application/json", ...(extraHeaders ?? {}) },
      }));
    };
    const safeJson = async (request: Request): Promise<{ body: Record<string, unknown> } | { error: Response }> => {
      try {
        const contentType = request.headers.get("content-type") ?? "";
        if (!contentType.includes("application/json")) {
          return { error: badRequest("Content-Type must be application/json") };
        }
        return { body: await request.json() as Record<string, unknown> };
      } catch {
        return { error: badRequest("Invalid or missing JSON body") };
      }
    };
    const parseBody = <T>(body: Record<string, unknown>, schema: ZodSchema<T>, extraHeaders?: Record<string, string>): { value: T } | { error: Response } => {
      try {
        return { value: schema.parse(body) };
      } catch (error) {
        if (error instanceof ZodError) {
          return { error: badRequest(formatZodError(error), extraHeaders) };
        }
        return { error: badRequest("Invalid request body", extraHeaders) };
      }
    };
    const isStaticDashboardRequest = hasDashboard
      && !path.startsWith("/api/")
      && path !== "/extension/ws"
      && method === "GET";

    if (method === "OPTIONS") {
      return new Response(null, { status: 204, headers });
    }

    // Authenticate all non-health, non-dashboard requests
    if (!isStaticDashboardRequest && path !== "/health" && path !== "/extension/ws") {
      const authError = authenticate(req, SECURITY);
      if (authError) return withHeaders(authError);
    }

    try {
      // ── Chrome extension bridge WebSocket ───────────────────────────────
      if (path === "/extension/ws" && method === "GET") {
        const prepared = prepareExtensionSocketUpgrade(req, server.requestIP(req)?.address);
        if (!prepared.ok) return withHeaders(prepared.response);
        if (server.upgrade(req, { data: prepared.data })) {
          return undefined as unknown as Response;
        }
        return withHeaders(new Response("WebSocket upgrade failed", { status: 426 }));
      }

      // ── Health ──────────────────────────────────────────────────────────
      if (path === "/health" && method === "GET") {
        const activeSessions = listSessions({ status: "active" });
        return ok({
          status: "ok",
          name: "browser",
          active_sessions: activeSessions.length,
          uptime_ms: Date.now() - startTime,
        });
      }

      // ── Kernel status and remote session controls ───────────────────────
      if (path === "/api/kernel/status" && method === "GET") {
        return ok(await getKernelStatus({
          checkRemote: url.searchParams.get("remote") === "true" || url.searchParams.get("remote") === "1",
          listLimit: parseInt(url.searchParams.get("limit") ?? "25"),
        }));
      }

      if (path === "/api/kernel/sessions" && method === "GET") {
        return ok({
          sessions: await listKernelBrowsers({
            status: url.searchParams.get("status") ?? undefined,
            limit: parseInt(url.searchParams.get("limit") ?? "25"),
          }),
        });
      }

      const kernelSessionMatch = path.match(/^\/api\/kernel\/sessions\/([^/]+)$/);
      if (kernelSessionMatch && method === "GET") {
        const id = resolveKernelRemoteSessionId(decodeURIComponent(kernelSessionMatch[1]));
        return ok({ session: await retrieveKernelBrowser(id) });
      }
      if (kernelSessionMatch && method === "DELETE") {
        const id = resolveKernelRemoteSessionId(decodeURIComponent(kernelSessionMatch[1]));
        return ok(await deleteKernelBrowser(id));
      }

      const kernelFilesMatch = path.match(/^\/api\/kernel\/sessions\/([^/]+)\/files$/);
      if (kernelFilesMatch && method === "GET") {
        const id = resolveKernelRemoteSessionId(decodeURIComponent(kernelFilesMatch[1]));
        const remotePath = url.searchParams.get("path") ?? "/";
        return ok({ files: await listKernelFiles(id, remotePath), path: remotePath });
      }

      const kernelFileInfoMatch = path.match(/^\/api\/kernel\/sessions\/([^/]+)\/files\/info$/);
      if (kernelFileInfoMatch && method === "GET") {
        const id = resolveKernelRemoteSessionId(decodeURIComponent(kernelFileInfoMatch[1]));
        const remotePath = url.searchParams.get("path");
        if (!remotePath) return badRequest("path query parameter required", headers);
        return ok({ file: await getKernelFileInfo(id, remotePath) });
      }

      const kernelFileDownloadMatch = path.match(/^\/api\/kernel\/sessions\/([^/]+)\/files\/download$/);
      if (kernelFileDownloadMatch && method === "POST") {
        const parsed = await safeJson(req);
        if ("error" in parsed) return parsed.error;
        const remotePath = parsed.body.path as string | undefined;
        if (!remotePath) return badRequest("path required", headers);
        const id = resolveKernelRemoteSessionId(decodeURIComponent(kernelFileDownloadMatch[1]));
        const file = await downloadKernelFileToDownloads(id, remotePath, {
          localSessionId: parsed.body.local_session_id as string | undefined,
          filename: parsed.body.filename as string | undefined,
        });
        return ok({ download: file }, 201);
      }

      const kernelPlaywrightMatch = path.match(/^\/api\/kernel\/sessions\/([^/]+)\/playwright$/);
      if (kernelPlaywrightMatch && method === "POST") {
        const parsed = await safeJson(req);
        if ("error" in parsed) return parsed.error;
        const checked = parseBody(parsed.body, kernelPlaywrightRequestSchema, headers);
        if ("error" in checked) return checked.error;
        const id = resolveKernelRemoteSessionId(decodeURIComponent(kernelPlaywrightMatch[1]));
        return ok(await executeKernelPlaywright(id, checked.value.code, { timeoutSec: checked.value.timeout_sec }));
      }

      const kernelComputerScreenshotMatch = path.match(/^\/api\/kernel\/sessions\/([^/]+)\/computer\/screenshot$/);
      if (kernelComputerScreenshotMatch && method === "POST") {
        const parsed = await safeJson(req);
        if ("error" in parsed) return parsed.error;
        const checked = parseBody(parsed.body, kernelComputerScreenshotRequestSchema, headers);
        if ("error" in checked) return checked.error;
        const id = resolveKernelRemoteSessionId(decodeURIComponent(kernelComputerScreenshotMatch[1]));
        const file = await captureKernelComputerScreenshotToDownloads(id, {
          region: checked.value.region,
          filename: checked.value.filename,
        });
        return ok({ download: file }, 201);
      }

      const kernelReplaysMatch = path.match(/^\/api\/kernel\/sessions\/([^/]+)\/replays$/);
      if (kernelReplaysMatch && method === "GET") {
        const id = resolveKernelRemoteSessionId(decodeURIComponent(kernelReplaysMatch[1]));
        return ok({ replays: await listKernelReplays(id) });
      }
      if (kernelReplaysMatch && method === "POST") {
        const parsed = await safeJson(req);
        if ("error" in parsed) return parsed.error;
        const checked = parseBody(parsed.body, kernelReplayStartRequestSchema, headers);
        if ("error" in checked) return checked.error;
        const id = resolveKernelRemoteSessionId(decodeURIComponent(kernelReplaysMatch[1]));
        return ok({ replay: await startKernelReplay(id, {
          framerate: checked.value.framerate,
          maxDurationSeconds: checked.value.max_duration_seconds,
          recordAudio: checked.value.record_audio,
        }) }, 201);
      }

      const kernelReplayStopMatch = path.match(/^\/api\/kernel\/sessions\/([^/]+)\/replays\/([^/]+)\/stop$/);
      if (kernelReplayStopMatch && method === "POST") {
        const id = resolveKernelRemoteSessionId(decodeURIComponent(kernelReplayStopMatch[1]));
        const replayId = decodeURIComponent(kernelReplayStopMatch[2]);
        return ok(await stopKernelReplay(id, replayId));
      }

      const kernelReplayDownloadMatch = path.match(/^\/api\/kernel\/sessions\/([^/]+)\/replays\/([^/]+)\/download$/);
      if (kernelReplayDownloadMatch && method === "POST") {
        const id = resolveKernelRemoteSessionId(decodeURIComponent(kernelReplayDownloadMatch[1]));
        const replayId = decodeURIComponent(kernelReplayDownloadMatch[2]);
        let filename: string | undefined;
        let localSessionId: string | undefined;
        if ((req.headers.get("content-type") ?? "").includes("application/json")) {
          const parsed = await safeJson(req);
          if ("error" in parsed) return parsed.error;
          filename = parsed.body.filename as string | undefined;
          localSessionId = parsed.body.local_session_id as string | undefined;
        }
        const file = await downloadKernelReplayToDownloads(id, replayId, { filename, localSessionId });
        return ok({ download: file }, 201);
      }

      // ── Chrome extension pairing/status ─────────────────────────────────
      if (path === "/api/extension/pair" && method === "POST") {
        let ttlMs: number | undefined;
        if ((req.headers.get("content-type") ?? "").includes("application/json")) {
          const parsed = await safeJson(req);
          if ("error" in parsed) return parsed.error;
          const checked = parseBody(parsed.body, extensionPairRequestSchema, headers);
          if ("error" in checked) return checked.error;
          ttlMs = checked.value.ttl_ms;
        }
        const pairing = createExtensionPairing(ttlMs);
        return ok({
          ...pairing,
          extension_path: join(import.meta.dir, "../../extension/dist"),
          websocket_url: `ws://127.0.0.1:${PORT}/extension/ws?code=${pairing.code}`,
        });
      }

      if (path === "/api/extension/status" && method === "GET") {
        return ok(getExtensionBridgeStatus());
      }

      if (path === "/api/extension/unpair" && method === "POST") {
        let tokenId: string | undefined;
        if ((req.headers.get("content-type") ?? "").includes("application/json")) {
          const parsed = await safeJson(req);
          if ("error" in parsed) return parsed.error;
          tokenId = parsed.body.token_id as string | undefined;
        }
        return ok(revokeExtensionToken(tokenId));
      }

      if (path === "/api/extension/dispatch" && method === "POST") {
        const parsed = await safeJson(req);
        if ("error" in parsed) return parsed.error;
        const checked = parseBody(parsed.body, extensionDispatchRequestSchema, headers);
        if ("error" in checked) return checked.error;
        const body = checked.value;
        const result = await dispatchExtensionJob(body.job as any, {
          tokenId: body.token_id,
          timeoutMs: body.timeout_ms,
          approvalToken: body.approval_token,
        });
        return ok({ result });
      }

      // ── Sessions ─────────────────────────────────────────────────────────
      if (path === "/api/sessions" && method === "GET") {
        const status = url.searchParams.get("status") as "active" | "closed" | "error" | null;
        const projectId = url.searchParams.get("project_id") ?? undefined;
        return ok({ sessions: listSessions(status ? { status, projectId } : { projectId }) });
      }

      if (path === "/api/sessions" && method === "POST") {
        const parsed = await safeJson(req);
        if ("error" in parsed) return parsed.error;
        const checked = parseBody(parsed.body, createSessionRequestSchema, headers);
        if ("error" in checked) return checked.error;
        const body = checked.value;
        const { session } = await createSession({
          engine: (body.engine as BrowserEngine) ?? "auto",
          projectId: body.project_id,
          agentId: body.agent_id,
          startUrl: body.start_url,
          headless: body.headless ?? true,
          cdpUrl: body.cdp_url,
          storageState: body.storage_state,
          approvalToken: body.approval_token,
          extensionServerUrl: body.extension_server_url,
          extensionTokenId: body.extension_token_id,
          kernelPersistenceId: body.kernel_persistence_id,
          kernelProfileId: body.kernel_profile_id,
          kernelProfileName: body.kernel_profile_name,
          kernelSaveProfileChanges: body.kernel_save_profile_changes,
          kernelTimeoutSeconds: body.kernel_timeout_seconds,
          kernelProjectId: body.kernel_project_id,
          kernelBaseUrl: body.kernel_base_url,
          kernelRequestTimeoutMs: body.kernel_request_timeout_ms,
          kernelProxyId: body.kernel_proxy_id,
          kernelGpu: body.kernel_gpu,
          kernelKioskMode: body.kernel_kiosk_mode,
          kernelTags: body.kernel_tags,
          kernelTelemetry: body.kernel_telemetry,
          kernelChromePolicy: body.kernel_chrome_policy,
          kernelEnv: body.kernel_env,
          kernelEnvSecrets: body.kernel_env_secrets,
          kernelAuthMode: body.kernel_auth_mode,
        });
        return ok({ session }, 201);
      }

      const sessionMatch = path.match(/^\/api\/sessions\/([^/]+)$/);
      if (sessionMatch && method === "DELETE") {
        const id = sessionMatch[1];
        networkCleanup.get(id)?.();
        consoleCleanup.get(id)?.();
        networkCleanup.delete(id);
        consoleCleanup.delete(id);
        harCaptures.delete(id);
        const session = await closeSession(id);
        return ok({ session });
      }

      // ── Navigate ────────────────────────────────────────────────────────
      if (path === "/api/navigate" && method === "POST") {
        const parsed = await safeJson(req);
        if ("error" in parsed) return parsed.error;
        const body = parsed.body;
        if (!body.session_id || !body.url) return badRequest("session_id and url required", headers);
        const sessionId = body.session_id as string;
        const url = body.url as string;
        const page = getSessionPage(sessionId);
        await navigate(page, url);
        return ok({ url, title: await page.title(), current_url: page.url() });
      }

      // ── Extract ─────────────────────────────────────────────────────────
      if (path === "/api/extract" && method === "POST") {
        const parsed = await safeJson(req);
        if ("error" in parsed) return parsed.error;
        const body = parsed.body;
        if (!body.session_id) return badRequest("session_id required", headers);
        const page = getSessionPage(body.session_id as string);
        const result = await extract(page, { format: body.format as "text" | undefined, selector: body.selector as string | undefined });
        return ok(result);
      }

      // ── Screenshot ──────────────────────────────────────────────────────
      if (path === "/api/screenshot" && method === "POST") {
        const parsed = await safeJson(req);
        if ("error" in parsed) return parsed.error;
        const body = parsed.body;
        if (!body.session_id) return badRequest("session_id required", headers);
        const page = getSessionPage(body.session_id as string);
        const result = await takeScreenshot(page, { selector: body.selector as string | undefined, fullPage: body.full_page as boolean | undefined });
        return ok(result);
      }

      // ── Screenshots list ─────────────────────────────────────────────────
      if (path.match(/^\/api\/screenshots\/([^/]+)$/) && method === "GET") {
        const sessionId = path.split("/")[3];
        // Return session snapshots from DB
        const { listSnapshots } = await import("../db/snapshots.js");
        return ok({ snapshots: listSnapshots(sessionId) });
      }

      // ── Network log ──────────────────────────────────────────────────────
      if (path.match(/^\/api\/network-log\/([^/]+)$/) && method === "GET") {
        const sessionId = path.split("/")[3];
        if (!networkCleanup.has(sessionId)) {
          const page = getSessionPage(sessionId);
          networkCleanup.set(sessionId, enableNetworkLogging(page, sessionId));
        }
        return ok({ requests: getNetworkLog(sessionId) });
      }

      if (path.match(/^\/api\/network-log\/([^/]+)$/) && method === "DELETE") {
        const sessionId = path.split("/")[3];
        clearNetworkLog(sessionId);
        return ok({ cleared: true });
      }

      // ── Console log ──────────────────────────────────────────────────────
      if (path.match(/^\/api\/console-log\/([^/]+)$/) && method === "GET") {
        const sessionId = path.split("/")[3];
        if (!consoleCleanup.has(sessionId)) {
          const page = getSessionPage(sessionId);
          consoleCleanup.set(sessionId, enableConsoleCapture(page, sessionId));
        }
        return ok({ messages: getConsoleLog(sessionId) });
      }

      // ── Performance ──────────────────────────────────────────────────────
      if (path.match(/^\/api\/performance\/([^/]+)$/) && method === "GET") {
        const sessionId = path.split("/")[3];
        const page = getSessionPage(sessionId);
        return ok({ metrics: await getPerformanceMetrics(page) });
      }

      // ── HAR ──────────────────────────────────────────────────────────────
      if (path === "/api/har/start" && method === "POST") {
        const parsed = await safeJson(req);
        if ("error" in parsed) return parsed.error;
        const body = parsed.body;
        const page = getSessionPage(body.session_id as string);
        harCaptures.set(body.session_id as string, startHAR(page));
        return ok({ started: true });
      }

      if (path === "/api/har/stop" && method === "POST") {
        const parsed = await safeJson(req);
        if ("error" in parsed) return parsed.error;
        const body = parsed.body;
        const capture = harCaptures.get(body.session_id as string);
        if (!capture) return notFound("No active HAR capture", headers);
        const har = capture.stop();
        harCaptures.delete(body.session_id as string);
        return ok({ har });
      }

      // ── Recordings ───────────────────────────────────────────────────────
      if (path === "/api/recordings" && method === "GET") {
        return ok({ recordings: listRecordings(url.searchParams.get("project_id") ?? undefined) });
      }

      if (path.match(/^\/api\/recordings\/([^/]+)\/replay$/) && method === "POST") {
        const parsed = await safeJson(req);
        if ("error" in parsed) return parsed.error;
        const body = parsed.body;
        const id = path.split("/")[3];
        const page = getSessionPage(body.session_id as string);
        const result = await replayRecording(id, page);
        return ok(result);
      }

      if (path.match(/^\/api\/recordings\/([^/]+)$/) && method === "DELETE") {
        const id = path.split("/")[3];
        const { deleteRecording } = await import("../db/recordings.js");
        deleteRecording(id);
        return ok({ deleted: id });
      }

      // ── Video recordings ─────────────────────────────────────────────────
      if (path === "/api/videos" && method === "GET") {
        return ok({
          recordings: listVideos({
            projectId: url.searchParams.get("project_id") ?? undefined,
            sessionId: url.searchParams.get("session_id") ?? undefined,
            status: (url.searchParams.get("status") as "recording" | "completed" | "failed" | null) ?? undefined,
          }),
        });
      }

      if (path === "/api/videos/start" && method === "POST") {
        const parsed = await safeJson(req);
        if ("error" in parsed) return parsed.error;
        const checked = parseBody(parsed.body, videoStartRequestSchema, headers);
        if ("error" in checked) return checked.error;
        const body = checked.value;
        const recording = await startVideoRecording(body.session_id as string, {
          name: body.name,
          projectId: body.project_id,
          quality: body.quality,
          format: body.format,
          captureMode: body.capture_mode,
          codec: body.codec,
          encoding: body.encoding,
          crf: body.crf,
          fps: body.fps,
          videoBitrate: body.video_bitrate,
          ffmpegPreset: body.ffmpeg_preset,
          keepRawVideo: body.keep_raw_video,
          preset: body.preset,
          width: body.width,
          height: body.height,
          tuiTheme: body.tui_theme,
          tuiFontSize: body.tui_font_size,
          tuiZoom: body.tui_zoom,
          tuiFrame: body.tui_frame,
        });
        return ok({ recording }, 201);
      }

      if (path.match(/^\/api\/videos\/([^/]+)\/stop$/) && method === "POST") {
        const id = path.split("/")[3];
        const recording = await stopVideoRecording(id);
        return ok({ recording });
      }

      if (path.match(/^\/api\/videos\/([^/]+)\/raw$/) && method === "GET") {
        const id = path.split("/")[3];
        let recording: ReturnType<typeof getVideo>;
        try {
          recording = getVideo(id);
        } catch {
          return notFound("Video not found", headers);
        }
        if (!recording.path || !existsSync(recording.path)) return notFound("Video not found", headers);
        return new Response(Bun.file(recording.path), {
          headers: {
            ...headers,
            "Content-Type": recording.format === "mp4"
              ? "video/mp4"
              : recording.format === "mov"
                ? "video/quicktime"
                : "video/webm",
            "Content-Disposition": `inline; filename="${recording.name.replace(/"/g, "")}.${recording.format}"`,
          },
        });
      }

      if (path.match(/^\/api\/videos\/([^/]+)$/) && method === "GET") {
        const id = path.split("/")[3];
        try {
          return ok({ recording: getVideo(id) });
        } catch {
          return notFound("Video not found", headers);
        }
      }

      if (path.match(/^\/api\/videos\/([^/]+)$/) && method === "DELETE") {
        const id = path.split("/")[3];
        deleteVideo(id);
        return ok({ deleted: id });
      }

      // ── Crawl ────────────────────────────────────────────────────────────
      if (path === "/api/crawl" && method === "POST") {
        const parsed = await safeJson(req);
        if ("error" in parsed) return parsed.error;
        const body = parsed.body;
        if (!body.url) return badRequest("url required", headers);
        const result = await crawl(body.url as string, {
          maxDepth: (body.max_depth as number) ?? 2,
          maxPages: (body.max_pages as number) ?? 50,
          engine: body.engine as BrowserEngine | undefined,
        });
        return ok(result);
      }

      // ── Agents ───────────────────────────────────────────────────────────
      if (path === "/api/agents" && method === "GET") {
        return ok({ agents: listAgents(url.searchParams.get("project_id") ?? undefined) });
      }

      if (path === "/api/agents" && method === "POST") {
        const parsed = await safeJson(req);
        if ("error" in parsed) return parsed.error;
        const body = parsed.body;
        if (!body.name) return badRequest("name required", headers);
        const agent = registerAgent(body.name as string, { description: body.description as string | undefined, projectId: body.project_id as string | undefined, sessionId: body.session_id as string | undefined, workingDir: body.working_dir as string | undefined });
        return ok({ agent }, 201);
      }

      if (path.match(/^\/api\/agents\/([^/]+)\/heartbeat$/) && method === "PUT") {
        const id = path.split("/")[3];
        heartbeat(id);
        return ok({ ok: true, agent_id: id, timestamp: new Date().toISOString() });
      }

      if (path.match(/^\/api\/agents\/([^/]+)$/) && method === "DELETE") {
        const id = path.split("/")[3];
        const { deleteAgent } = await import("../db/agents.js");
        deleteAgent(id);
        return ok({ deleted: id });
      }

      // ── Projects ─────────────────────────────────────────────────────────
      if (path === "/api/projects" && method === "GET") {
        return ok({ projects: listProjects() });
      }

      if (path === "/api/projects" && method === "POST") {
        const parsed = await safeJson(req);
        if ("error" in parsed) return parsed.error;
        const body = parsed.body;
        if (!body.name || !body.path) return badRequest("name and path required", headers);
        const project = ensureProject(body.name as string, body.path as string, body.description as string | undefined);
        return ok({ project }, 201);
      }

      // ── Gallery ──────────────────────────────────────────────────────────
      if (path === "/api/gallery" && method === "GET") {
        const tag = url.searchParams.get("tag") ?? undefined;
        const projectId = url.searchParams.get("project_id") ?? undefined;
        const isFavorite = url.searchParams.get("is_favorite") === "true" ? true : undefined;
        const limit = parseInt(url.searchParams.get("limit") ?? "50");
        const entries = listEntries({ tag, projectId, isFavorite, limit });
        return ok({ entries, count: entries.length });
      }
      if (path === "/api/gallery/stats" && method === "GET") {
        return ok(getGalleryStats(url.searchParams.get("project_id") ?? undefined));
      }
      if (path === "/api/gallery/diff" && method === "POST") {
        const parsed = await safeJson(req);
        if ("error" in parsed) return parsed.error;
        const body = parsed.body;
        const e1 = getEntry(body.id1 as string); const e2 = getEntry(body.id2 as string);
        if (!e1 || !e2) return notFound("Gallery entry not found", headers);
        return ok(await diffImages(e1.path, e2.path));
      }
      if (path.match(/^\/api\/gallery\/([^/]+)\/tag$/) && method === "POST") {
        const parsed = await safeJson(req);
        if ("error" in parsed) return parsed.error;
        const body = parsed.body;
        const id = path.split("/")[3];
        return ok({ entry: tagEntry(id, body.tag as string) });
      }
      if (path.match(/^\/api\/gallery\/([^/]+)\/favorite$/) && method === "PUT") {
        const parsed = await safeJson(req);
        if ("error" in parsed) return parsed.error;
        const body = parsed.body;
        const id = path.split("/")[3];
        return ok({ entry: favoriteEntry(id, body.favorited as boolean) });
      }
      if (path.match(/^\/api\/gallery\/([^/]+)\/thumbnail$/) && method === "GET") {
        const id = path.split("/")[3];
        const entry = getEntry(id);
        if (!entry?.thumbnail_path || !existsSync(entry.thumbnail_path)) return notFound("Thumbnail not found");
        return new Response(Bun.file(entry.thumbnail_path), { headers: { ...headers } });
      }
      if (path.match(/^\/api\/gallery\/([^/]+)\/image$/) && method === "GET") {
        const id = path.split("/")[3];
        const entry = getEntry(id);
        if (!entry?.path || !existsSync(entry.path)) return notFound("Image not found");
        return new Response(Bun.file(entry.path), { headers: { ...headers } });
      }
      if (path.match(/^\/api\/gallery\/([^/]+)$/) && method === "DELETE") {
        const id = path.split("/")[3];
        deleteEntry(id);
        return ok({ deleted: id });
      }
      if (path.match(/^\/api\/gallery\/([^/]+)$/) && method === "GET") {
        const id = path.split("/")[3];
        const entry = getEntry(id);
        if (!entry) return notFound("Gallery entry not found");
        return ok({ entry });
      }

      // ── Downloads ─────────────────────────────────────────────────────────
      if (path === "/api/downloads" && method === "GET") {
        const sessionId = url.searchParams.get("session_id") ?? undefined;
        const downloads = listDownloads(sessionId);
        return ok({ downloads, count: downloads.length });
      }
      if (path === "/api/downloads/clean" && method === "DELETE") {
        const days = parseInt(url.searchParams.get("days") ?? "7");
        return ok({ deleted_count: cleanStaleDownloads(days) });
      }
      if (path.match(/^\/api\/downloads\/([^/]+)\/raw$/) && method === "GET") {
        const id = path.split("/")[3];
        const file = getDownload(id);
        if (!file || !existsSync(file.path)) return notFound("Download not found");
        return new Response(Bun.file(file.path), { headers: { ...headers } });
      }
      if (path.match(/^\/api\/downloads\/([^/]+)$/) && method === "DELETE") {
        const id = path.split("/")[3];
        return ok({ deleted: deleteDownload(id) });
      }

      if (path.startsWith("/api/")) {
        return notFound(`Route not found: ${method} ${path}`, headers);
      }

      // ── Dashboard (static) — path traversal safe ─────────────────────────
      if (hasDashboard) {
        // Reject any traversal attempts
        const cleanPath = path.replace(/^\//, "");
        const dashboardRoot = resolve(dashboardDist);
        const filePath = path === "/" ? join(dashboardRoot, "index.html") : resolve(dashboardRoot, cleanPath);
        if (!filePath.startsWith(`${dashboardRoot}/`) && filePath !== join(dashboardRoot, "index.html")) {
          return notFound("Not found", headers);
        }
        if (existsSync(filePath)) {
          return new Response(Bun.file(filePath), { headers });
        }
        // SPA fallback
        return new Response(Bun.file(join(dashboardRoot, "index.html")), { headers });
      }

      if (path === "/" || path === "") {
        return new Response("@hasna/browser REST API running. Dashboard not built.", {
          headers: { "Content-Type": "text/plain", ...headers },
        });
      }

      return notFound(`Route not found: ${method} ${path}`);
    } catch (e) {
      return serverError(e);
    }
  },
  websocket: {
    open(ws) {
      const data = ws.data as ExtensionSocketData;
      attachExtensionSocket(ws, data);
    },
    message(ws, message) {
      const data = ws.data as ExtensionSocketData;
      handleExtensionSocketMessage(data.token_id, typeof message === "string" ? message : Buffer.from(message));
    },
    close(ws) {
      const data = ws.data as ExtensionSocketData;
      detachExtensionSocket(data.token_id);
    },
  },
});

console.error(`@hasna/browser server running on http://localhost:${PORT}`);
