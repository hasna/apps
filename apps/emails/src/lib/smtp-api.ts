import { resolveEmailsHostedTransport } from "./emails-credentials.js";
import { loadEmailsClientEnvSecret } from "./client-env.js";
import { listenSmtp, SMTP_MAX_MESSAGE_BYTES, type SmtpDelivery } from "./smtp-receiver.js";

export async function smtpApiRequest(path: string, body?: unknown): Promise<Record<string, unknown>> {
  loadEmailsClientEnvSecret(process.env);
  const transport = resolveEmailsHostedTransport(process.env);
  const credentials = [transport.credential, ...(transport.credentialFallbacks ?? []).map(item => item.value)];
  for (let index = 0; index < credentials.length; index++) {
    const response = await fetch(transport.baseUrl + path, { method: body === undefined ? "GET" : "POST", redirect: "error", headers: { Authorization: `Bearer ${credentials[index]}`, "Content-Type": "application/json" }, ...(body === undefined ? {} : { body: JSON.stringify(body) }), signal: AbortSignal.timeout(30000) });
    if (response.status === 401 && index < credentials.length - 1) continue;
    const result = await response.json().catch(() => ({})) as Record<string, unknown>;
    if (!response.ok || response.status === 202) throw new Error(`SMTP API did not confirm durable storage (HTTP ${response.status}).`);
    return result;
  }
  throw new Error("No Emails API credential is configured.");
}
export type SmtpApiRequest = typeof smtpApiRequest;
export async function persistSmtpDelivery(delivery: SmtpDelivery, provider: string | undefined, request: SmtpApiRequest = smtpApiRequest) {
  // A transport retry reuses the exact DATA transaction and bytes, including after an uncertain response.
  const body = { transaction_id: delivery.transactionId, raw_base64: delivery.raw.toString("base64"), envelope: delivery.envelope, ...(provider !== undefined ? { provider_id: provider } : {}) };
  for (let attempt = 0; attempt < 2; attempt++) {
    try {
      const result = await request("/inbox/smtp", body);
      if (result.stored !== true || typeof result.id !== "string" || !result.id.trim() || typeof result.duplicate !== "boolean") throw new Error("SMTP API returned no durable receipt.");
      return { id: result.id };
    } catch (error) { if (attempt === 1) throw error; }
  }
  throw new Error("SMTP API returned no durable receipt.");
}
export async function startApiSmtpListener(port: number, provider?: string, request: SmtpApiRequest = smtpApiRequest) {
  if (!Number.isSafeInteger(port) || port < 0 || port > 65535) throw new Error("SMTP port must be an integer between 0 and 65535.");
  if (provider !== undefined && (!provider.trim() || provider.length > 256)) throw new Error("Invalid SMTP provider selector.");
  const capability = await request(`/inbox/smtp${provider !== undefined ? `?provider_id=${encodeURIComponent(provider)}` : ""}`);
  if (capability.available !== true || capability.durable_receipts !== true || !Number.isSafeInteger(capability.max_raw_bytes) || Number(capability.max_raw_bytes) < 1 || capability.provider_id !== (provider ?? null)) throw new Error("The Emails API needs SMTP import support before a listener can start.");
  return listenSmtp({ port, maxMessageBytes: Math.min(SMTP_MAX_MESSAGE_BYTES, Number(capability.max_raw_bytes)), persist: delivery => persistSmtpDelivery(delivery, provider, request) });
}
