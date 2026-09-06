import { authHeader } from "./auth";
import { createHash, timingSafeEqual } from "node:crypto";
import { mkdir, symlink, writeFile } from "node:fs/promises";
import { isAbsolute, join } from "node:path";
import type { HarnessLaunchInput, PreparedLaunch } from "./harness-types";

/** Hermes' native runtime names for the three Switcher wire contracts. */
export const hermesApiMode = {
  "anthropic-messages": "anthropic_messages",
  "openai-responses": "codex_responses",
  "openai-chat": "chat_completions",
} as const;

type HermesProtocol = keyof typeof hermesApiMode;

const routePath: Record<HermesProtocol, string> = {
  "anthropic-messages": "/v1/messages",
  "openai-responses": "/v1/responses",
  "openai-chat": "/v1/chat/completions",
};

const apiMode: Record<HermesProtocol, string> = hermesApiMode;

/**
 * Keep Hermes' picker and inference route on the exact Switcher catalog.
 * Hermes' custom provider client uses Bearer locally; this bridge translates
 * that local credential into the provider's declared upstream header style.
 */
export function createHermesBridge(input: Pick<HarnessLaunchInput, "baseUrl" | "protocol" | "authStyle" | "model" | "models" | "credential">) {
  const protocol = input.protocol as HermesProtocol;
  const token = crypto.randomUUID() + crypto.randomUUID();
  const modelIds = new Set(input.models.map(model => model.id));
  const active = new Set<{ abort: AbortController; done: Promise<void>; cancel?: () => Promise<void> }>();
  let closing = false;
  let server: ReturnType<typeof Bun.serve>;
  let stopped: Promise<void> | undefined;

  server = Bun.serve({
    hostname: "127.0.0.1",
    port: 0,
    maxRequestBodySize: 4 * 1024 * 1024,
    idleTimeout: 255,
    async fetch(request) {
      if (closing) return Response.json({ error: { message: "Hermes bridge is closing" } }, { status: 503 });
      // Hermes' Anthropic client sends `x-api-key`; its OpenAI-compatible
      // clients send Bearer. Accept only the header belonging to the selected
      // native protocol so a valid token in the wrong header cannot redirect a
      // request across protocol boundaries.
      const nativeHeader = protocol === "anthropic-messages" ? "x-api-key" : "authorization";
      const nativeCredential = request.headers.get(nativeHeader) ?? "";
      const expectedCredential = nativeHeader === "x-api-key" ? token : `Bearer ${token}`;
      const actual = createHash("sha256").update(nativeCredential).digest();
      const expectedHeader = createHash("sha256").update(expectedCredential).digest();
      if (actual.length !== expectedHeader.length || !timingSafeEqual(actual, expectedHeader))
        return Response.json({ error: { message: "Unauthorized" } }, { status: 401 });

      const path = new URL(request.url).pathname;
      if (request.method === "GET" && path === "/v1/models") {
        return Response.json({
          object: "list",
          data: input.models.map(model => ({
            id: model.id,
            object: "model",
            name: model.name,
            owned_by: "switcher",
            context_window: model.contextWindow,
            max_output_tokens: model.maxOutputTokens,
          })),
        });
      }
      if (request.method !== "POST" || path !== routePath[protocol])
        return Response.json({ error: { message: "Unsupported Hermes bridge route" } }, { status: 404 });

      let body: unknown;
      try { body = await request.json(); } catch { return Response.json({ error: { message: "Invalid JSON" } }, { status: 400 }); }
      if (!body || typeof body !== "object" || typeof (body as { model?: unknown }).model !== "string")
        return Response.json({ error: { message: "A model is required" } }, { status: 400 });
      const selectedModel = (body as { model: string }).model;
      if (!modelIds.has(selectedModel))
        return Response.json({ error: { message: "Model is outside the Switcher launch catalog" } }, { status: 403 });

      const abortController = new AbortController();
      let complete!: () => void;
      const record: { abort: AbortController; done: Promise<void>; cancel?: () => Promise<void> } = {
        abort: abortController,
        done: new Promise<void>(resolve => { complete = resolve; }),
      };
      const release = () => { active.delete(record); complete(); };
      active.add(record);
      record.cancel = async () => {
        abortController.abort();
        release();
      };

      const headers: Record<string, string> = { "content-type": "application/json" };
      if (input.credential) {
        const [header,value]=authHeader(input.authStyle??"bearer",input.credential);
        headers[header]=value;
      }
      if (protocol === "anthropic-messages") {
        headers["anthropic-version"] = request.headers.get("anthropic-version") ?? "2023-06-01";
        const beta = request.headers.get("anthropic-beta");
        if (beta) headers["anthropic-beta"] = beta;
      }

      try {
        const upstream = await fetch(`${input.baseUrl}${routePath[protocol].replace(/^\/v1/, "")}`, {
          method: "POST",
          headers,
          body: JSON.stringify(body),
          redirect: "manual",
          signal: AbortSignal.any([abortController.signal, request.signal, AbortSignal.timeout(240_000)]),
        });
        if (!upstream.ok) {
          await upstream.body?.cancel();
          release();
          return Response.json({ error: { message: `Provider returned HTTP ${upstream.status}` } }, { status: upstream.status });
        }
        if (!upstream.body) { release(); return new Response(null, { status: upstream.status }); }
        const reader = upstream.body.getReader();
        let ended = false;
        const end = () => {
          if (ended) return;
          ended = true;
          release();
        };
        const stream = new ReadableStream<Uint8Array>({
          async pull(controller) {
            try {
              const chunk = await reader.read();
              if (chunk.done) { end(); controller.close(); }
              else controller.enqueue(chunk.value);
            } catch { end(); controller.error(new Error("Provider stream ended unexpectedly")); }
          },
          async cancel() {
            ended = true;
            abortController.abort();
            try { await reader.cancel(); } finally { release(); }
          },
        });
        record.cancel = async () => {
          abortController.abort();
          try { await reader.cancel(); } catch { /* already closed */ }
          end();
        };
        return new Response(stream, {
          status: upstream.status,
          headers: {
            "content-type": upstream.headers.get("content-type") ?? "application/json",
            "cache-control": "no-store",
          },
        });
      } catch {
        release();
        return Response.json({ error: { message: "Provider request failed" } }, { status: 502 });
      }
    },
  });

  return {
    baseUrl: new URL("v1", server.url).href,
    token,
    cleanup: () => stopped ??= (async () => {
      closing = true;
      const pending = [...active];
      for (const record of pending) record.abort.abort();
      await Promise.allSettled(pending.map(async record => { await record.cancel?.(); await record.done; }));
      await server.stop(true);
    })(),
  };
}

/** Prepare a Hermes run with isolated config, catalog and durable session state. */
export async function prepareHermesLaunch(input: HarnessLaunchInput): Promise<PreparedLaunch> {
  if (!isAbsolute(input.stateDir) || !isAbsolute(input.cwd)) throw new Error("Launch state and working directories must be absolute.");
  if (input.protocol !== "anthropic-messages" && input.protocol !== "openai-responses" && input.protocol !== "openai-chat")
    throw new Error("Hermes does not support this provider protocol.");
  if (!input.models.length || !input.models.some(model => model.id === input.model))
    throw new Error("Selected model is missing from the launch catalog.");
  if (new Set(input.models.map(model => model.id.toLowerCase())).size !== input.models.length)
    throw new Error("Hermes cannot safely select model IDs that differ only by letter case; update the provider catalog.");
  if (input.credential && /[\r\n]/.test(input.credential)) throw new Error("Provider credential contains invalid header characters.");

  const sessionDir = input.sessionDir ?? join(input.stateDir, "hermes-session");
  const sessionsDir = join(sessionDir, "sessions");
  await mkdir(input.stateDir, { recursive: true, mode: 0o700 });
  await mkdir(sessionsDir, { recursive: true, mode: 0o700 });
  // Hermes anchors state.db and JSONL transcripts to HERMES_HOME. Symlinking
  // only these two state surfaces leaves config/logs/cache per-launch while
  // preserving resume history in the caller-owned session directory.
  await symlink(join(sessionDir, "state.db"), join(input.stateDir, "state.db"));
  await symlink(sessionsDir, join(input.stateDir, "sessions"));

  const bridge = createHermesBridge(input);
  const config = {
    model: {
      provider: "custom",
      default: input.model,
      base_url: bridge.baseUrl,
      api_mode: apiMode[input.protocol],
    },
    providers: {
      custom: {
        name: "Switcher",
        base_url: bridge.baseUrl,
        api_mode: apiMode[input.protocol],
        key_env: "SWITCHER_HARNESS_API_KEY",
      },
    },
  };
  const configPath = join(input.stateDir, "config.yaml");
  try {
    await writeFile(configPath, JSON.stringify(config, null, 2) + "\n", { mode: 0o600, flag: "wx" });
  } catch (error) {
    await bridge.cleanup();
    throw error;
  }
  return {
    executable: input.executable ?? "hermes",
    args: ["--provider", "custom", "--model", input.model, ...(input.args ?? [])],
    env: {
      HERMES_HOME: input.stateDir,
      SWITCHER_HARNESS_API_KEY: bridge.token,
    },
    configPaths: [configPath],
    warnings: [
      "Hermes uses a per-launch loopback catalog/auth bridge; the selected Switcher model catalog remains authoritative.",
      "Hermes sessions and transcripts persist under the profile session directory; generated config, cache and bridge state are removed after this launch.",
      ...(input.authStyle && input.authStyle !== "bearer" ? ["Hermes enforces its native protocol header at the loopback bridge; the bridge translates the selected credential to the provider's declared authentication header."] : []),
    ],
    cleanup: bridge.cleanup,
  };
}
