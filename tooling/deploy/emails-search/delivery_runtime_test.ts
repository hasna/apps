/**
 * Run with: bun delivery_runtime_test.ts --source-root DIR --mode baseline|patched
 * DIR contains app/src/... from the authenticated image/overlay and the unchanged
 * reply-headers.ts helper. Full source hashes are checked before any evaluation.
 * No image, SDK, credentials, database or network access is used. The exact send
 * route, its local helpers, SES send method and MIME helpers execute in a temp
 * module. Authentication, storage, attachment limits, provider error classification
 * and SDK transport are fixture boundaries; this is not whole-image integration.
 * Baseline mode proves the existing defects; patched mode proves their fixes.
 */
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { pathToFileURL } from "node:url";

const args = process.argv.slice(2);
assert.equal(args.length, 4, "Expected --source-root DIR --mode baseline|patched");
assert.equal(args[0], "--source-root");
assert.equal(args[2], "--mode");
const root = resolve(args[1]!);
const mode = args[3]!;
assert.ok(mode === "baseline" || mode === "patched", "Unknown test mode");
const patched = mode === "patched";
const recipe = JSON.parse(readFileSync(new URL("./delivery-recipe.json", import.meta.url), "utf8"));
assert.equal(recipe.schema, "emails.delivery-overlay-recipe.v1");
assert.equal(recipe.purpose, "delivery-headers");
const sha = (bytes: Uint8Array | string) => createHash("sha256").update(bytes).digest("hex");
assert.equal(sha(readFileSync(new URL("./delivery-headers.patch", import.meta.url))), recipe.patchSha256);
const source: Record<string, string> = {};
for (const row of recipe.files) {
  const bytes = readFileSync(join(root, row.path));
  assert.equal(bytes.length, patched ? row.afterBytes : row.beforeBytes, row.path);
  assert.equal(sha(bytes), patched ? row.afterSha256 : row.beforeSha256, row.path);
  source[row.path] = bytes.toString("utf8");
}
const replyPath = "app/src/lib/reply-headers.ts";
const replyBytes = readFileSync(join(root, replyPath));
assert.equal(sha(replyBytes), "96c4abb0079d659ac8d49926986b63b15e7bd602a62fad5c9e3018aac0e44a24");
source[replyPath] = replyBytes.toString("utf8");

// Exact unique boundaries, not a parser that can silently select another method.
function between(text: string, start: string, end: string): string {
  const first = text.indexOf(start);
  assert.ok(first >= 0 && first === text.lastIndexOf(start), `Nonunique start: ${start}`);
  const last = text.indexOf(end, first + start.length);
  assert.ok(last > first, `Missing end: ${end}`);
  return text.slice(first, last);
}
function localFunction(text: string, name: string): string {
  const start = new RegExp(`^(?:async )?function ${name}\\(`, "m").exec(text);
  assert.ok(start, `Missing local helper: ${name}`);
  const end = text.indexOf("\n}", start.index);
  assert.ok(end > start.index);
  return text.slice(start.index, end + 2);
}

const service = source["app/src/server/self-hosted/service.ts"]!;
const ses = source["app/src/providers/ses.ts"]!;
const route = between(service, '    if (path === "/v1/messages/send") {', '\n    // /v1/messages — inbound import');
const helperNames = ["json", "publicMessage", "missingProviderProofResponse", "sendIntentMessage",
  "sendPayloadHash", "decodeStrictBase64", "safeHeaderValue", "isSafeFromDisplayName", "parseIdempotencyKey",
  "sendLeaseExpired", "readJsonBody", "asStringArray", "asArray"];
const helpers = helperNames.map(name => localFunction(service, name)).join("\n\n");
const mimeType = service.match(/^const MIME_TYPE_RE = .+;$/m);
assert.ok(mimeType);
const sesMethod = between(ses, "  async sendEmail(", "\n  async ");
const sesMime = ses.slice(ses.indexOf("const MIME_TOKEN_RE ="));
assert.ok(sesMime.startsWith("const MIME_TOKEN_RE ="));
// This helper's sole runtime import is rewritten to the exact pinned temporary file.
assert.equal((source[replyPath]!.match(/^import /gm) ?? []).length, 1);
const reply = source[replyPath]!.replace('"./email-address.js"', '"./email-address.ts"');
assert.notEqual(reply, source[replyPath]);
const addressImport = patched
  ? "canonicalSender, formatSenderDisplayName, senderDisplayName"
  : "canonicalSender, formatSenderDisplayName";
const moduleSource = `
import { createHash } from "node:crypto";
import { ${addressImport} } from "./email-address.ts";
import { deriveReplyHeaders, ReplyHeaderError, replyMailboxes } from "./reply-headers.ts";
// Explicit fixture boundaries: no real auth, database, SDK, environment or logs.
const console = { error() {} };
const process = { env: {} };
const MAX_JSON_BODY_BYTES = 1024 * 1024;
const MAX_SEND_JSON_BODY_BYTES = 1024 * 1024;
const SELF_HOSTED_SEND_ATTACHMENT_LIMITS = { maxFiles: 10, maxBytesPerFile: 1024, maxTotalBytes: 2048 };
const humanLimitBytes = (n: number) => String(n);
const hasAllScopes = () => false;
const authenticate = async (deps: any) => deps.auth;
const classifyProviderSendError = (error: any) => ({ kind: error.fixtureKind ?? "uncertain", providerErrorName: "FixtureError", detail: "synthetic" });
const providerSendLogFields = () => ({});
class RequestBodyTooLargeError extends Error {}
export class IdempotencyKeyConflictError extends Error {}
class SendIntentTombstonedError extends Error {}
${mimeType[0]}
${helpers}
export async function sendRoute(deps: any, req: Request) {
  const path = "/v1/messages/send", method = req.method, url = new URL(req.url), write = true;
${route}
}
class SendEmailCommand { constructor(public input: any) {} }
export class SESFixture {
  constructor(public client: any, public configurationSetName: string = "fixture-config") {}
${sesMethod}
}
${sesMime}
`;

const temporary = mkdtempSync(join(tmpdir(), "emails-delivery-runtime-"));
const testNames: string[] = [];
async function check(name: string, action: () => unknown | Promise<unknown>) {
  await action();
  testNames.push(name);
}
const originalFetch = globalThis.fetch;
globalThis.fetch = (() => { throw new Error("NETWORK_FORBIDDEN_IN_DELIVERY_TEST"); }) as typeof fetch;
try {
  writeFileSync(join(temporary, "email-address.ts"), source["app/src/lib/email-address.ts"]!);
  writeFileSync(join(temporary, "reply-headers.ts"), reply);
  writeFileSync(join(temporary, "runtime.ts"), moduleSource);
  const runtime = await import(pathToFileURL(join(temporary, "runtime.ts")).href);

  type HarnessOptions = { name?: string | null; parent?: any; blocked?: boolean; authDenied?: boolean;
    provider?: "ses" | "resend"; sendError?: "rejected" | "uncertain"; finalizationFails?: boolean };
  function harness(options: HarnessOptions = {}) {
    const calls: string[] = [], reservations: any[] = [], policies: any[] = [], sends: any[] = [];
    const providerIds: string[] = [];
    let record: any = null;
    const store = {
      async getAddressByEmail(from: string) { calls.push("address"); assert.equal(from, "sender@example.com"); return options.name === undefined ? null : { display_name: options.name }; },
      async getMessage(id: string) { calls.push("parent"); return id === "parent" ? options.parent ?? null : record; },
      async reserveSendIntent(input: any) {
        calls.push("reserve"); reservations.push(structuredClone(input));
        if (record) {
          if (record.send_payload_hash !== input.send_payload_hash) throw new runtime.IdempotencyKeyConflictError("fixture conflict");
          return { record, created: false };
        }
        record = { ...input, id: "intent", send_state: "pending", provider_message_id: null, headers: input.headers ?? {} };
        return { record, created: true };
      },
      async evaluateOutboundPolicy(input: any) { calls.push("policy"); policies.push(input); return options.blocked ? { allowed: false, status: 403, code: "fixture_denied" } : { allowed: true }; },
      async claimSendIntent() { calls.push("claim"); record = { ...record, send_state: "sending" }; return record; },
      async completeSendIntent(_id: string, providerId: string) { calls.push("complete"); if (options.finalizationFails) throw new Error("fixture failure"); record = { ...record, send_state: "sent", provider_message_id: providerId }; return record; },
      async markSendBlocked() { calls.push("blocked"); record = { ...record, send_state: "blocked" }; return record; },
      async markSendFailed() { calls.push("failed"); record = { ...record, send_state: "failed" }; return record; },
      async markSendUncertain(_id: string, providerId?: string) { calls.push("uncertain"); record = { ...record, send_state: "uncertain", provider_message_id: providerId ?? record.provider_message_id }; return record; },
    };
    const deps = { auth: options.authDenied ? { ok: false, response: new Response("denied", { status: 401 }) } :
      { ok: true, store, ctx: { principalType: "apikey" } },
      sender: { provider: options.provider ?? "ses", async send(input: any) {
        calls.push("send"); sends.push(structuredClone(input));
        if (options.sendError) throw Object.assign(new Error("fixture provider error"), { fixtureKind: options.sendError });
        const id = `fixture-provider-${providerIds.length + 1}`; providerIds.push(id); return id;
      } } };
    async function send(overrides: any = {}) {
      return runtime.sendRoute(deps, new Request("https://fixture.invalid/v1/messages/send", {
        method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({
          from: "sender@example.com", to: ["recipient@example.net"], subject: "Delivery fixture",
          text: "Synthetic body\r\nFrom: this is body text, not a header", idempotency_key: "fixture-intent", ...overrides,
        }),
      }));
    }
    return { send, calls, reservations, policies, sends, providerIds };
  }
  const parent = { id: "parent", direction: "inbound", from_addr: "recipient@example.net", to_addrs: ["sender@example.com"],
    cc_addrs: [], subject: "Delivery fixture", message_id: "<received@example.net>", in_reply_to: null,
    headers: { References: "<earlier@example.net>" } };
  const attachment = { filename: "fixture.txt", content: Buffer.from("synthetic attachment").toString("base64"), content_type: "text/plain" };
  const replyList = '"Support, Team" <SUPPORT@example.org>, other@example.org, support@example.org';

  await check("inline name regression, exact old versus patched route", async () => {
    const h = harness(); assert.equal((await h.send({ from: '"Caller Name" <SENDER@example.com>' })).status, 202);
    assert.equal(h.sends[0].from, patched ? '"Caller Name" <sender@example.com>' : "sender@example.com");
    assert.equal(h.reservations[0].from_addr, "sender@example.com"); assert.equal(h.policies[0].from, "sender@example.com");
    assert.deepEqual(h.calls, ["reserve", "policy", "claim", "address", "send", "complete"]);
  });
  await check("configured name precedence and RFC quoted-string escaping", async () => {
    const h = harness({ name: 'Operations (Lead), "A" \\ Team' });
    assert.equal((await h.send({ from: "Caller <sender@example.com>" })).status, 202);
    assert.equal(h.sends[0].from, '"Operations (Lead), \\"A\\" \\\\ Team" <sender@example.com>');
  });
  await check("quoted escaped and Unicode inline names", async () => {
    for (const [raw, expected] of [
      ['"Team, \\"One\\"" <sender@example.com>', '"Team, \\"One\\"" <sender@example.com>'],
      ["Équipe 東京 <sender@example.com>", '"Équipe 東京" <sender@example.com>'],
    ]) {
      const h = harness({ name: null }); assert.equal((await h.send({ from: raw })).status, 202);
      assert.equal(h.sends[0].from, patched ? expected : "sender@example.com");
    }
  });
  await check("unsafe configured and inline names never become transport headers", async () => {
    for (const name of ["Bad\r\nBcc: extra@example.net", "Bad\0Name", "Bad\uD800"]) {
      const h = harness({ name }); assert.equal((await h.send({ from: "Safe <sender@example.com>" })).status, 202);
      assert.equal(h.sends[0].from, patched ? '"Safe" <sender@example.com>' : "sender@example.com");
    }
    for (const raw of ["Bad\0Name <sender@example.com>", "Bad\uD800 <sender@example.com>", '"Bad\r\nBcc: extra@example.net" <sender@example.com>']) {
      const h = harness(); const response = await h.send({ from: raw });
      assert.ok(response.status === 202 || response.status === 400);
      if (response.status === 202) assert.equal(h.sends[0].from, "sender@example.com");
      else assert.equal(h.sends.length, 0);
    }
  });
  await check("ambiguous sender refuses before ledger and provider", async () => {
    const h = harness(); assert.equal((await h.send({ from: "X <sender@example.com> <other@example.org>" })).status, 400); assert.deepEqual(h.calls, []);
  });
  await check("display names preserve send hash and replay calls provider once", async () => {
    const h = harness({ name: "Configured" });
    assert.equal((await h.send({ from: "First <sender@example.com>" })).status, 202);
    const replay = await h.send({ from: "Second <sender@example.com>" }); assert.equal(replay.status, 200);
    assert.equal((await replay.json()).idempotent_replay, true);
    assert.equal(h.reservations[0].send_payload_hash, h.reservations[1].send_payload_hash);
    assert.equal(h.sends.length, 1); assert.deepEqual(h.providerIds, ["fixture-provider-1"]);
  });
  await check("valid Reply-To preserves the original payload hash and conflict behavior", async () => {
    const h = harness(); assert.equal((await h.send({ reply_to: replyList })).status, 202);
    const expectedPayload = { from: "sender@example.com", to: ["recipient@example.net"], cc: [], bcc: [], reply_to: replyList,
      subject: "Delivery fixture", text: "Synthetic body\r\nFrom: this is body text, not a header", html: null, attachments: [], provider: "ses" };
    assert.equal(h.reservations[0].send_payload_hash, sha(JSON.stringify(expectedPayload)));
    assert.equal(h.sends[0].reply_to, replyList);
    assert.equal((await h.send({ reply_to: replyList })).status, 200);
    assert.equal((await h.send({ reply_to: "changed@example.org" })).status, 409);
    assert.equal(h.sends.length, 1); assert.deepEqual(h.providerIds, ["fixture-provider-1"]);
  });
  await check("explicit malformed Reply-To refuses before intent in patched mode", async () => {
    for (const reply_to of ["", null, 1, "not-a-mailbox", "a@example.org,", '"unterminated <a@example.org>']) {
      const h = harness(); const response = await h.send({ reply_to });
      assert.equal(response.status, patched ? 400 : 202);
      if (patched) { assert.equal((await response.json()).reason, "invalid_reply_to"); assert.deepEqual(h.calls, []); }
      else assert.equal(h.sends.length, 1); // Demonstrate the old route defect.
    }
    const h = harness(); assert.equal((await h.send({ reply_to: "a@example.org\r\nBcc: x@example.org" })).status, 400); assert.deepEqual(h.calls, []);
  });
  await check("authorized received parent derives exactly one thread header pair", async () => {
    const h = harness({ parent }); assert.equal((await h.send({ reply_to_message_id: "parent", subject: "Re: Delivery fixture" })).status, 202);
    const headers = { "In-Reply-To": "<received@example.net>", References: "<earlier@example.net> <received@example.net>" };
    assert.deepEqual(h.sends[0].headers, headers); assert.deepEqual(h.reservations[0].headers, headers);
    assert.equal(h.reservations[0].in_reply_to, "<received@example.net>");
    assert.equal((await h.send({ reply_to_message_id: "parent", subject: "Re: Delivery fixture" })).status, 200);
    assert.equal(h.sends.length, 1);
  });
  await check("unknown, mismatched, conflicting, or forged parent refuses before intent", async () => {
    const variants: Array<[any, any, number]> = [
      [null, {}, 404], [{ ...parent, to_addrs: ["other@example.com"] }, {}, 403], [parent, { subject: "Different" }, 400],
      [{ ...parent, message_id: null, headers: {} }, {}, 409],
      [{ ...parent, headers: { "Message-ID": "<conflict@example.net>" } }, {}, 409],
      [{ ...parent, headers: { References: "opaque-provider-id" } }, {}, 409],
      [parent, { headers: { "In-Reply-To": "<forged@example.net>" } }, 400],
    ];
    for (const [candidate, extra, status] of variants) {
      const h = harness({ parent: candidate }); assert.equal((await h.send({ reply_to_message_id: "parent", ...extra })).status, status);
      assert.equal(h.reservations.length, 0); assert.equal(h.sends.length, 0);
    }
  });
  await check("authentication and policy remain before provider invocation", async () => {
    const unauthorized = harness({ authDenied: true }); assert.equal((await unauthorized.send()).status, 401); assert.deepEqual(unauthorized.calls, []);
    const blocked = harness({ blocked: true }); assert.equal((await blocked.send()).status, 403); assert.equal(blocked.sends.length, 0); assert.ok(!blocked.calls.includes("claim"));
  });
  await check("uncertain outcome and finalization failure cannot trigger a replay send", async () => {
    for (const options of [{ sendError: "uncertain" as const }, { finalizationFails: true }]) {
      const h = harness(options); const response = await h.send();
      assert.equal(response.status, options.finalizationFails ? 202 : 502);
      const body = await response.json(); assert.equal(body.sent, options.finalizationFails ? true : null); assert.equal(body.retry_safe, false);
      assert.equal((await h.send()).status, 409); assert.equal(h.sends.length, 1);
      assert.equal(h.providerIds.length, options.finalizationFails ? 1 : 0);
    }
  });
  await check("definitive provider rejection retains known not-sent behavior", async () => {
    const h = harness({ sendError: "rejected" }); const response = await h.send(); assert.equal(response.status, 422);
    const body = await response.json(); assert.equal(body.sent, false); assert.equal(body.retry_safe, true); assert.equal(h.sends.length, 1); assert.equal(h.providerIds.length, 0);
  });

  function sesHarness() {
    const commands: any[] = [];
    const adapter = new runtime.SESFixture({ async send(command: any) { commands.push(command.input); return { MessageId: `fixture-ses-${commands.length}` }; } });
    return { commands, adapter };
  }
  function parseHeaders(raw: Uint8Array): Map<string, string[]> {
    const mime = Buffer.from(raw).toString("utf8"); const boundary = mime.indexOf("\r\n\r\n");
    assert.ok(boundary > 0, "Missing MIME header/body boundary");
    const block = mime.slice(0, boundary); assert.ok(!/[\r\n]/.test(block.replaceAll("\r\n", "")), "Malformed header line endings");
    const result = new Map<string, string[]>();
    for (const line of block.replace(/\r\n[ \t]+/g, " ").split("\r\n")) {
      const colon = line.indexOf(":"); assert.ok(colon > 0, "Malformed header");
      const key = line.slice(0, colon).toLowerCase(), value = line.slice(colon + 1).trim();
      result.set(key, [...result.get(key) ?? [], value]);
    }
    return result;
  }
  const opts = { from: '"Configured Name" <sender@example.com>', to: ["recipient@example.net"], cc: ["cc@example.net"], bcc: ["bcc@example.net"],
    subject: "Delivery fixture", text: "From: body text must not affect header assertions", reply_to: replyList };
  await check("SES Simple sends parsed canonical ReplyToAddresses, exact destination, once", async () => {
    const h = sesHarness(); assert.equal(await h.adapter.sendEmail(opts), "fixture-ses-1"); assert.equal(h.commands.length, 1);
    assert.deepEqual(h.commands[0].ReplyToAddresses, patched ? ["support@example.org", "other@example.org"] : [replyList]);
    assert.equal(h.commands[0].FromEmailAddress, opts.from);
    assert.deepEqual(h.commands[0].Destination, { ToAddresses: opts.to, CcAddresses: opts.cc, BccAddresses: opts.bcc });
    assert.equal(h.commands[0].Content.Simple.Subject.Data, opts.subject); assert.equal(h.commands[0].Content.Raw, undefined);
    assert.equal(h.commands[0].ConfigurationSetName, "fixture-config");
  });
  await check("SES Raw MIME carries one From, Reply-To, In-Reply-To and References header", async () => {
    for (const attachments of [undefined, [attachment]]) {
      const h = sesHarness(); await h.adapter.sendEmail({ ...opts, attachments, headers: { "In-Reply-To": "<received@example.net>", References: "<earlier@example.net> <received@example.net>" } });
      assert.equal(h.commands.length, 1); const command = h.commands[0], headers = parseHeaders(command.Content.Raw.Data);
      assert.deepEqual(headers.get("from"), [opts.from]); assert.deepEqual(headers.get("reply-to"), [replyList]);
      assert.deepEqual(headers.get("in-reply-to"), ["<received@example.net>"]); assert.deepEqual(headers.get("references"), ["<earlier@example.net> <received@example.net>"]);
      assert.equal(headers.has("bcc"), false); assert.deepEqual(command.Destination.BccAddresses, opts.bcc);
      assert.equal(command.ReplyToAddresses, undefined); assert.equal(command.Content.Simple, undefined);
      assert.ok(headers.get("content-type")![0]!.startsWith(attachments ? "multipart/mixed;" : "text/plain;"));
    }
  });
  await check("SES malformed Reply-To and injection refuse without transport activity", async () => {
    for (const reply_to of ["not-a-mailbox", "", null, "a@example.org,", '"unterminated <a@example.org>']) {
      for (const attachments of [undefined, [attachment]]) {
        const h = sesHarness();
        if (patched) { await assert.rejects(() => h.adapter.sendEmail({ ...opts, reply_to, attachments })); assert.equal(h.commands.length, 0); }
        else { await h.adapter.sendEmail({ ...opts, reply_to, attachments }); assert.equal(h.commands.length, 1); }
      }
    }
    for (const overrides of [{ reply_to: "a@example.org\r\nBcc: x@example.org" }, { from: "X\r\nBcc: x@example.org" },
      { headers: { "Reply-To": "x@example.org" } }, { headers: { "In-Reply-To": "<good@example.org>\r\nFrom: forged" } }]) {
      const h = sesHarness(); await assert.rejects(() => h.adapter.sendEmail({ ...opts, ...overrides })); assert.equal(h.commands.length, 0);
    }
  });
  await check("same actual service options feed SES MIME and preserve Resend dispatch", async () => {
    for (const provider of ["ses", "resend"] as const) {
      const h = harness({ name: "Configured Name", parent, provider });
      assert.equal((await h.send({ reply_to: replyList, reply_to_message_id: "parent", attachments: [attachment] })).status, 202);
      assert.equal(h.sends.length, 1); assert.equal(h.sends[0].provider_id, `self-hosted-${provider}`);
      assert.equal(h.sends[0].reply_to, replyList); assert.deepEqual(h.sends[0].attachments, [attachment]);
      const ses = sesHarness(); await ses.adapter.sendEmail(h.sends[0]);
      const headers = parseHeaders(ses.commands[0].Content.Raw.Data);
      assert.deepEqual(headers.get("from"), ['"Configured Name" <sender@example.com>']); assert.deepEqual(headers.get("in-reply-to"), ["<received@example.net>"]);
    }
  });
  process.stdout.write(JSON.stringify({ schema: "emails.delivery-runtime-tests.v1", mode, passed: testNames.length, tests: testNames,
    sourceSha256: Object.fromEntries(Object.entries(source).map(([path, text]) => [path, sha(text)])),
    scope: "Pinned route and SES send/MIME closure with explicit fixture boundaries; no whole-image, real SDK, database or receiver proof" }) + "\n");
} finally {
  globalThis.fetch = originalFetch;
  rmSync(temporary, { recursive: true, force: true });
}
