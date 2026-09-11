import { HostedRecordingsClient } from "../hosted/index.js";
import { HostedLibrary, type HostedLibraryOptions } from "../hosted/library.js";
import { HostedPasteHistory } from "../hosted/paste-history.js";
import { RecordingsSDKError } from "../hosted/transport.js";
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
/** Explicit proxy mode: the caller's bearer is the sole credential; the upstream cannot be selected by a request. */
export function buildHostedFetch(options: { apiBase: string; fetch?: typeof globalThis.fetch }) {
  const apiBase = new HostedRecordingsClient({ apiBase: options.apiBase }).apiBase;
  return async (request: Request): Promise<Response> => {
    try {
      const url = new URL(request.url);
      if (request.headers.has("origin") || request.headers.has("cookie")) throw new RecordingsSDKError("forbidden");
      if (url.pathname === "/health" && request.method === "GET") return json({ status: "ok", mode: "hosted-library" });
      const match = /^\/v1\/recordings(?:\/([^/]+))?$/.exec(url.pathname);
      const isPasteHistory = url.pathname === "/v1/paste-history";
      if (!match && !isPasteHistory) return json({ error: { code: "not_found", message: "This hosted Library route does not exist." } }, 404);
      if (request.method !== "GET") return json({ error: { code: "read_only", message: "Hosted Library mode supports GET only." } }, 405);
      const page = readOptions(url, isPasteHistory || match?.[1] === undefined);
      const bearer = /^Bearer ([A-Za-z0-9._~+/-]{1,16000}={0,2})$/i.exec(request.headers.get("authorization") ?? "")?.[1];
      if (!bearer) throw new RecordingsSDKError("unauthorized");
      const client = new HostedRecordingsClient({ apiBase, fetch: options.fetch, credentialProvider: () => bearer });
      const library = new HostedLibrary(client);
      const result = isPasteHistory ? await new HostedPasteHistory(client).list(page, { signal: request.signal })
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
