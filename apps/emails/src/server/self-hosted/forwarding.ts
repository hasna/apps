import { canonicalSender } from "../../lib/email-address.js";
import type {
  ForwardingRunResult,
  ForwardingRunItem,
} from "../../lib/forwarding.js";

export interface ForwardingBatchOptions {
  limit?: number;
  providerId?: string;
  fromAddress?: string;
  backfill?: boolean;
}
export interface ForwardingClaim {
  rule_id: string;
  message_id: string;
  lease: string;
  snapshot: {
    rule: Record<string, unknown>;
    message: Record<string, unknown>;
    options: ForwardingBatchOptions;
  };
}
export interface ForwardingWorkStore {
  claimForwarding(options: ForwardingBatchOptions): Promise<ForwardingClaim[]>;
  finishForwarding(
    claim: ForwardingClaim,
    status: "sent" | "failed" | "skipped",
    sentId: string | null,
    error: string | null,
  ): Promise<boolean>;
}
export function normalizeForwardingOptions(
  input: Record<string, unknown>,
): ForwardingBatchOptions {
  if (
    Object.keys(input).some(
      (key) =>
        !["limit", "provider_id", "from_address", "backfill"].includes(key),
    )
  )
    throw new Error("Unknown forwarding run option");
  const limit = input.limit ?? 100;
  if (
    typeof limit !== "number" ||
    !Number.isSafeInteger(limit) ||
    limit < 1 ||
    limit > 1000
  )
    throw new Error("Forwarding limit must be an integer from 1 to 1000");
  if (
    input.provider_id !== undefined &&
    (typeof input.provider_id !== "string" || !input.provider_id.trim())
  )
    throw new Error("Forwarding provider_id must be nonempty");
  if (
    input.from_address !== undefined &&
    (typeof input.from_address !== "string" ||
      !canonicalSender(input.from_address))
  )
    throw new Error("Forwarding from_address must be one valid mailbox");
  if (input.backfill !== undefined && typeof input.backfill !== "boolean")
    throw new Error("Forwarding backfill must be boolean");
  return {
    limit,
    ...(typeof input.provider_id === "string"
      ? { providerId: input.provider_id.trim() }
      : {}),
    ...(typeof input.from_address === "string"
      ? { fromAddress: canonicalSender(input.from_address)! }
      : {}),
    backfill: input.backfill === true,
  };
}

/** Used for direct API CRUD too: rule configuration authorizes automatic mail copies. */
export function normalizeForwardingRule(
  input: Record<string, unknown>,
  create: boolean,
): Record<string, unknown> {
  const result = { ...input };
  const allowed = [
    "source_address",
    "target_address",
    "from_address",
    "provider_id",
    "mode",
    "enabled",
  ];
  if (Object.keys(input).some((key) => !allowed.includes(key)))
    throw new Error("Unknown forwarding rule field");
  for (const key of ["source_address", "target_address", "from_address"]) {
    const value = input[key];
    if (value === undefined && !(create && key !== "from_address")) continue;
    if (key === "from_address" && value === null) continue;
    const address = typeof value === "string" ? canonicalSender(value) : null;
    if (!address) throw new Error(`${key} must be one valid mailbox`);
    result[key] = address;
  }
  if (input.mode !== undefined && input.mode !== "app-copy")
    throw new Error("Forwarding mode must be app-copy");
  if (input.enabled !== undefined && typeof input.enabled !== "boolean")
    throw new Error("Forwarding enabled must be boolean");
  if (
    input.provider_id !== undefined &&
    input.provider_id !== null &&
    (typeof input.provider_id !== "string" || !input.provider_id.trim())
  )
    throw new Error("Forwarding provider_id must be nonempty");
  if (result.source_address && result.source_address === result.target_address)
    throw new Error("Forwarding source and target must differ");
  return { ...(create ? { mode: "app-copy", enabled: true } : {}), ...result };
}

const cleanLine = (value: unknown) =>
  String(value ?? "").replace(/[\x00-\x1f\x7f]/g, " ");
function copyPayload(
  claim: ForwardingClaim,
): { body: Record<string, unknown>; headers: Record<string, string> } | null {
  const { rule, message, options } = claim.snapshot;
  const source = canonicalSender(String(rule.source_address ?? ""));
  const target = canonicalSender(String(rule.target_address ?? ""));
  const from = canonicalSender(
    String(options.fromAddress ?? rule.from_address ?? source ?? ""),
  );
  if (!source || !target || !from || rule.mode !== "app-copy")
    throw new Error("Invalid forwarding rule snapshot");
  const receivedHeaders =
    message.headers && typeof message.headers === "object"
      ? (message.headers as Record<string, unknown>)
      : {};
  if (
    source === target ||
    Object.entries(receivedHeaders).some(([name, value]) => {
      const key = name.toLowerCase();
      return (
        key === "x-hasna-forwarded-for" ||
        key === "x-hasna-inbound-id" ||
        (key === "auto-submitted" &&
          String(value).trim().toLowerCase() !== "no")
      );
    })
  )
    return null;
  const originalSubject = cleanLine(message.subject).trim();
  const subject = /^fwd?:/i.test(originalSubject)
    ? originalSubject
    : `Fwd: ${originalSubject}`;
  const text = [
    "---------- Forwarded message ----------",
    `From: ${cleanLine(message.from_addr)}`,
    `Date: ${cleanLine(message.received_at ?? message.created_at)}`,
    "",
    String(message.body_text ?? ""),
  ].join("\n");
  const html = `<pre>${text.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;")}</pre>`;
  const provider = options.providerId ?? rule.provider_id;
  const headers = {
    "X-Hasna-Forwarded-For": source,
    "X-Hasna-Inbound-Id": cleanLine(claim.message_id),
    "Auto-Submitted": "auto-generated",
  };
  return {
    body: {
      from,
      to: [target],
      subject,
      text,
      html,
      idempotency_key: `forward:${claim.rule_id}:${claim.message_id}`,
      ...(provider ? { provider_id: provider } : {}),
    },
    headers,
  };
}

/** Every copy passes the normal authenticated send policy and durable send-intent ledger. */
export async function runForwardingBatch(
  store: ForwardingWorkStore,
  send: (
    body: Record<string, unknown>,
    headers: Record<string, string>,
  ) => Promise<Response>,
  options: ForwardingBatchOptions = {},
): Promise<ForwardingRunResult> {
  const claims = await store.claimForwarding(options);
  const result: ForwardingRunResult = {
    attempted: claims.length,
    sent: 0,
    failed: 0,
    skipped: 0,
    pending: 0,
    items: [],
  };
  for (const claim of claims) {
    let status: ForwardingRunItem["status"] = "processing",
      sentId: string | null = null,
      error: string | null = null;
    let payload: ReturnType<typeof copyPayload>;
    try {
      payload = copyPayload(claim);
    } catch {
      payload = null;
      status = "failed";
      error = "Invalid forwarding snapshot";
    }
    if (!payload && !error) {
      status = "skipped";
      error = "Forwarded or automated message: loop prevention";
    }
    if (payload) {
      try {
        const response = await send(payload.body, payload.headers);
        const body = (await response.json()) as Record<string, unknown>;
        const message = body.message as Record<string, unknown> | undefined;
        if (
          response.ok &&
          body.sent === true &&
          message?.send_state === "sent" &&
          typeof message.id === "string" &&
          typeof message.provider_message_id === "string" &&
          message.provider_message_id.trim()
        ) {
          status = "sent";
          sentId = message.id;
        } else if (
          response.status >= 500 ||
          response.status === 429 ||
          response.status === 202 ||
          body.sent === null ||
          body.in_progress === true ||
          body.reconciliation_required === true ||
          message?.send_state === "uncertain" ||
          message?.send_state === "sending"
        ) {
          status = "processing";
        } else {
          status = "failed";
          error =
            "Forwarding send was refused; inspect the send intent before retrying";
        }
      } catch {
        error =
          "Forwarding acknowledgement unavailable; retry preserves the same send identity";
      }
    }
    if (status !== "processing") {
      try {
        if (!(await store.finishForwarding(claim, status, sentId, error))) {
          status = "processing";
          error = "Forwarding lease was replaced";
        }
      } catch {
        status = "processing";
        error =
          "Forwarding completion unavailable; retry preserves the same send identity";
      }
    }
    if (status === "processing") result.pending!++;
    else result[status]++;
    result.items.push({
      rule_id: claim.rule_id,
      inbound_email_id: claim.message_id,
      target_address: String(claim.snapshot.rule.target_address),
      status,
      sent_email_id: sentId,
      error,
    });
  }
  return result;
}
