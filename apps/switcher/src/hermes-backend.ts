import { proxyProviderStream } from "./provider-stream";
import { createProviderRequest, type ProviderRequestTiming } from "./provider-request";
import {compileHermesModelPolicy} from "./hermes-model-policy";
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
export function createHermesBridge(input: Pick<HarnessLaunchInput, "baseUrl" | "protocol" | "authStyle" | "model" | "models" | "credential">, timing: ProviderRequestTiming = {}) {
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
    async fetch(request, server) {
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
      const activity = createProviderRequest(request.signal, abortController.signal, timing);
      const release = () => { activity.finish(); active.delete(record); complete(); };
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

      server.timeout(request, 0);
      try {
        const upstream = await activity.run(() => fetch(`${input.baseUrl}${routePath[protocol].replace(/^\/v1/, "")}`, {
          method: "POST",
          headers,
          body: JSON.stringify(body),
          redirect: "manual",
          ...activity.fetchOptions,
        }));
        if (!upstream.ok) {
          void upstream.body?.cancel().catch(() => undefined);
          release();
          return Response.json({ error: { message: `Provider returned HTTP ${upstream.status}` } }, { status: upstream.status });
        }
        if (!upstream.body) { release(); return new Response(null, { status: upstream.status }); }
        const {stream, cancel} = proxyProviderStream({response: upstream, protocol: input.protocol, requestSignal: request.signal, abort: abortController, closing: () => closing, release, activity});
        record.cancel = cancel;
        return new Response(stream, {
          status: upstream.status,
          headers: {
            "content-type": upstream.headers.get("content-type") ?? "application/json",
            "cache-control": "no-store",
          },
        });
      } catch {
        release();
        return Response.json({ error: { message: activity.timedOut() ? "Provider request timed out waiting for activity" : "Provider request failed" } }, { status: activity.timedOut() ? 504 : 502 });
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
  let policy:ReturnType<typeof compileHermesModelPolicy>;
  try{policy=compileHermesModelPolicy(input.model,input.compiledPolicy?.roles??{},bridge.baseUrl,apiMode[input.protocol]);}catch(error){await bridge.cleanup();throw error;}
  const config = {
    auxiliary:policy.auxiliary,delegation:policy.delegation,
    fallback_providers:[],
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
      SWITCHER_HERMES_AUX_API_KEY:bridge.token,
      OPENAI_API_KEY:bridge.token,
      OPENAI_BASE_URL:bridge.baseUrl,
      CODEX_HOME:join(input.stateDir,"codex-home"),
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
