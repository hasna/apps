import { HostedRecordingsClient } from "../hosted/index.js";
import { HostedLibrary, type HostedLibraryOptions } from "../hosted/library.js";
import { HostedPasteHistory } from "../hosted/paste-history.js";
import { input, RecordingsSDKError } from "../hosted/transport.js";
import { pasteInputParser, recordingInputParser, renameInputParser, type ContractParser, type HostedPasteInput, type HostedRecordingInput } from "../contracts/hosted-v1.js";
import { recordingIDParser } from "../contracts/stream-v1.js";
import { hostedFailure } from "../hosted/process-options.js";

function json(value: unknown, status = 200): Response {
  return Response.json(value, { status, headers: { "cache-control": "no-store", "x-content-type-options": "nosniff" } });
}
function readOptions(url: URL, list: boolean): HostedLibraryOptions {
  const allowed = list ? ["limit", "before", "beforeId", "includeText"] : ["includeText"];
  for (const key of url.searchParams.keys()) {
    if (!allowed.includes(key) || url.searchParams.getAll(key).length !== 1) throw new RecordingsSDKError("invalid_input");
  }
  const text = url.searchParams.get("includeText");
  if (text !== null && text !== "true" && text !== "false") throw new RecordingsSDKError("invalid_input");
  const page: HostedLibraryOptions = { includeText: text === "true" };
  if (url.searchParams.has("limit")) page.limit = Number(url.searchParams.get("limit"));
  if (url.searchParams.has("before")) page.before = url.searchParams.get("before")!;
  if (url.searchParams.has("beforeId")) page.beforeId = url.searchParams.get("beforeId")!;
  return page;
}
/** Hosted mutations read bounded JSON before passing it to the shared validated client. */
async function readJSON<T>(request: Request, maxBytes: number, parser: ContractParser<T>): Promise<T> {
  const contentLength = request.headers.get("content-length");
  if (!/^application\/json(?:\s*;.*)?$/i.test(request.headers.get("content-type") ?? "") ||
      (contentLength !== null && (!/^\d+$/.test(contentLength) || Number(contentLength) > maxBytes))) {
    throw new RecordingsSDKError("invalid_input");
  }
  const reader = request.body?.getReader();
  if (!reader) throw new RecordingsSDKError("invalid_input");
  let timedOut = false;
  const cancel = () => { void reader.cancel().catch(() => {}); };
  const timer = setTimeout(() => { timedOut = true; cancel(); }, 5000);
  request.signal.addEventListener("abort", cancel, { once: true });
  const chunks: Uint8Array[] = [];
  let length = 0;
  try {
    if (request.signal.aborted) throw new RecordingsSDKError("aborted");
    while (true) {
      const { done, value } = await reader.read();
      if (timedOut) throw new RecordingsSDKError("timeout");
      if (request.signal.aborted) throw new RecordingsSDKError("aborted");
      if (done) break;
      length += value.byteLength;
      if (length > maxBytes) throw new RecordingsSDKError("invalid_input");
      chunks.push(value);
    }
    const bytes = new Uint8Array(length);
    let offset = 0;
    for (const chunk of chunks) { bytes.set(chunk, offset); offset += chunk.byteLength; }
    const value: unknown = JSON.parse(new TextDecoder("utf-8", { fatal: true }).decode(bytes));
    return input(parser, value);
  } catch (error) {
    if (timedOut) throw new RecordingsSDKError("timeout");
    if (request.signal.aborted) throw new RecordingsSDKError("aborted");
    throw error;
  } finally {
    clearTimeout(timer); request.signal.removeEventListener("abort", cancel); cancel();
  }
}
async function renameTitle(request: Request): Promise<string> {
  return (await readJSON(request, 8192, renameInputParser)).title;
}
async function saveInput(request: Request): Promise<HostedRecordingInput> {
  return readJSON(request, 1_048_576, recordingInputParser);
}
async function pasteSaveInput(request: Request): Promise<HostedPasteInput> {
  return readJSON(request, 1_048_576, pasteInputParser);
}
/** Explicit proxy mode: the caller's bearer is the sole credential; the upstream cannot be selected by a request. */
export function buildHostedFetch(options: { apiBase: string; fetch?: typeof globalThis.fetch; allowWrites?: boolean }) {
  const apiBase = new HostedRecordingsClient({ apiBase: options.apiBase }).apiBase;
  return async (request: Request): Promise<Response> => {
    try {
      const url = new URL(request.url);
      if (request.headers.has("origin") || request.headers.has("cookie")) throw new RecordingsSDKError("forbidden");
      if (url.pathname === "/health" && request.method === "GET") return json({ status: "ok", mode: "hosted-library" });
      const match = /^\/v1\/recordings(?:\/([^/]+))?$/.exec(url.pathname);
      const exportMatch = /^\/v1\/recordings\/([^/]+)\/export$/.exec(url.pathname);
      const isPasteHistory = url.pathname === "/v1/paste-history";
      const isProviders = url.pathname === "/v1/providers";
      if (!match && !exportMatch && !isPasteHistory && !isProviders) return json({ error: { code: "not_found", message: "This hosted Library route does not exist." } }, 404);
      const recordingMutation = match !== null && ((Boolean(match[1]) && ["PATCH", "DELETE"].includes(request.method)) ||
        (!match[1] && request.method === "POST"));
      const pasteMutation = isPasteHistory && request.method === "POST";
      const mutation = recordingMutation || pasteMutation;
      if (request.method !== "GET" && (!mutation || options.allowWrites !== true)) return json({ error: { code: "read_only",
        message: options.allowWrites === true ? "This hosted Library route does not support the requested method." : "Hosted Library mode supports GET only." } }, 405);
      if ((isProviders || mutation || exportMatch) && url.searchParams.size) throw new RecordingsSDKError("invalid_input");
      if (request.method === "DELETE" && request.body !== null) throw new RecordingsSDKError("invalid_input");
      const page = isProviders || mutation || exportMatch ? {} : readOptions(url, isPasteHistory || match?.[1] === undefined);
      const bearer = /^Bearer ([A-Za-z0-9._~+/-]{1,16000}={0,2})$/i.exec(request.headers.get("authorization") ?? "")?.[1];
      if (!bearer) throw new RecordingsSDKError("unauthorized");
      const client = new HostedRecordingsClient({ apiBase, fetch: options.fetch, credentialProvider: () => bearer });
      const library = new HostedLibrary(client);
      if (exportMatch) {
        const exported = await library.export(decodeURIComponent(exportMatch[1]!), { signal: request.signal });
        return new Response(exported.text, { headers: { "content-type": exported.mediaType,
          "content-disposition": 'attachment; filename="' + exported.fileName + '"',
          "content-length": String(new TextEncoder().encode(exported.text).byteLength),
          "cache-control": "no-store", "x-content-type-options": "nosniff" } });
      }
      if (mutation) {
        if (pasteMutation) {
          return json(await new HostedPasteHistory(client).save(await pasteSaveInput(request), { signal: request.signal }), 201);
        }
        if (request.method === "POST") return json(await library.save(await saveInput(request), { signal: request.signal }), 201);
        const id = input(recordingIDParser, decodeURIComponent(match![1]!));
        if (request.method === "PATCH") return json(await library.rename(id, await renameTitle(request), { signal: request.signal }));
        const result = await library.delete(id, { signal: request.signal });
        return result.state === "pending" ? json({ audioCleanup: { state: "pending" } }, 202)
          : new Response(null, { status: 204, headers: { "cache-control": "no-store", "x-content-type-options": "nosniff" } });
      }
      const result = isProviders ? await client.providers({ signal: request.signal })
        : isPasteHistory ? await new HostedPasteHistory(client).list(page, { signal: request.signal })
        : match?.[1] ? await library.get(decodeURIComponent(match[1]), page, { signal: request.signal })
        : await library.list(page, { signal: request.signal });
      return json(result);
    } catch (error) {
      const result = hostedFailure(error), code = result.error.code;
      const status = code === "unauthorized" || code === "credential_unavailable" ? 401 : code === "forbidden" ? 403
        : code === "not_found" || code === "recording_deleted" ? 404 : code === "invalid_input" ? 400 : code === "timeout" ? 504 : 502;
      return json(result, status);
    }
  };
}
