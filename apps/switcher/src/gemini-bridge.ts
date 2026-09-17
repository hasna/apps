import { proxyProviderStream } from "./provider-stream";
import { createProviderRequest, type ProviderRequestTiming } from "./provider-request";
import { createHash, timingSafeEqual } from "node:crypto";
import { endpoint } from "./domain";
import type { HarnessLaunchInput } from "./harness-types";

export function geminiBridge(input: HarnessLaunchInput, timing: ProviderRequestTiming = {}) {
  const token = crypto.randomUUID() + crypto.randomUUID(), digest = (value: string) => createHash("sha256").update(value).digest(), expected = digest(token);
  const models = new Set(input.models.map(model => model.id));
  let closing = false, stopped: Promise<void> | undefined;
  const active = new Set<{abort: AbortController; done: Promise<void>; cancel?: () => Promise<void>}>();
  const server = Bun.serve({hostname: "127.0.0.1", port: 0, maxRequestBodySize: 4 * 1024 * 1024, idleTimeout: 255, async fetch(request, server) {
    const fail = (status: number, message: string) => Response.json({error: {code: status, message}}, {status});
    if (closing) return fail(503, "Bridge is closing");
    if (!timingSafeEqual(expected, digest(request.headers.get("x-goog-api-key") ?? ""))) return fail(401, "Unauthorized");
    const url = new URL(request.url), match = /^\/v1beta\/models\/([^/]+):(generateContent|streamGenerateContent|countTokens)$/.exec(url.pathname);
    if (request.method !== "POST" || !match) return fail(404, "Unsupported Gemini route");
    let model: string;
    try { model = decodeURIComponent(match[1]); } catch { return fail(400, "Invalid model path"); }
    if (!models.has(model)) return fail(403, "Model is outside this launch catalog");
    if ([...url.searchParams.keys()].some(key => key !== "alt") || url.searchParams.getAll("alt").length > 1 || url.searchParams.has("alt") && url.searchParams.get("alt") !== "sse") return fail(400, "Unsupported query");
    let body: any;
    try { body = await request.json(); } catch { return fail(400, "Invalid JSON"); }
    if (!body || typeof body !== "object" || Array.isArray(body)) return fail(400, "Invalid request body");
    if (closing) return fail(503, "Bridge is closing");
    for (const declared of [body.model, body.generateContentRequest?.model]) if (declared !== undefined && declared !== model && declared !== `models/${model}`) return fail(403, "Conflicting model identity");
    const path = `/models/${encodeURIComponent(model)}:${match[2]}` + (url.searchParams.has("alt") ? "?alt=sse" : "");
    const headers: Record<string, string> = {"content-type": "application/json"};
    if (input.credential) headers["x-goog-api-key"] = input.credential;
    let complete!: () => void;
    const record: {abort: AbortController; done: Promise<void>; cancel?: () => Promise<void>} = {abort: new AbortController(), done: new Promise<void>(resolve => {complete = resolve;})};
    const activity = createProviderRequest(request.signal, record.abort.signal, timing);
    const release = () => {activity.finish(); active.delete(record); complete();};
    active.add(record);
    server.timeout(request, 0);
    try {
      const response = await activity.run(() => fetch(endpoint(input.baseUrl) + path, {method: "POST", headers, body: JSON.stringify(body), redirect: "manual", ...activity.fetchOptions}));
      if (!response.ok) {void response.body?.cancel().catch(() => undefined); release(); return fail(response.status >= 300 && response.status < 400 ? 502 : response.status, `Provider returned HTTP ${response.status}`);}
      if (!response.body) {release(); return new Response(null, {status: response.status});}
      const {stream, cancel} = proxyProviderStream({response, protocol: input.protocol, requestSignal: request.signal, abort: record.abort, closing: () => closing, release, activity});
      record.cancel = cancel;
      return new Response(stream, {status: response.status, headers: {"content-type": response.headers.get("content-type") ?? "application/json", "cache-control": "no-store"}});
    } catch {release(); return fail(activity.timedOut() ? 504 : 502, activity.timedOut() ? "Provider request timed out waiting for activity" : "Provider request failed");}
  }});
  return {baseUrl: new URL("v1beta", server.url).href, token, cleanup: () => stopped ??= (async () => {
    closing = true;
    const pending = [...active]; for (const request of pending) request.abort.abort();
    await Promise.allSettled(pending.map(async request => {await request.cancel?.(); await request.done;}));
    await server.stop(true);
  })()};
}
