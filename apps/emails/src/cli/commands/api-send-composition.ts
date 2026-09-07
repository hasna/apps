import { createHash, randomUUID } from "node:crypto";
import { readFileSync } from "node:fs";
import { getTemplate, renderTemplate } from "../../db/templates.js";
import { getPreferredActiveAddressEmail } from "../../db/addresses.js";
import {
  resolveMailDataSource,
  type MailDataSource,
  type MailSendInput,
} from "../../lib/mail-data-source.js";
import { resolveId } from "../utils.js";

function email(value: string, field: string): string {
  const result = value.trim();
  if (!/^[^\s<>@,;]+@[^\s<>@,;]+\.[^\s<>@,;]+$/.test(result))
    throw new Error(`Invalid ${field}: ${value}`);
  return result;
}

/** RFC-style quoted CSV, including embedded commas, quotes and line breaks. */
export function parseBatchCsv(content: string): Record<string, string>[] {
  const rows: string[][] = [];
  let row: string[] = [];
  let field = "";
  let quoted = false;
  let closed = false;
  const source = content.replace(/^\uFEFF/, "");
  const finish = () => {
    row.push(field);
    field = "";
    closed = false;
  };
  for (let i = 0; i < source.length; i++) {
    const c = source[i]!;
    if (quoted) {
      if (c === '"' && source[i + 1] === '"') {
        field += '"';
        i++;
      } else if (c === '"') {
        quoted = false;
        closed = true;
      } else field += c;
    } else if (c === '"' && field === "" && !closed) quoted = true;
    else if (c === ",") finish();
    else if (c === "\n" || c === "\r") {
      if (c === "\r" && source[i + 1] === "\n") i++;
      finish();
      if (row.some((v) => v.trim())) rows.push(row);
      row = [];
    } else {
      if (closed || c === '"')
        throw new Error("Malformed CSV: unexpected text outside quoted field");
      field += c;
    }
  }
  if (quoted) throw new Error("Malformed CSV: unterminated quoted field");
  if (field || row.length || closed) {
    finish();
    if (row.some((v) => v.trim())) rows.push(row);
  }
  const headers = rows.shift()?.map((h) => h.trim()) ?? [];
  if (
    !headers.includes("email") ||
    headers.some((h) => !h) ||
    new Set(headers).size !== headers.length
  )
    throw new Error("CSV requires unique, nonempty headers including email");
  if (rows.length > 10000)
    throw new Error("A batch may contain at most 10000 recipients");
  return rows.map((values, i) => {
    if (values.length !== headers.length)
      throw new Error(
        `CSV row ${i + 2} has ${values.length} columns; expected ${headers.length}`,
      );
    const result = Object.fromEntries(headers.map((h, j) => [h, values[j]!]));
    result.email = email(result.email!, `email on row ${i + 2}`);
    return result;
  });
}

export interface ApiBatchOptions {
  csv: string;
  template: string;
  from: string;
  provider?: string;
  force?: boolean;
  idempotencyKey?: string;
}
export async function sendApiBatch(
  opts: ApiBatchOptions,
  ds: Pick<MailDataSource, "send"> = resolveMailDataSource(),
) {
  const from = email(opts.from, "sender");
  const rows = parseBatchCsv(readFileSync(opts.csv, "utf8"));
  const template = await getTemplate(opts.template);
  if (!template) throw new Error(`Template not found: ${opts.template}`);
  const providerId = opts.provider
    ? resolveId("providers", opts.provider)
    : undefined;
  // Validate and render every row before sending anything; malformed input cannot partially send.
  const inputs: MailSendInput[] = rows.map((vars) => ({
    from,
    to: vars.email!,
    subject: renderTemplate(template.subject_template, vars),
    body: renderTemplate(template.text_template ?? "", vars),
    html: template.html_template
      ? renderTemplate(template.html_template, vars)
      : undefined,
    markdown: false,
    providerId,
    allowSuppressedRecipients: !!opts.force,
  }));
  // A content-derived default makes retrying the same file safe. A new explicit key deliberately starts a new batch.
  const batchId =
    opts.idempotencyKey ??
    createHash("sha256").update(JSON.stringify(inputs)).digest("hex");
  if (!batchId.trim() || batchId.length > 200)
    throw new Error("Batch idempotency key must be 1–200 characters");
  const result = {
    batch_id: batchId,
    total: inputs.length,
    sent: 0,
    pending: 0,
    failed: 0,
    errors: [] as { email: string; error: string; idempotency_key: string }[],
    receipts: [] as {
      email: string;
      id: string;
      message_id: string;
      idempotency_key: string;
      warning?: string;
    }[],
  };
  for (const [index, input] of inputs.entries()) {
    const key = createHash("sha256")
      .update(JSON.stringify(["emails-batch-v1", batchId, index]))
      .digest("hex");
    try {
      const sent = await ds.send({ ...input, idempotencyKey: key });
      if (sent.inProgress) result.pending++;
      else result.sent++;
      result.receipts.push({
        email: input.to,
        id: sent.id,
        message_id: sent.messageId,
        idempotency_key: key,
        ...(sent.warning ? { warning: sent.warning } : {}),
      });
    } catch (error) {
      result.failed++;
      result.errors.push({
        email: input.to,
        error: error instanceof Error ? error.message : String(error),
        idempotency_key: key,
      });
    }
  }
  return result;
}

export async function sendApiTest(
  opts: {
    from?: string;
    to?: string;
    provider?: string;
    idempotencyKey?: string;
  },
  ds: Pick<MailDataSource, "send"> = resolveMailDataSource(),
) {
  const providerId = opts.provider
    ? resolveId("providers", opts.provider)
    : undefined;
  const from = email(
    opts.from ??
      getPreferredActiveAddressEmail(
        providerId ? { provider_id: providerId } : undefined,
      ) ??
      "",
    "sender (configure an address or use --from)",
  );
  const to = email(opts.to ?? from, "recipient");
  const key = opts.idempotencyKey ?? randomUUID();
  const receipt = await ds.send({
    from,
    to,
    providerId,
    subject: "Emails delivery test",
    body: "This is a test email sent by Hasna Emails.",
    markdown: false,
    idempotencyKey: key,
  });
  return { ...receipt, from, to, idempotency_key: key };
}
