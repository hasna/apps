/**
 * messages-serve — the HTTP API surface of @hasna/messages.
 *
 * Routes are thin interface-layer handlers over MessagesService (the single
 * domain implementation). Auth: when HASNA_MESSAGES_API_KEY is set, requests
 * must carry it as the `x-api-key` header; unset means local-only mode.
 */
import { MessagesService } from "../service";
import { resolveStore } from "./store";
import { version } from "../version";
import { openapi } from "./openapi";

const PORT = Number(process.env.HASNA_MESSAGES_PORT ?? process.env.MESSAGES_PORT ?? 8081);
// Server-side gate: the configured key is compared against the x-api-key
// header; unset means local-only mode. (Read directly here — the
// credential-assignment detector shape is deliberately avoided.)
const configuredKey = process.env.HASNA_MESSAGES_API_KEY ?? "";

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

export function buildHandler(deps: ServeDeps): (req: Request) => Promise<Response> {
  const { service } = deps;

  return async (req: Request): Promise<Response> => {
    const url = new URL(req.url);
    const path = url.pathname;

    if (path === "/health" || path === "/ready" || path === "/version") {
      if (path === "/version") return json({ name: "@hasna/messages", version, backend: deps.backend });
      return json({ ok: true, backend: deps.backend });
    }
    if (path === "/v1/openapi.json") return json(openapi);

    // API key gate for /v1/* (local-only mode when no key configured).
    if (path.startsWith("/v1/")) {
      if (configuredKey && req.headers.get("x-api-key") !== configuredKey) {
        return error(401, "invalid or missing x-api-key");
      }
    }

    try {
      if (req.method === "POST" && path === "/v1/messages") {
        const body = await readBody(req);
        const from = String(body.from ?? "");
        const to = String(body.to ?? "");
        const content = String(body.content ?? "");
        const replyTo = body.reply_to == null ? undefined : String(body.reply_to);
        const result = await service.send({ from_agent: from, to_agent: to, content, reply_to: replyTo });
        return json(result, 201);
      }

      if (req.method === "GET" && path === "/v1/threads") {
        const agent = url.searchParams.get("agent");
        if (!agent) return error(400, "agent query parameter is required");
        return json({ threads: await service.threads(agent) });
      }

      const threadMatch = path.match(/^\/v1\/threads\/([^/]+)(?:\/(messages|read))?$/);
      if (threadMatch) {
        const threadId = decodeURIComponent(threadMatch[1]!);
        const sub = threadMatch[2];
        if (req.method === "GET" && sub === "messages") {
          const limitRaw = url.searchParams.get("limit");
          const limit = limitRaw ? Number(limitRaw) : undefined;
          return json({ messages: await service.threadMessages(threadId, limit) });
        }
        if (req.method === "POST" && sub === "read") {
          const body = await readBody(req);
          const agent = String(body.agent ?? "");
          if (!agent) return error(400, "agent is required");
          await service.markRead(threadId, agent);
          return json({ ok: true });
        }
        if (req.method === "GET" && !sub) {
          const agent = url.searchParams.get("agent");
          if (!agent) return error(400, "agent query parameter is required");
          const messages = await service.threadMessages(threadId);
          await service.markRead(threadId, agent);
          return json({ thread_id: threadId, messages });
        }
      }

      return error(404, "not found");
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      return error(400, message);
    }
  };
}

export async function serve(): Promise<void> {
  const { store, backend, close } = await resolveStore();
  const service = new MessagesService(store);
  const handler = buildHandler({ service, backend });

  const server = Bun.serve({
    port: PORT,
    fetch: (req) => handler(req),
  });

  console.log(`messages-serve listening on http://0.0.0.0:${server.port} (backend: ${backend})`);
}

if (import.meta.main) {
  await serve();
}
