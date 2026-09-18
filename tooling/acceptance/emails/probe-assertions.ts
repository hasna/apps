export function assertApiReady(response: { status: number; body: any }, version: string) {
  if (!(response.status === 200 && response.body?.status === "ready" && response.body.version === version
    && response.body.db?.ok === true && Array.isArray(response.body.pendingMigrations) && response.body.pendingMigrations.length === 0
    && Array.isArray(response.body.migrationIssues) && response.body.migrationIssues.length === 0)) throw new Error("API_READY_VERSION");
}

/** Provider attempts include rejected/uncertain calls as well as accepted sends. */
export function assertNoProviderReplay(before: { sends: unknown[]; events: { operation: string }[] }, after: typeof before) {
  const attempts = (value: typeof before) => value.events.filter(event => event.operation.endsWith(".send")).length;
  if (after.sends.length !== before.sends.length || attempts(after) !== attempts(before)) throw new Error("PROVIDER_DUPLICATE_SEND");
}

function requireValue(ok: unknown, code: string) { if (!ok) throw new Error(code); }
const from = '"Synthetic Sender" <sender@a.example.test>';
const replyTo = '"Reply Desk" <reply@a.example.test>';
const recipients = ["recipient@external.test"];

function mimeHeaders(raw: string): Map<string, string[]> {
  const boundary = raw.indexOf("\r\n\r\n");
  requireValue(boundary > 0, "PROVIDER_MIME_HEADER_BLOCK");
  const lines: string[] = [];
  for (const line of raw.slice(0, boundary).split("\r\n")) {
    if (/^[ \t]/.test(line)) {
      requireValue(lines.length > 0, "PROVIDER_MIME_FOLD");
      lines[lines.length - 1] += " " + line.trim();
    } else lines.push(line);
  }
  const headers = new Map<string, string[]>();
  for (const line of lines) {
    const match = /^([A-Za-z0-9-]+):[ \t]*(.*)$/.exec(line);
    requireValue(match, "PROVIDER_MIME_HEADER");
    const name = match![1]!.toLowerCase();
    headers.set(name, [...headers.get(name) ?? [], match![2]!.trim()]);
  }
  return headers;
}

export function assertProviderRequest(provider: string, wire: any) {
  const expectedHeaders = { "from": from, "reply-to": replyTo, "in-reply-to": "<parent@external.test>",
    "references": "<root@external.test> <parent@external.test>" };
  if (provider === "ses") {
    requireValue(wire.FromEmailAddress === from && JSON.stringify(wire.Destination?.ToAddresses) === JSON.stringify(recipients)
      && !(wire.Destination?.CcAddresses?.length) && !(wire.Destination?.BccAddresses?.length), "PROVIDER_ENVELOPE");
    const headers = mimeHeaders(Buffer.from(wire.Content?.Raw?.Data ?? "", "base64").toString("utf8"));
    for (const [name, value] of Object.entries(expectedHeaders)) requireValue(headers.get(name)?.length === 1 && headers.get(name)![0] === value, "PROVIDER_HEADER_VALUE");
  } else {
    requireValue(provider === "resend" && wire.from === from && JSON.stringify(wire.to) === JSON.stringify(recipients)
      && !(wire.cc?.length) && !(wire.bcc?.length), "PROVIDER_ENVELOPE");
    requireValue(JSON.stringify([wire.reply_to].flat()) === JSON.stringify([replyTo]), "PROVIDER_REPLY_TO");
    const headers = Object.entries(wire.headers ?? {});
    for (const [name, value] of Object.entries(expectedHeaders).filter(([name]) => !["from", "reply-to"].includes(name))) {
      const matches = headers.filter(([key]) => key.toLowerCase() === name);
      requireValue(matches.length === 1 && matches[0]![1] === value, "PROVIDER_HEADER_VALUE");
    }
  }
}

export function assertProviderAttempt(before: any, after: any, provider: string, status: number) {
  const attempts = after.attempts.slice(before.attempts.length);
  const events = after.events.slice(before.events.length).filter((event: any) => event.operation.endsWith(".send"));
  requireValue(attempts.length === 1 && events.length === 1 && attempts[0].provider === provider && attempts[0].status === status
    && events[0].operation === `${provider}.send` && events[0].id === attempts[0].id && events[0].status === status, "PROVIDER_ATTEMPT_MISSING");
  const hash = `sha256:${new Bun.CryptoHasher("sha256").update(JSON.stringify(attempts[0].body)).digest("hex")}`;
  requireValue(events[0].bodySha256 === hash && after.sends.length - before.sends.length === (status === 200 ? 1 : 0), "PROVIDER_ATTEMPT_RESULT");
  assertProviderRequest(provider, attempts[0].body);
}
