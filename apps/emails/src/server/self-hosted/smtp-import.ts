import { createHash } from "node:crypto";
import { parseInboundMime } from "../../lib/inbound-mime.js";
import { resourceSpecForPath } from "./resources.js";
import type { EmailsSelfHostedStore, TenantScopedStore } from "./store.js";

export const SMTP_IMPORT_MAX_BYTES = 10 * 1024 * 1024;
export const SMTP_IMPORT_JSON_BYTES = Math.ceil(SMTP_IMPORT_MAX_BYTES / 3) * 4 + 65536;
export class SmtpImportError extends Error { constructor(message: string, readonly status = 400) { super(message); } }
export async function smtpImportCapability(scoped: TenantScopedStore, provider: unknown) {
  if (provider !== undefined && (typeof provider !== "string" || !provider.trim() || provider.length > 256)) throw new SmtpImportError("Invalid SMTP provider selector.");
  if (typeof provider === "string" && !(await scoped.getResource(resourceSpecForPath("providers")!, provider))) throw new SmtpImportError("SMTP provider is not registered in this tenant.", 404);
  return { available: true, durable_receipts: true, max_raw_bytes: SMTP_IMPORT_MAX_BYTES, provider_id: provider ?? null };
}
function mailbox(value: unknown, empty = false): value is string {
  return typeof value === "string" && ((empty && value === "") || (value.length <= 254 && /^[^\s<>@\x00-\x1f\x7f]+@[A-Za-z0-9](?:[A-Za-z0-9.-]*[A-Za-z0-9])?$/.test(value)));
}
export async function importSmtpMessage(store: EmailsSelfHostedStore, scoped: TenantScopedStore, tenantId: string, input: Record<string, unknown>) {
  if (Object.keys(input).some(key => !["transaction_id", "raw_base64", "envelope", "provider_id"].includes(key))) throw new SmtpImportError("Unknown SMTP submission field.");
  await smtpImportCapability(scoped, input.provider_id);
  if (typeof input.transaction_id !== "string" || !/^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(input.transaction_id)) throw new SmtpImportError("Invalid SMTP transaction identity.");
  const envelope = input.envelope as { from?: unknown; to?: unknown } | undefined;
  if (!envelope || typeof envelope !== "object" || Array.isArray(envelope) || Object.keys(envelope).some(key => key !== "from" && key !== "to") || !mailbox(envelope.from, true) || !Array.isArray(envelope.to) || envelope.to.length < 1 || envelope.to.length > 100 || !envelope.to.every(value => mailbox(value))) throw new SmtpImportError("Invalid SMTP envelope.");
  if (typeof input.raw_base64 !== "string" || input.raw_base64.length > Math.ceil(SMTP_IMPORT_MAX_BYTES / 3) * 4) throw new SmtpImportError("SMTP raw message exceeds the 10 MiB limit.", 413);
  const raw = Buffer.from(input.raw_base64, "base64");
  if (raw.length > SMTP_IMPORT_MAX_BYTES) throw new SmtpImportError("SMTP raw message exceeds the 10 MiB limit.", 413);
  if (raw.toString("base64") !== input.raw_base64) throw new SmtpImportError("SMTP raw message must use canonical base64.");
  const recipients = [...new Set((envelope.to as string[]).map(value => value.toLowerCase()))].sort();
  const route = await store.resolveInboundRecipients(recipients);
  if (route.unresolved.length || route.groups.length !== 1 || route.groups[0]!.tenantId !== tenantId || route.groups[0]!.recipients.length !== recipients.length) throw new SmtpImportError("Every SMTP envelope recipient must route exclusively to the authenticated tenant.", 403);
  let parsed;
  try { parsed = await parseInboundMime(raw); } catch { throw new SmtpImportError("Invalid SMTP MIME message."); }
  if (parsed.attachments.length > 100 || parsed.attachments.reduce((total, item) => total + item.size, 0) > SMTP_IMPORT_MAX_BYTES) throw new SmtpImportError("SMTP attachments exceed the supported limit.", 413);
  const payloadHash = createHash("sha256").update(JSON.stringify({ raw_sha256: createHash("sha256").update(raw).digest("hex"), from: envelope.from, to: recipients, provider_id: input.provider_id ?? null })).digest("hex");
  try {
    return await scoped.submitSmtpMessage({
      direction: "inbound", from_addr: parsed.from_addr || envelope.from || "(unknown sender)", to_addrs: recipients, cc_addrs: [],
      subject: parsed.subject || null, body_text: parsed.body_text, body_html: parsed.body_html, status: "received",
      message_id: parsed.rfc_message_id, in_reply_to: parsed.in_reply_to, received_at: new Date().toISOString(),
      headers: parsed.headers, attachments: parsed.attachments, source_id: `smtp:${input.transaction_id}`,
      ...(typeof input.provider_id === "string" ? { provider_id: input.provider_id } : {}),
    }, input.transaction_id, payloadHash);
  } catch (error) {
    if (error instanceof Error && error.message === "SMTP transaction identity conflicts with the original content") throw new SmtpImportError(error.message, 409);
    throw error;
  }
}
