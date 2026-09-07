import { renderTemplate } from "../../db/templates.js";

export interface ScheduledWorkStore {
  claimDueScheduled(limit: number): Promise<Record<string, unknown>[]>;
  finishScheduled(
    id: string,
    lease: string,
    status: "sent" | "failed",
    error: string | null,
  ): Promise<boolean>;
  getScheduledTemplate(name: string): Promise<Record<string, unknown> | null>;
}

function jsonValue(value: unknown): unknown {
  if (typeof value !== "string") return value;
  try {
    return JSON.parse(value);
  } catch {
    throw new Error("Scheduled job contains invalid JSON");
  }
}

async function sendPayload(
  row: Record<string, unknown>,
  store: ScheduledWorkStore,
): Promise<Record<string, unknown>> {
  let subject = String(row.subject ?? "");
  let text = row.text_body == null ? undefined : String(row.text_body);
  let html = row.html == null ? undefined : String(row.html);
  if (row.template_name) {
    const template = await store.getScheduledTemplate(
      String(row.template_name),
    );
    if (!template)
      throw new Error(`Scheduled template not found: ${row.template_name}`);
    const raw = jsonValue(row.template_vars) ?? {};
    if (typeof raw !== "object" || Array.isArray(raw))
      throw new Error("Scheduled template variables must be an object");
    const vars = Object.fromEntries(
      Object.entries(raw).map(([key, value]) => [key, String(value)]),
    );
    subject = renderTemplate(String(template.subject_template ?? ""), vars);
    text =
      template.text_template == null
        ? undefined
        : renderTemplate(String(template.text_template), vars);
    html =
      template.html_template == null
        ? undefined
        : renderTemplate(String(template.html_template), vars);
  }
  const to = jsonValue(row.to_addresses);
  if (
    !Array.isArray(to) ||
    to.length === 0 ||
    to.some((value) => typeof value !== "string")
  )
    throw new Error("Scheduled recipients must be a nonempty string array");
  const payload: Record<string, unknown> = {
    from: row.from_address,
    to,
    subject,
    text,
    html,
    idempotency_key: `scheduled:${row.id}`,
  };
  for (const [column, key] of [
    ["cc_addresses", "cc"],
    ["bcc_addresses", "bcc"],
    ["attachments_json", "attachments"],
  ] as const) {
    const values = jsonValue(row[column]) ?? [];
    if (!Array.isArray(values))
      throw new Error(`Scheduled ${column} must be an array`);
    if (values.length) payload[key] = values;
  }
  const options = jsonValue(row.send_options) ?? {};
  if (!options || typeof options !== "object" || Array.isArray(options))
    throw new Error("Scheduled send options must be an object");
  const sendOptions = options as Record<string, unknown>;
  if (sendOptions.unsubscribe_url)
    payload.unsubscribe_url = sendOptions.unsubscribe_url;
  if (sendOptions.allow_suppressed_recipients === true)
    payload.allow_suppressed_recipients = true;
  if (row.reply_to) payload.reply_to = row.reply_to;
  if (row.provider_id) payload.provider_id = row.provider_id;
  return payload;
}

/** The callback is the normal authenticated send route, never a raw provider adapter. */
export async function runScheduledBatch(
  store: ScheduledWorkStore,
  send: (body: Record<string, unknown>) => Promise<Response>,
  limit = 10,
) {
  if (!Number.isSafeInteger(limit) || limit < 1 || limit > 100)
    throw new Error("Scheduler limit must be an integer from 1 to 100");
  const jobs = await store.claimDueScheduled(limit);
  const scheduled = {
    attempted: jobs.length,
    sent: 0,
    failed: 0,
    pending: 0,
    skipped: 0,
  };
  const items: { id: string; status: string; error?: string }[] = [];
  for (const row of jobs) {
    const id = String(row.id);
    const lease =
      row.updated_at instanceof Date
        ? row.updated_at.toISOString()
        : String(row.updated_at);
    let outcome: "sent" | "failed";
    let failure: string | null = null;
    let payload: Record<string, unknown>;
    try {
      payload = await sendPayload(row, store);
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      if (await store.finishScheduled(id, lease, "failed", message)) {
        scheduled.failed++;
        items.push({ id, status: "failed", error: message });
      } else {
        scheduled.pending++;
        items.push({ id, status: "lease_lost" });
      }
      continue;
    }
    try {
      const response = await send(payload);
      const body = (await response.json()) as Record<string, unknown>;
      const message =
        body.message && typeof body.message === "object"
          ? (body.message as Record<string, unknown>)
          : null;
      const confirmed =
        response.ok &&
        body.sent === true &&
        message?.send_state === "sent" &&
        typeof message.id === "string";
      if (
        !confirmed &&
        (response.status === 202 ||
          response.status >= 500 ||
          response.status === 429 ||
          body.in_progress === true ||
          body.sent === null ||
          body.reconciliation_required === true ||
          message?.send_state === "uncertain" ||
          message?.send_state === "sending" ||
          (response.ok && body.sent !== false))
      ) {
        scheduled.pending++;
        items.push({ id, status: "processing" });
        continue;
      }
      if (!confirmed) {
        outcome = "failed";
        failure = String(
          body.reason ??
            body.error ??
            `Send returned HTTP ${response.status} without a receipt`,
        );
      } else outcome = "sent";
    } catch (error) {
      // A transport exception may occur after the provider accepted. Keep the lease;
      // recovery replays the SAME intent key, so this must never become a fresh send.
      scheduled.pending++;
      items.push({
        id,
        status: "processing",
        error: error instanceof Error ? error.message : String(error),
      });
      continue;
    }
    if (!(await store.finishScheduled(id, lease, outcome, failure))) {
      scheduled.pending++;
      items.push({ id, status: "lease_lost" });
      continue;
    }
    scheduled[outcome]++;
    items.push({ id, status: outcome, ...(failure ? { error: failure } : {}) });
  }
  return { scheduled, items, sequence_execution: "not_requested" as const };
}
