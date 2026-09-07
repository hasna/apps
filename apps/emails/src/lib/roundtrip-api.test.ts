import { expect, test } from "bun:test";
import { planRoundtrip, runRoundtrip, type RoundtripDeps } from "./roundtrip-api.js";
import type { MailSendInput } from "./mail-data-source.js";

const options = { domain: "example.com", provider: "provider-1", addresses: "one,two", count: 1, pollAttempts: 2, pollInterval: 0, throttle: 0, idempotencyKey: "fixture-roundtrip" };
function fixture() {
  const sends: MailSendInput[] = [];
  const reads: string[] = [];
  const deps: RoundtripDeps = { mail: {
    send: async input => { sends.push(input); return { id: `out-${sends.length}`, messageId: `provider-${sends.length}` }; },
    verificationCandidates: async (address, query) => {
      reads.push(address);
      return sends.filter(input => input.to === address && input.subject === query?.subject).map((input, index) => ({ id: `in-${index}-${address}`, from_address: input.from!, subject: input.subject, text_body: input.body, html_body: null, received_at: "2026-09-07T00:00:00Z" }));
    },
  } };
  return { sends, reads, deps };
}
test("verifies exact tokens in both directions using only the supplied API seam", async () => {
  const f = fixture();
  const result = await runRoundtrip(options, f.deps);
  expect(result.complete).toBe(true);
  expect(result.received).toBe(2);
  expect(result.confirmed_sent).toBe(2);
  expect(f.sends.map(item => [item.from, item.to])).toEqual([["one@example.com", "two@example.com"], ["two@example.com", "one@example.com"]]);
  expect(f.reads).toEqual(["two@example.com", "two@example.com", "one@example.com"]);
  expect(f.sends.every(item => item.providerId === "provider-1" && item.markdown === false)).toBe(true);
});
test("retries preserve send keys and content; a changed run gets different keys", async () => {
  const first = fixture(), second = fixture();
  await runRoundtrip(options, first.deps);
  await runRoundtrip(options, second.deps);
  expect(second.sends).toEqual(first.sends);
  expect(planRoundtrip({ ...options, idempotencyKey: "another-run" }).items[0]!.send_key).not.toBe(planRoundtrip(options).items[0]!.send_key);
});
test("an uncertain send stops subsequent sends and retains a reusable run identity", async () => {
  const f = fixture();
  f.deps.mail.send = async input => { f.sends.push(input); return { id: "intent", messageId: "", inProgress: true }; };
  const result = await runRoundtrip(options, f.deps);
  expect(result.complete).toBe(false);
  expect(result.confirmed_sent).toBe(0);
  expect(result.items.map(item => item.state)).toEqual(["uncertain", "not_attempted"]);
  expect(result.run_id).toBe(options.idempotencyKey);
  expect(f.sends).toHaveLength(1);
});
test("wrong sender, subject, or body does not establish receipt", async () => {
  for (const field of ["from_address", "subject", "text_body"] as const) {
    const f = fixture(), read = f.deps.mail.verificationCandidates;
    f.deps.mail.verificationCandidates = async (address, query) => (await read(address, query)).map(item => ({ ...item, [field]: "unrelated" }));
    const result = await runRoundtrip(options, f.deps);
    expect(result.complete).toBe(false);
    expect(result.received).toBe(0);
    expect(result.confirmed_sent).toBe(2);
  }
});
test("read or source preflight failure sends nothing", async () => {
  for (const kind of ["read", "sync"]) {
    const f = fixture();
    if (kind === "read") f.deps.mail.verificationCandidates = async () => { throw new Error("unavailable"); };
    else f.deps.sync = async () => { throw new Error("unavailable"); };
    const result = await runRoundtrip(options, f.deps);
    expect(result.complete).toBe(false);
    expect(result.errors).toHaveLength(1);
    expect(f.sends).toHaveLength(0);
  }
});
test("S3 continuation survives between polls and is returned for an interrupted run", async () => {
  const f = fixture(), inputs: Record<string, unknown>[] = [];
  f.deps.mail.verificationCandidates = async () => [];
  f.deps.sync = async input => {
    inputs.push(input);
    return { ok: true, sources: [{ source_id: "source-1", scanned: 10, ingested: 0, duplicate: 10, error: 0, notifications: 0, acknowledged: 0, next_cursor: `cursor-${inputs.length}`, complete: false, queue: null }] };
  };
  const result = await runRoundtrip({ ...options, source: "source-1", syncCursor: "previous" }, f.deps);
  expect(inputs.map(item => item.cursor)).toEqual(["previous", "cursor-1", "cursor-2"]);
  expect(inputs.every(item => item.source_id === "source-1" && item.provider_id === "provider-1")).toBe(true);
  expect(result.sync_cursor).toBe("cursor-3");
  expect(result.complete).toBe(false);
});
test("invalid or oversized runs fail before any I/O", async () => {
  for (const change of [{ count: "1x" }, { count: 0 }, { count: 999 }, { addresses: "one,one" }, { addresses: "one" }, { addresses: "one,two@elsewhere.com" }, { domain: "bad/domain" }, { pollAttempts: -1 }, { throttle: -1 }, { source: "" }, { bucket: "" }, { syncCursor: "" }, { syncCursor: "orphan" }, { profile: "local-aws" }]) {
    const f = fixture();
    await expect(runRoundtrip({ ...options, ...change }, f.deps)).rejects.toThrow();
    expect(f.sends).toHaveLength(0);
    expect(f.reads).toHaveLength(0);
  }
});
test("cancellation is reported without additional sends", async () => {
  const f = fixture(), controller = new AbortController();
  controller.abort();
  const result = await runRoundtrip(options, { ...f.deps, signal: controller.signal });
  expect(result.complete).toBe(false);
  expect(result.errors[0]).toContain("interrupted");
  expect(f.sends).toHaveLength(0);
});
