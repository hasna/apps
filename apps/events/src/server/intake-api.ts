import { verifyApiKey, type ApiKeyVerifier } from "@hasna/contracts/auth";
import { IntakeError, MAX_REQUEST_BYTES, validateBinding, type IntakeBinding } from "../intake/protocol.js";
import spec from "../../schemas/intake.openapi.json";
import pkg from "../../package.json";
import { IntakePostgres } from "./intake-postgres.js";

export function bindingHeaders(binding: IntakeBinding): Record<string, string> {
  return { "x-events-sink-id": binding.sink_id, "x-events-producer-id": binding.producer_id, "x-events-corpus-id": binding.corpus_id, "x-events-source-authority-id": binding.source_authority_id };
}
function requestBinding(headers: Headers): IntakeBinding {
  return validateBinding({ sink_id: headers.get("x-events-sink-id"), producer_id: headers.get("x-events-producer-id"), corpus_id: headers.get("x-events-corpus-id"), source_authority_id: headers.get("x-events-source-authority-id") });
}
function json(body: unknown, status = 200): Response {
  return Response.json(body, { status, headers: { "cache-control": "no-store", "x-content-type-options": "nosniff" } });
}
async function readBody(request: Request): Promise<unknown> {
  if (request.headers.get("content-type")?.split(";")[0]?.trim() !== "application/json") throw new IntakeError("json_content_type_required", 415);
  const reader = request.body?.getReader();
  if (!reader) throw new IntakeError("request_body_required");
  const chunks: Uint8Array[] = []; let size = 0;
  try {
    for (;;) {
      const next = await reader.read(); if (next.done) break;
      size += next.value.byteLength;
      if (size > MAX_REQUEST_BYTES) throw new IntakeError("request_too_large", 413);
      chunks.push(next.value);
    }
    return JSON.parse(new TextDecoder("utf-8", { fatal: true }).decode(Buffer.concat(chunks)));
  } catch (error) {
    await reader.cancel().catch(() => {});
    if (error instanceof IntakeError) throw error;
    throw new IntakeError("invalid_request_json");
  } finally { reader.releaseLock(); }
}
export function createIntakeHandler(store: IntakePostgres, signingSecret: string | Buffer) {
  const verifier: ApiKeyVerifier = verifyApiKey({ app: "events", signingSecret, keyStatus: store.keys.keyStatus });
  return async (request: Request): Promise<Response> => {
    try {
      const url = new URL(request.url);
      if (request.method === "GET" && url.pathname === "/version") return json({ version: pkg.version });
      if (request.method === "GET" && url.pathname === "/openapi.json") return json(spec);
      if (request.method === "GET" && url.pathname === "/health") return json({ status: "alive" });
      if (request.method === "GET" && url.pathname === "/ready") { await store.ready(); return json({ status: "ready" }); }
      const accepting = request.method === "POST" && url.pathname === "/v1/intake/events";
      const capability = request.method === "GET" && url.pathname === "/v1/intake/capability";
      const reading = request.method === "GET" && url.pathname === "/v1/intake/receipts";
      if (!accepting && !capability && !reading) return json({ error: "not_found" }, 404);
      const tenant = request.headers.get("x-events-tenant-id") ?? "";
      const auth = await verifier.authenticate(request.headers, { method: request.method, path: url.pathname, expectedTid: tenant, requiredScopes: [accepting ? "events:intake" : "events:receipts"] });
      if (!auth.ok) return json({ error: "intake_authentication_denied" }, auth.status);
      const binding = requestBinding(request.headers);
      if (capability) return json(await store.capability(auth.principal, binding));
      if (reading) return json(await store.read(auth.principal, binding, url.searchParams.get("event_id") ?? ""));
      const body = await readBody(request);
      const actual = validateBinding(body);
      if (JSON.stringify(actual) !== JSON.stringify(binding)) throw new IntakeError("request_binding_mismatch", 409);
      return json(await store.accept(auth.principal, body), 201);
    } catch (error) {
      // SQL/provider/parser exceptions may contain payloads or connection data.
      return json({ error: error instanceof IntakeError ? error.code : "intake_unavailable" }, error instanceof IntakeError ? error.status : 503);
    }
  };
}
