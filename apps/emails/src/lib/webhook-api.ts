import { resolveEmailsHostedTransport } from "./emails-credentials.js";
import { loadEmailsClientEnvSecret } from "./client-env.js";
import { RouteBodyTooLargeError } from "../server/routes/request-body.js";

const ALLOWED_HEADERS = ["content-type", "svix-id", "svix-timestamp", "svix-signature", "x-amz-sns-message-type", "x-amz-sns-topic-arn", "x-amz-sns-subscription-arn"];
async function requestApi(path: string, original?: { body: Buffer; headers: Headers }): Promise<Response> {
  loadEmailsClientEnvSecret(process.env);
  const transport = resolveEmailsHostedTransport(process.env);
  const credentials = [transport.credential, ...(transport.credentialFallbacks ?? []).map(value => value.value)];
  for (let index = 0; index < credentials.length; index++) {
    const headers = new Headers();
    const signatureHeaders: Record<string, string> = {};
    if (original) for (const name of ALLOWED_HEADERS) { const value = original.headers.get(name); if (value !== null) signatureHeaders[name] = value; }
    headers.set("Authorization", `Bearer ${credentials[index]}`);
    headers.set("Content-Type", "application/json");
    const response = await fetch(transport.baseUrl + path, { method: original ? "POST" : "GET", headers, ...(original ? { body: JSON.stringify({ raw_body_base64: original.body.toString("base64"), signature_headers: signatureHeaders }) } : {}), redirect: "error", signal: AbortSignal.timeout(35000) });
    if (response.status === 401 && response.headers.get("x-emails-webhook-verification") !== "rejected" && index < credentials.length - 1) { await response.body?.cancel(); continue; }
    return response;
  }
  throw new Error("No Emails API credential is configured.");
}
export async function startApiWebhookListener(port: number, provider?: string) {
  if (!Number.isSafeInteger(port) || port < 0 || port > 65535) throw new Error("Webhook port must be an integer between 0 and 65535.");
  if (provider !== undefined && (!provider.trim() || provider.length > 256)) throw new Error("Invalid webhook provider selector.");
  const query = provider === undefined ? "" : `?provider_id=${encodeURIComponent(provider)}`;
  const response = await requestApi(`/webhooks/relay${query}`);
  const capability = await response.json().catch(() => ({})) as Record<string, unknown>;
  if (!response.ok || capability.available !== true || capability.signature_verification !== true || capability.durable_receipts !== true || typeof capability.provider_id !== "string" || !["ses", "resend"].includes(String(capability.type)) || (provider !== undefined && capability.provider_id !== provider)) throw new Error("The API must configure an authorized provider webhook binding before a listener can start.");
  const type = String(capability.type), selected = String(capability.provider_id);
  const server = Bun.serve({ hostname: "127.0.0.1", port, idleTimeout: 45, maxRequestBodySize: 1048576, fetch: async request => {
    const path = new URL(request.url).pathname;
    if (![ `/webhook/${type}`, `/webhook/${type}-inbound` ].includes(path)) return Response.json({ error: "This listener accepts only the selected provider route." }, { status: 404 });
    if (request.method !== "POST") return Response.json({ error: "method not allowed" }, { status: 405 });
    try {
      const reader = request.body?.getReader(), chunks: Uint8Array[] = []; let size = 0;
      if (reader) while (true) { const { done, value } = await reader.read(); if (done) break; size += value.byteLength; if (size > 1048576) { await reader.cancel(); throw new RouteBodyTooLargeError(); } chunks.push(value); }
      const body = Buffer.concat(chunks);
      const result = await requestApi(`/webhooks/relay/${type}?provider_id=${encodeURIComponent(selected)}`, { body, headers: request.headers });
      const receipt = await result.json().catch(() => ({})) as Record<string, unknown>;
      if (!result.ok || result.status === 202 || receipt.completed !== true || receipt.ok !== true || receipt.provider_id !== selected) return Response.json({ error: "The API did not confirm a verified, durable webhook receipt." }, { status: result.ok ? 502 : result.status });
      return Response.json(receipt);
    } catch (error) { return Response.json({ error: error instanceof RouteBodyTooLargeError ? "Webhook body exceeds 1 MiB." : "Webhook relay failed before completion; retry the original event." }, { status: error instanceof RouteBodyTooLargeError ? 413 : 503 }); }
  } });
  return { port: server.port!, provider_id: selected, type, stop: async () => { await server.stop(true); } };
}
