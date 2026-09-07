import { createHash, randomUUID } from "node:crypto";
import { domainToASCII } from "node:url";
import { setTimeout as delay } from "node:timers/promises";
import { canonicalSender } from "./email-address.js";
import type { MailDataSource } from "./mail-data-source.js";
import type { IngestBatchReport } from "./inbox-ingest-api.js";
import { ApiError, EmailsSelfHostClient } from "../selfhost.js";
import { SelfHostedMailDataSource } from "./self-hosted-mail-data-source.js";
import { resolveEmailsHostedTransport } from "./emails-credentials.js";
import { loadEmailsClientEnvSecret } from "./client-env.js";

export interface RoundtripOptions {
  domain: string;
  provider: string;
  addresses?: string;
  count?: string | number;
  pollAttempts?: string | number;
  pollInterval?: string | number;
  throttle?: string | number;
  idempotencyKey?: string;
  source?: string;
  bucket?: string;
  syncCursor?: string;
  profile?: string;
}
export interface RoundtripDeps {
  mail: Pick<MailDataSource, "send" | "verificationCandidates">;
  sync?: (input: Record<string, unknown>) => Promise<IngestBatchReport>;
  sleep?: (milliseconds: number, signal?: AbortSignal) => Promise<void>;
  signal?: AbortSignal;
}

export async function createRoundtripMail(signal?: AbortSignal): Promise<RoundtripDeps["mail"]> {
  loadEmailsClientEnvSecret(process.env);
  const transport = resolveEmailsHostedTransport(process.env);
  const credentials = [{ setting: transport.credentialSetting, value: transport.credential }, ...(transport.credentialFallbacks ?? [])];
  const reader = new SelfHostedMailDataSource({ baseUrl: transport.baseUrl, apiKey: transport.credential, credentials,
    fetchImpl: (url, init) => fetch(url, { ...init, signal: signal ? AbortSignal.any([signal, ...(init?.signal ? [init.signal] : [])]) : init?.signal }),
  });
  const base = new URL(transport.baseUrl);
  base.pathname = base.pathname.replace(/\/v1\/?$/, "").replace(/\/$/, "");
  const clients = credentials.map(credential => new EmailsSelfHostClient({ baseUrl: base.toString().replace(/\/$/, ""), bearerToken: credential.value }));
  const request = async <T>(operation: (client: EmailsSelfHostClient) => Promise<T>): Promise<T> => {
    for (let index = 0; index < clients.length; index++) {
      try { return await operation(clients[index]!); }
      catch (error) { if (!(error instanceof ApiError) || error.status !== 401 || index === clients.length - 1) throw error; }
    }
    throw new Error("No API credential is configured.");
  };
  const document = await request(client => client.getOpenApiDocument({ signal })) as { paths?: Record<string, { post?: { requestBody?: { content?: Record<string, { schema?: { properties?: Record<string, unknown> } }> } } }> };
  if (!document.paths?.["/v1/messages/send"]?.post?.requestBody?.content?.["application/json"]?.schema?.properties?.provider_id) throw new Error("The Emails API needs provider-aware sending before a roundtrip can run. No message was sent.");
  return {
    verificationCandidates: (address, options) => reader.verificationCandidates(address, options),
    send: async input => {
      const response = await request(client => client.sendMessage({ from: input.from!, to: [input.to], subject: input.subject, text: input.body, provider_id: input.providerId, idempotency_key: input.idempotencyKey! }, { signal }));
      const result = response as { sent?: boolean; in_progress?: boolean; message?: { id?: string; send_state?: string }; provider_message_id?: string; idempotent_replay?: boolean };
      if (result.sent !== true || result.in_progress === true || result.message?.send_state !== "sent" || !result.message.id) return { id: result.message?.id ?? "", messageId: "", inProgress: true };
      return { id: result.message.id, messageId: result.provider_message_id ?? result.message.id, idempotentReplay: result.idempotent_replay === true };
    },
  };
}
export interface RoundtripItem {
  from: string;
  to: string;
  subject: string;
  token: string;
  send_key: string;
  state: "not_attempted" | "sent" | "received" | "uncertain" | "failed";
  outbound_id?: string;
  inbound_id?: string;
  received_at?: string;
  replayed?: boolean;
  error?: string;
}
const hash = (value: string) => createHash("sha256").update(value).digest("hex");
function integer(value: string | number | undefined, fallback: number, min: number, max: number, name: string): number {
  const number = value === undefined ? fallback : typeof value === "number" ? value : /^\d+$/.test(value) ? Number(value) : NaN;
  if (!Number.isSafeInteger(number) || number < min || number > max) throw new Error(`${name} must be an integer between ${min} and ${max}.`);
  return number;
}
export function planRoundtrip(options: RoundtripOptions) {
  if (options.profile !== undefined) throw new Error("AWS profiles are server-owned. Configure the Emails API ingest binding; use --source to select it.");
  for (const [name, value, max] of [["source", options.source, 256], ["bucket", options.bucket, 63], ["sync cursor", options.syncCursor, 4096]] as const) {
    if (value !== undefined && (!value.trim() || value.length > max || /[\x00-\x1f\x7f]/.test(value))) throw new Error(`Invalid ${name}.`);
  }
  if (options.syncCursor !== undefined && options.source === undefined && options.bucket === undefined) throw new Error("A sync cursor requires --source or --bucket.");
  const domain = domainToASCII(options.domain.trim().toLowerCase());
  if (!domain.includes(".") || !canonicalSender(`roundtrip@${domain}`)) throw new Error("A valid roundtrip domain is required.");
  if (!options.provider?.trim() || options.provider.length > 256 || /[\x00-\x1f\x7f]/.test(options.provider)) throw new Error("A provider ID is required.");
  const addresses = (options.addresses ?? "one,two,three").split(",").map(value => value.trim().toLowerCase());
  if (addresses.length < 2 || addresses.length > 20 || new Set(addresses).size !== addresses.length || addresses.some(value => value.includes("@") || canonicalSender(`${value}@${domain}`) !== `${value}@${domain}`)) throw new Error("Choose 2–20 distinct valid local parts on the roundtrip domain.");
  const count = integer(options.count, 16, 1, 100, "Count");
  if (addresses.length * count > 500) throw new Error("A roundtrip run is limited to 500 messages.");
  const attempts = integer(options.pollAttempts, 12, 1, 120, "Poll attempts");
  const pollInterval = integer(options.pollInterval, 10000, 0, 60000, "Poll interval");
  const throttle = integer(options.throttle, 1100, 0, 60000, "Throttle");
  const runId = options.idempotencyKey ?? randomUUID();
  if (!/^[A-Za-z0-9._:-]{1,128}$/.test(runId)) throw new Error("Idempotency key must contain 1–128 letters, digits, dots, colons, underscores or hyphens.");
  const items: RoundtripItem[] = [];
  for (let round = 0; round < count; round++) for (let index = 0; index < addresses.length; index++) {
    const from = `${addresses[index]}@${domain}`, to = `${addresses[(index + 1) % addresses.length]}@${domain}`;
    const slot = round * addresses.length + index;
    const token = `EMAILS_ROUNDTRIP_${hash(`${runId}:${slot}:${domain}:${from}:${to}`).slice(0, 40)}`;
    items.push({ from, to, subject: `[Emails roundtrip] ${token}`, token, send_key: `roundtrip:${hash(`${runId}:${slot}`)}`, state: "not_attempted" });
  }
  return { runId, provider: options.provider.trim(), attempts, pollInterval, throttle, items };
}

/** Uses the authenticated app transport; receipts must contain the exact sent token. */
export async function runRoundtrip(options: RoundtripOptions, deps: RoundtripDeps) {
  const plan = planRoundtrip(options);
  const sleep = deps.sleep ?? ((ms, signal) => delay(ms, undefined, { signal }));
  const errors: string[] = [];
  let syncCursor = options.syncCursor;
  const result = () => ({
    run_id: plan.runId,
    complete: plan.items.every(item => item.state === "received"),
    expected: plan.items.length,
    confirmed_sent: plan.items.filter(item => item.state === "sent" || item.state === "received").length,
    received: plan.items.filter(item => item.state === "received").length,
    sync_cursor: syncCursor ?? null,
    items: plan.items,
    errors,
  });
  const sync = async () => {
    if (!deps.sync) return;
    const report = await deps.sync({ provider_id: plan.provider, limit: 10, ...(options.source ? { source_id: options.source } : {}), ...(options.bucket ? { bucket: options.bucket } : {}), ...(syncCursor ? { cursor: syncCursor } : {}) });
    if (!report.ok || report.sources.length !== 1 || report.sources[0]!.error > 0) throw new Error("Roundtrip source synchronization did not complete successfully; inspect inbox source status.");
    syncCursor = report.sources[0]!.next_cursor ?? undefined;
  };
  try {
    deps.signal?.throwIfAborted();
    // Check that both read and optional ingest paths work before sending anything.
    await deps.mail.verificationCandidates(plan.items[0]!.to, { subject: plan.items[0]!.subject, limit: 1 });
    await sync();
    for (const item of plan.items) {
      deps.signal?.throwIfAborted();
      try {
        const sent = await deps.mail.send({ from: item.from, to: item.to, subject: item.subject, body: item.token, markdown: false, providerId: plan.provider, idempotencyKey: item.send_key });
        if (sent.inProgress || !sent.id || !sent.messageId || sent.scheduled) {
          item.state = "uncertain";
          item.error = "Send is not confirmed. Retry this run only with the same idempotency key.";
          return result();
        }
        item.state = "sent";
        item.outbound_id = sent.id;
        item.replayed = sent.idempotentReplay === true;
      } catch {
        // A transport failure may occur after provider acceptance. Preserve the send key.
        item.state = "uncertain";
        item.error = "Send did not return a confirmed receipt. Inspect the send intent and retry only with the same run idempotency key.";
        return result();
      }
      if (plan.throttle && item !== plan.items.at(-1)) await sleep(plan.throttle, deps.signal);
    }
    for (let attempt = 0; attempt < plan.attempts; attempt++) {
      deps.signal?.throwIfAborted();
      await sync();
      for (const item of plan.items.filter(item => item.state === "sent")) {
        const candidates = await deps.mail.verificationCandidates(item.to, { subject: item.subject, from: item.from, limit: 100 });
        const received = candidates.find(row => row.subject === item.subject && canonicalSender(row.from_address) === item.from && row.text_body?.trim() === item.token);
        if (received) { item.state = "received"; item.inbound_id = received.id; item.received_at = received.received_at; }
      }
      if (plan.items.every(item => item.state === "received")) return result();
      if (attempt + 1 < plan.attempts && plan.pollInterval) await sleep(plan.pollInterval, deps.signal);
    }
  } catch {
    errors.push(deps.signal?.aborted ? "Roundtrip interrupted; retain the run idempotency key before retrying." : "Roundtrip could not verify the API read or ingest path. Inspect inbox/source status before retrying this run.");
  }
  return result();
}
