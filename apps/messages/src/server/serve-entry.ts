#!/usr/bin/env bun
/**
 * messages-serve — the HTTP API surface of @hasna/messages.
 *
 * Routes are thin interface-layer handlers over MessagesService (the single
 * domain implementation). Auth: when HASNA_MESSAGES_API_KEY is set, requests
 * to /v1/* must carry it as the `x-api-key` header; unset means trusted
 * localhost-only mode (the client sends the key when it has one; the server
 * is the authority on whether one is required).
 *
 * The server binds 127.0.0.1 by default — the "no key" trust boundary is
 * only valid on loopback. A non-loopback bind (HASNA_MESSAGES_HOST) without
 * HASNA_MESSAGES_API_KEY is refused at startup: exposing /v1/* (DM read and
 * write routes) unauthenticated to network peers is never the default.
 *
 * Agent identity is first-class: agents are named in request bodies/query,
 * and POST /v1/auth/register creates/returns the agent row. messages owns
 * direct agent-to-agent DMs + DM-threads only — channels/announcements are
 * conversations' domain and this server never reads conversations' store.
 */
import { MessagesService } from "../service";
import { resolveStore } from "./store";
import { version } from "../version";
import { openapi } from "./openapi";
import type {
  Agent,
  DeliveredMessage,
  Message,
  MessageDeliveryReport,
  SendResult,
  Thread,
  ThreadSummary,
} from "../types";

// Binds-before-version (control surfaces answer --version/--help before any
// bind): the version/help checks run before resolveStore()/Bun.serve.
const EARLY_ARGV = process.argv.slice(2);
if (EARLY_ARGV.includes("--version") || EARLY_ARGV.includes("-V")) {
  console.log(version);
  process.exit(0);
}
if (EARLY_ARGV.includes("--help") || EARLY_ARGV.includes("-h")) {
  console.log(`Usage: messages-serve [options]

Hasna Messages HTTP API — direct agent-to-agent DMs with threads (SQLite by
default, or PostgreSQL via HASNA_MESSAGES_DATABASE_URL).

Options:
  -V, --version  output the version number
  -h, --help     display help for command`);
  process.exit(0);
}

const PORT = Number(process.env.HASNA_MESSAGES_PORT ?? process.env.MESSAGES_PORT ?? 8081);
// Loopback by default: the unauthenticated "no API key" mode is only a
// trusted-localhost mode when the socket is actually on loopback.
const HOST = process.env.HASNA_MESSAGES_HOST ?? "127.0.0.1";
// Server-side gate: the configured key is compared against the x-api-key
// header; unset means local-only mode. Read per request so the environment is
// authoritative at call time (and tests can vary it). Never printed.
function configuredKey(): string {
  return process.env.HASNA_MESSAGES_API_KEY ?? "";
}

export interface ServeDeps {
  service: MessagesService;
  backend: "sqlite" | "postgresql";
}

function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json" },
  });
}

function error(status: number, message: string): Response {
  return json({ error: message }, status);
}

async function readBody(req: Request): Promise<Record<string, unknown>> {
  const raw = await req.text();
  if (!raw) return {};
  try {
    return JSON.parse(raw) as Record<string, unknown>;
  } catch {
    return {};
  }
}

function str(v: unknown): string {
  return v == null ? "" : String(v);
}

export function buildHandler(deps: ServeDeps): (req: Request) => Promise<Response> {
  const { service } = deps;

  return async (req: Request): Promise<Response> => {
    const url = new URL(req.url);
    const path = url.pathname;

    // Public contract endpoints.
    if (path === "/health" || path === "/ready") {
      return json({ ok: true, service: "@hasna/messages", backend: deps.backend });
    }
    if (path === "/version") {
      return json({ name: "@hasna/messages", version, backend: deps.backend });
    }
    if (path === "/v1/openapi.json") return json(openapi);
    if (path === "/v1" || path === "/v1/") {
      return json({ name: "@hasna/messages", version, dialect: "messages/v1", open_source: "@hasna/messages" });
    }

    // API key gate for /v1/* (local-only mode when no key configured).
    if (path.startsWith("/v1/")) {
      const key = configuredKey();
      if (key && req.headers.get("x-api-key") !== key) {
        return error(401, "invalid or missing x-api-key");
      }
    }

    try {
      // --- identity ---
      if (req.method === "POST" && path === "/v1/auth/register") {
        const body = await readBody(req);
        const name = str(body.name);
        if (!name) return error(400, "name is required");
        const agent: Agent = await service.registerAgent(name, body.display_name ? str(body.display_name) : undefined);
        return json({ agent }, 201);
      }

      if (req.method === "GET" && path === "/v1/agents") {
        return json({ agents: await service.listAgents() });
      }

      // --- messaging ---
      if (req.method === "POST" && path === "/v1/messages") {
        const body = await readBody(req);
        const result: SendResult = await service.send({
          from_agent: str(body.from),
          to_agent: str(body.to),
          content: str(body.content),
          reply_to: body.reply_to == null ? null : str(body.reply_to),
        });
        return json(result, 201);
      }

      if (req.method === "GET" && path === "/v1/messages/receive") {
        const agent = url.searchParams.get("agent");
        if (!agent) return error(400, "agent query parameter is required");
        const messages: DeliveredMessage[] = await service.receive(agent);
        return json({ messages });
      }

      if (req.method === "GET" && path === "/v1/messages/delivery") {
        const threadId = url.searchParams.get("thread");
        if (!threadId) return error(400, "thread query parameter is required");
        const deliveries: MessageDeliveryReport[] = await service.deliveryStatus(threadId);
        return json({ deliveries });
      }

      // --- threads ---
      if (req.method === "GET" && path === "/v1/threads") {
        const agent = url.searchParams.get("agent");
        if (!agent) return error(400, "agent query parameter is required");
        const openOnly = url.searchParams.get("open_only") !== "0";
        const threads: ThreadSummary[] = await service.threads(agent, { openOnly });
        return json({ threads });
      }

      if (req.method === "GET" && path === "/v1/unread") {
        const agent = url.searchParams.get("agent");
        if (!agent) return error(400, "agent query parameter is required");
        const threads: ThreadSummary[] = await service.unreadThreads(agent);
        return json({ threads, total: threads.reduce((sum, t) => sum + t.unread_count, 0) });
      }

      const threadMatch = path.match(/^\/v1\/threads\/([^/]+)(?:\/(messages|unread|read|close|reopen))?$/);
      if (threadMatch) {
        const threadId = decodeURIComponent(threadMatch[1]!);
        const sub = threadMatch[2];
        if (req.method === "GET" && sub === "messages") {
          const limitRaw = url.searchParams.get("limit");
          const limit = limitRaw ? Number(limitRaw) : undefined;
          const messages: Message[] = await service.threadMessages(threadId, limit);
          return json({ messages });
        }
        if (req.method === "GET" && sub === "unread") {
          const agent = url.searchParams.get("agent");
          if (!agent) return error(400, "agent query parameter is required");
          return json({ unread_count: await service.threadUnread(threadId, agent) });
        }
        if (req.method === "POST" && sub === "read") {
          const body = await readBody(req);
          const agent = str(body.agent);
          if (!agent) return error(400, "agent is required");
          await service.markRead(threadId, agent);
          return json({ ok: true });
        }
        if (req.method === "POST" && sub === "close") {
          const body = await readBody(req);
          const agent = str(body.agent);
          if (!agent) return error(400, "agent is required");
          const thread: Thread = await service.closeThread(threadId, agent);
          return json({ thread });
        }
        if (req.method === "POST" && sub === "reopen") {
          const body = await readBody(req);
          const agent = str(body.agent);
          if (!agent) return error(400, "agent is required");
          const thread: Thread = await service.reopenThread(threadId, agent);
          return json({ thread });
        }
        if (req.method === "GET" && !sub) {
          const agent = url.searchParams.get("agent");
          if (!agent) return error(400, "agent query parameter is required");
          return json(await service.expandThread(threadId, agent));
        }
      }

      const messageReadMatch = path.match(/^\/v1\/messages\/([^/]+)\/read$/);
      if (req.method === "POST" && messageReadMatch) {
        const messageId = decodeURIComponent(messageReadMatch[1]!);
        const body = await readBody(req);
        const agent = str(body.agent);
        if (!agent) return error(400, "agent is required");
        await service.markMessageRead(messageId, agent);
        return json({ ok: true });
      }

      return error(404, "not found");
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      return error(400, message);
    }
  };
}

/** Fail-closed bind gate: a loopback bind may run without a key; any
 * non-loopback bind requires a configured API key, otherwise /v1/* (DM read
 * and write routes) would be exposed unauthenticated to network peers. */
export function assertSafeBind(host: string, hasKey: boolean): void {
  const loopback = host === "127.0.0.1" || host === "localhost" || host === "::1";
  if (!loopback && !hasKey) {
    throw new Error(
      `refusing to bind ${host} without HASNA_MESSAGES_API_KEY: a non-loopback bind would expose /v1/* unauthenticated`,
    );
  }
}

export async function serve(): Promise<void> {
  // Fail fast before any store side effects: a non-loopback bind without a
  // configured key would expose /v1/* unauthenticated.
  assertSafeBind(HOST, Boolean(configuredKey()));

  const { store, backend, close } = await resolveStore();
  const service = new MessagesService(store);
  const handler = buildHandler({ service, backend });

  const server = Bun.serve({
    hostname: HOST,
    port: PORT,
    fetch: (req) => handler(req),
  });

  console.log(`messages-serve v${version} listening on http://${HOST}:${server.port} (backend: ${backend})`);
  // Keep the process alive; close is available for tests.
  await new Promise<void>(() => {
    // no-op: Bun.serve keeps the event loop alive
  });
  // Unreachable in practice; kept for signature completeness.
  await close();
}

if (import.meta.main) {
  await serve();
}
