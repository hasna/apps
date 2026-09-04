#!/usr/bin/env bun
/**
 * messages-serve — the HTTP API surface of @hasna/messages.
 *
 * Routes are thin interface-layer handlers over MessagesService (the single
 * domain implementation). Auth lives in ./auth.ts: /v1/* is gated by the
 * shared @hasna/contracts key store (scoped, revocable, expiring
 * `hasna_messages_*` tokens) when a signing secret is configured, with the
 * legacy single static HASNA_MESSAGES_API_KEY still accepted for one release.
 * With neither configured the server is in trusted-localhost mode.
 *
 * The server binds 127.0.0.1 by default — the "no credential" trust boundary
 * is only valid on loopback. A non-loopback bind (HASNA_MESSAGES_HOST) with no
 * credential configured at all is refused at startup: exposing /v1/* (DM read
 * and write routes) unauthenticated to network peers is never the default.
 *
 * Agent identity is first-class: agents are named in request bodies/query,
 * and POST /v1/auth/register creates/returns the agent row. messages owns
 * direct agent-to-agent DMs + DM-threads only — channels/announcements are
 * conversations' domain and this server never reads conversations' store.
 */
import { createHash } from "node:crypto";
import { MessagesService } from "../service";
import { createAuthGate, resolveSigningSecret, resolveStaticKey, type AuthGate } from "./auth";
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
/**
 * True when SOME credential is configured for /v1/*: a contracts signing
 * secret, or the legacy static key. This is what the bind gate asks about —
 * it is a question about the trust boundary, not about which mechanism the
 * gate ended up using. Read from the live environment so tests can vary it.
 */
function credentialConfigured(): boolean {
  const env = process.env as Record<string, string | undefined>;
  return Boolean(resolveSigningSecret(env) ?? resolveStaticKey(env));
}

export interface ServeDeps {
  service: MessagesService;
  backend: "sqlite" | "postgresql";
  /**
   * Request gate for /v1/*. Injected by the tests; the server builds exactly
   * one at startup. Omitted means "derive from the environment", memoized on
   * the credential-bearing env vars so a test that flips them gets a fresh
   * gate without paying for one per request.
   */
  auth?: AuthGate;
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

/**
 * Env-derived gate, memoized on the credential inputs. Building a gate opens a
 * pg pool and a verifier, so it must not happen per request; re-deriving the
 * signature every call means a process whose environment was rotated picks the
 * change up instead of serving a stale verifier.
 *
 * The signature is a DIGEST, not the values: the memo outlives every request,
 * and a long-lived object holding plaintext secrets is a heap-dump away from
 * being a leak. A digest distinguishes "changed" from "unchanged" just as well.
 */
let memoizedGate: { signature: string; gate: AuthGate } | null = null;

function envAuthGate(): AuthGate {
  const env = process.env as Record<string, string | undefined>;
  const signature = createHash("sha256")
    .update(
      JSON.stringify([
        resolveSigningSecret(env) ?? "",
        resolveStaticKey(env) ?? "",
        env.HASNA_MESSAGES_DATABASE_URL ?? "",
      ]),
    )
    .digest("hex");
  if (memoizedGate?.signature === signature) return memoizedGate.gate;
  const gate = createAuthGate({ env });
  memoizedGate = { signature, gate };
  return gate;
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

    // Credential gate for /v1/* — contracts key store, with the legacy static
    // key still accepted for one release (see ./auth.ts). `/v1` and
    // `/v1/openapi.json` are answered above and stay public: they are the
    // service's self-description, not data.
    if (path.startsWith("/v1/")) {
      const denial = await (deps.auth ?? envAuthGate()).check(req, req.method, path);
      if (denial) return denial;
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

/** Fail-closed bind gate: a loopback bind may run without a credential; any
 * non-loopback bind requires one (a contracts signing secret, or the legacy
 * static key), otherwise /v1/* (DM read and write routes) would be exposed
 * unauthenticated to network peers. */
export function assertSafeBind(host: string, hasCredential: boolean): void {
  const loopback = host === "127.0.0.1" || host === "localhost" || host === "::1";
  if (!loopback && !hasCredential) {
    throw new Error(
      `refusing to bind ${host} without a configured credential (API_KEY_SIGNING_SECRET or HASNA_MESSAGES_API_KEY): ` +
        `a non-loopback bind would expose /v1/* unauthenticated`,
    );
  }
}

export async function serve(): Promise<void> {
  // Fail fast before any store side effects: a non-loopback bind with no
  // configured credential would expose /v1/* unauthenticated.
  assertSafeBind(HOST, credentialConfigured());

  const { store, backend, close } = await resolveStore();
  const service = new MessagesService(store);
  const auth = createAuthGate();
  const handler = buildHandler({ service, backend, auth });

  const server = Bun.serve({
    hostname: HOST,
    port: PORT,
    fetch: (req) => handler(req),
  });

  console.log(
    `messages-serve v${version} listening on http://${HOST}:${server.port} (backend: ${backend}, auth: ${auth.mode})`,
  );
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
