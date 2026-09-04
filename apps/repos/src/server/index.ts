#!/usr/bin/env bun
import { createHash, timingSafeEqual } from "node:crypto";
import type { ServerWebSocket } from "bun";
import {
  listRepos,
  getRepo,
  resolveIdOrName,
  AmbiguousRemoteError,
  searchRepos,
  listCommits,
  searchCommits,
  listBranches,
  listTags,
  listPullRequests,
  searchAll,
  getGlobalStats,
  getRepoStats,
} from "../db/repos.js";
import { ensureWorkspaceBootstrap, startAutoIndexWorker } from "../lib/auto-index.js";
import { getHealthReport } from "../lib/utils.js";
import { handleMcpHttpRoutes } from "../mcp/http.js";
import { getCliVersion } from "../cli/version.js";
import { isLoopbackHostname } from "./loopback.js";
import { apiJsonResponse } from "./output.js";

const VERSION = getCliVersion();

function handleCliFlags(argv: string[]): boolean {
  if (argv.includes("--help") || argv.includes("-h")) {
    console.log("Usage: repos-serve [options]");
    console.log("");
    console.log("HTTP API server for @hasna/repos");
    console.log("");
    console.log("Options:");
    console.log("  -h, --help     display help");
    console.log("  -V, --version  display version");
    console.log("");
    console.log("Environment:");
    console.log("  REPOS_PORT     Server port (default: 19450)");
    console.log("  REPOS_HOST     Hostname to bind (default: 127.0.0.1 — loopback only)");
    console.log("  REPOS_SERVE_TOKEN  Bearer token required on every route when set;");
    console.log("                     mandatory when REPOS_HOST is not loopback");
    return true;
  }

  if (argv.includes("--version") || argv.includes("-V")) {
    console.log(VERSION);
    return true;
  }

  return false;
}

if (handleCliFlags(process.argv.slice(2))) {
  process.exit(0);
}

const PORT = parseInt(process.env["REPOS_PORT"] || "19450");
const HOSTNAME = process.env["REPOS_HOST"] || "127.0.0.1";
// The bearer value served from the REPOS_SERVE_TOKEN environment contract.
const SERVE_BEARER = process.env["REPOS_SERVE_TOKEN"] || "";

if (!isLoopbackHostname(HOSTNAME) && !SERVE_BEARER) {
  console.error(
    `refusing to bind repos-serve to non-loopback host ${HOSTNAME} without REPOS_SERVE_TOKEN; ` +
      "set REPOS_SERVE_TOKEN to expose the API and MCP endpoint over the network",
  );
  process.exit(1);
}

function bearerMatches(authorizationHeader: string): boolean {
  const provided = authorizationHeader.startsWith("Bearer ") ? authorizationHeader.slice("Bearer ".length) : "";
  const expectedDigest = createHash("sha256").update(SERVE_BEARER).digest();
  const providedDigest = createHash("sha256").update(provided).digest();
  return timingSafeEqual(expectedDigest, providedDigest);
}

const clients = new Set<ServerWebSocket>();

function broadcast(event: string, data?: unknown) {
  const msg = JSON.stringify({ event, data });
  for (const ws of clients) {
    ws.send(msg);
  }
}

function json(data: unknown, status = 200): Response {
  return apiJsonResponse(data, status);
}

function parseQuery(url: URL): Record<string, string> {
  const params: Record<string, string> = {};
  for (const [key, value] of url.searchParams) {
    params[key] = value;
  }
  return params;
}

const autoIndexWorker = await startAutoIndexWorker(undefined, {
  onProgress: (msg) => console.log(`[auto-index] ${msg}`),
});

process.on("SIGINT", () => autoIndexWorker.stop());
process.on("SIGTERM", () => autoIndexWorker.stop());

Bun.serve({
  hostname: HOSTNAME,
  port: PORT,
  websocket: {
    open(ws) {
      clients.add(ws);
      ws.send(JSON.stringify({ event: "connected", data: { status: "ok" } }));
    },
    close(ws) {
      clients.delete(ws);
    },
    message(ws, msg: string | Buffer) {
      try {
        const { event } = JSON.parse(msg.toString());
        if (event === "ping") ws.send(JSON.stringify({ event: "pong" }));
      } catch { /* ignore malformed */ }
    },
  },
  async fetch(req) {
    const url = new URL(req.url);
    const path = url.pathname;
    const q = parseQuery(url);

    // Token gate: with REPOS_SERVE_TOKEN set, every route — the MCP endpoint
    // included — requires `Authorization: Bearer <token>`. Cross-origin pages
    // cannot read responses (no CORS headers) and cannot forge the token.
    if (SERVE_BEARER && !bearerMatches(req.headers.get("authorization") ?? "")) {
      return json({ error: "Unauthorized" }, 401);
    }

    // DNS-rebinding guard for loopback binds: a browser-issued request to an
    // attacker-resolved hostname carries Host: <attacker-domain>, and the
    // request is then same-origin to the attacker's page, so no CORS applies.
    // The MCP SDK rejects those Hosts on /mcp; this guard applies the same
    // fixed allowlist to every /api route so a rebinding page cannot read the
    // registry or POST /api/scan with attacker-chosen roots. A non-loopback
    // bind already mandates REPOS_SERVE_TOKEN, which gates every route.
    if (isLoopbackHostname(HOSTNAME)) {
      const loopbackHosts = new Set([`127.0.0.1:${PORT}`, `localhost:${PORT}`, `[::1]:${PORT}`]);
      const host = req.headers.get("host") ?? "";
      if (!loopbackHosts.has(host)) {
        return json({ error: `Invalid Host header: ${host}` }, 403);
      }
    }

    // MCP Streamable HTTP (shared long-lived transport)
    const mcpResponse = await handleMcpHttpRoutes(req, { port: PORT, hostname: HOSTNAME });
    if (mcpResponse) return mcpResponse;

    // CORS preflight — answered without any Access-Control-Allow-* header, so
    // cross-origin browsers are blocked from reading every route.
    if (req.method === "OPTIONS") {
      return new Response(null, { status: 204 });
    }

    // ── API Routes ──

    if (path === "/api/repos" && req.method === "GET") {
      return json(listRepos({ org: q["org"], query: q["query"], limit: parseInt(q["limit"] || "50"), offset: parseInt(q["offset"] || "0") }));
    }

    if (path.startsWith("/api/repos/") && req.method === "GET") {
      const id = path.replace("/api/repos/", "");
      let repo;
      try {
        repo = getRepo(resolveIdOrName(id));
      } catch (error) {
        // A qualified owner/name that matches several live checkouts is
        // ambiguous, not absent — the same loud refusal the CLI prints.
        if (error instanceof AmbiguousRemoteError) {
          return json({ error: error.message }, 404);
        }
        throw error;
      }
      if (!repo) return json({ error: "Repo not found" }, 404);
      const stats = getRepoStats(repo.id);
      return json({ ...repo, ...stats });
    }

    if (path === "/api/search/repos" && req.method === "GET") {
      return json(searchRepos(q["query"] || "", parseInt(q["limit"] || "20")));
    }

    if (path === "/api/commits" && req.method === "GET") {
      return json(listCommits({
        repo_id: q["repo_id"] ? parseInt(q["repo_id"]) : undefined,
        author: q["author"],
        since: q["since"],
        until: q["until"],
        limit: parseInt(q["limit"] || "50"),
        offset: parseInt(q["offset"] || "0"),
      }));
    }

    if (path === "/api/search/commits" && req.method === "GET") {
      return json(searchCommits(q["query"] || "", parseInt(q["limit"] || "20")));
    }

    if (path === "/api/branches" && req.method === "GET") {
      return json(listBranches({
        repo_id: q["repo_id"] ? parseInt(q["repo_id"]) : undefined,
        limit: parseInt(q["limit"] || "100"),
      }));
    }

    if (path === "/api/tags" && req.method === "GET") {
      return json(listTags({
        repo_id: q["repo_id"] ? parseInt(q["repo_id"]) : undefined,
        limit: parseInt(q["limit"] || "100"),
      }));
    }

    if (path === "/api/prs" && req.method === "GET") {
      return json(listPullRequests({
        repo_id: q["repo_id"] ? parseInt(q["repo_id"]) : undefined,
        state: q["state"],
        author: q["author"],
        limit: parseInt(q["limit"] || "50"),
      }));
    }

    if (path === "/api/search" && req.method === "GET") {
      return json(searchAll(q["query"] || "", parseInt(q["limit"] || "20")));
    }

    if (path === "/api/stats" && req.method === "GET") {
      return json(getGlobalStats());
    }

    if (path === "/api/health" && req.method === "GET") {
      return json(getHealthReport());
    }

    if (path === "/api/scan" && req.method === "POST") {
      const body = req.headers.get("content-type")?.includes("json") ? await req.json() : {};
      const result = await ensureWorkspaceBootstrap(body.roots, { force: true, full: body.full });
      const hookSummary = {
        installed: result.hooks.installed,
        updated: result.hooks.updated,
        unchanged: result.hooks.unchanged,
        skipped: result.hooks.skipped,
      };
      broadcast("scan:complete", { ...result.scan, hooks: hookSummary });
      return json({ ...result.scan, hooks: hookSummary });
    }

    return json({ error: "Not found" }, 404);
  },
});

console.log(`repos server running on http://${HOSTNAME}:${PORT}`);
