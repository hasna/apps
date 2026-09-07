import { createHash, timingSafeEqual } from "node:crypto";
import { endpoint } from "./domain";
import type { HarnessLaunchInput } from "./harness-types";

export function geminiBridge(input: HarnessLaunchInput) {
  const token = crypto.randomUUID() + crypto.randomUUID(), digest = (value: string) => createHash("sha256").update(value).digest(), expected = digest(token);
  const models = new Set(input.models.map(model => model.id));
  let closing = false, stopped: Promise<void> | undefined;
  const active = new Set<{abort: AbortController; done: Promise<void>; cancel?: () => Promise<void>}>();
  const server = Bun.serve({hostname: "127.0.0.1", port: 0, maxRequestBodySize: 4 * 1024 * 1024, idleTimeout: 255, async fetch(request) {
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
    const release = () => {active.delete(record); complete();};
    active.add(record);
    try {
      const response = await fetch(endpoint(input.baseUrl) + path, {method: "POST", headers, body: JSON.stringify(body), redirect: "manual", signal: AbortSignal.any([request.signal, record.abort.signal, AbortSignal.timeout(240000)])});
      if (!response.ok) {await response.body?.cancel(); release(); return fail(response.status >= 300 && response.status < 400 ? 502 : response.status, `Provider returned HTTP ${response.status}`);}
      if (!response.body) {release(); return new Response(null, {status: response.status});}
      const reader = response.body.getReader(); let ended = false, output: ReadableStreamDefaultController<Uint8Array>;
      const end = (error?: Error) => {if (ended) return; ended = true; try {if (error && !closing) output.error(error); else output.close();} catch {} release();};
      const stream = new ReadableStream<Uint8Array>({
        start(controller) {output = controller;},
        async pull(controller) {try {const chunk = await reader.read(); if (ended) return; if (chunk.done) end(); else controller.enqueue(chunk.value);} catch {end(new Error("Provider stream ended unexpectedly"));}},
        async cancel() {ended = true; record.abort.abort(); try {await reader.cancel();} finally {release();}},
      });
      record.cancel = async () => {record.abort.abort(); try {await reader.cancel();} catch {} finally {end();}};
      return new Response(stream, {status: response.status, headers: {"content-type": response.headers.get("content-type") ?? "application/json", "cache-control": "no-store"}});
    } catch {release(); return fail(502, "Provider request failed");}
  }});
  return {baseUrl: new URL("v1beta", server.url).href, token, cleanup: () => stopped ??= (async () => {
    closing = true;
    const pending = [...active]; for (const request of pending) request.abort.abort();
    await Promise.allSettled(pending.map(async request => {await request.cancel?.(); await request.done;}));
    await server.stop(true);
  })()};
}
