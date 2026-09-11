import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it } from "bun:test";
import { startV1Stub, type V1Stub } from "../test-support/v1-stub.js";
import { buildServer } from "./server.js";
let stub: V1Stub;
beforeAll(async () => { stub = await startV1Stub({ openapi: true }); });
afterAll(() => stub.stop());
beforeEach(async () => { await stub.reset(); stub.applyEnv(); });
afterEach(() => stub.clearEnv());
async function call(name: string, input: Record<string, unknown>) {
  const server = buildServer() as any;
  const result = await server._registeredTools[name].handler(input);
  return { ...result, payload: JSON.parse(result.content[0].text) };
}
const page = (scanned: number, next_cursor: string | null, extra = {}) => ({ ok: true, sources: [{ source_id: "source-one", scanned, ingested: scanned, duplicate: 0, error: 0, notifications: 0, acknowledged: 0, next_cursor, complete: next_cursor === null, queue: null, ...extra }] });
const provider = (id: string, extra = {}) => ({ provider_id: id, status: "synced", checked: 2, synced: 1, contacts_updated: 1, unattributed_contact_events: 0, complete: true, next_cursor: null, failures: [], historical_events_complete: false, scope: "known_provider_messages", note: "Current observations only", ...extra });
describe("MCP server-backed sync receipts", () => {
  it("walks S3 pages and preserves exact bound selectors and aggregate counts", async () => {
    await stub.seed({ "sync-results": [
      { operation: "sync-s3", receipt: page(10, "next") },
      { operation: "sync-s3", cursor: "next", receipt: page(2, null) },
    ] });
    const result = await call("sync_s3_inbox", { bucket: "bound", source_id: "source-one", prefix: "mail/", region: "eu-west-1", provider_id: "provider-one", limit: 12 });
    expect(result.isError).not.toBe(true);
    expect(result.payload.sources[0]).toMatchObject({ scanned: 12, ingested: 12, complete: true, next_cursor: null });
    const requests = await stub.list("sync-requests");
    expect(requests).toHaveLength(2);
    expect(requests[0]).toMatchObject({ bucket: "bound", source_id: "source-one", prefix: "mail/", region: "eu-west-1", provider_id: "provider-one", limit: 10 });
    expect(requests[1]).toMatchObject({ cursor: "next", limit: 2 });
  });
  it("preserves partial server failures and continuation through the contract wrapper", async () => {
    await stub.seed({ "sync-results": [{ operation: "sync-s3", receipt: { ...page(3, "retry", { ingested: 2, error: 1 }), ok: false } }] });
    const result = await call("sync_s3_inbox", { bucket: "bound" });
    expect(result.isError).toBe(true);
    expect(result.payload).toMatchObject({ ok: false, error: { retryable: false }, sources: [{ scanned: 3, ingested: 2, error: 1, next_cursor: "retry", complete: false }] });
  });
  it("retains committed counts when a later API request fails", async () => {
    await stub.seed({ "sync-results": [{ operation: "sync-s3", receipt: page(10, "retry") }, { operation: "sync-s3", cursor: "retry", status: 503, receipt: { error: "Fixture unavailable" } }] });
    const result = await call("sync_s3_inbox", { bucket: "bound", limit: 20 });
    expect(result.isError).toBe(true);
    expect(result.payload).toMatchObject({ ok: false, request_error: "Fixture unavailable", sources: [{ scanned: 10, next_cursor: "retry", complete: false }] });
  });
  it("returns a truthful bounded batch with a cursor and rejects blank selectors before work", async () => {
    await stub.seed({ "sync-results": [{ operation: "sync-s3", receipt: page(10, "next") }] });
    const result = await call("sync_s3_inbox", { bucket: "bound", limit: 10 });
    expect(result.isError).not.toBe(true);
    expect(result.payload.sources[0]).toMatchObject({ scanned: 10, complete: false, next_cursor: "next" });
    const rejected = await call("sync_s3_inbox", { bucket: "bound", provider_id: " " });
    expect(rejected.isError).toBe(true);
    expect(await stub.list("sync-requests")).toHaveLength(1);
  });
  it("selects the tenant provider by unique prefix and preserves incomplete observations", async () => {
    await stub.seed({ providers: [{ id: "provider-one", name: "One", type: "resend", active: true, created_at: "2026-01-01T00:00:00.000Z" }, { id: "provider-two", name: "Two", type: "ses", active: true, created_at: "2026-01-02T00:00:00.000Z" }], "sync-results": [
      { operation: "provider-sync", provider_id: "provider-one", receipt: provider("provider-one", { complete: false, failures: [{ message_id: "m1", error: "Read failed" }] }) },
      { operation: "provider-sync", provider_id: "provider-two", receipt: provider("provider-two") },
    ] });
    const result = await call("pull_events", { provider_id: "provider-o" });
    expect(result.isError).toBe(true);
    expect(result.payload).toMatchObject({ ok: false, providers: [{ provider_id: "provider-one", checked: 2, synced: 1, complete: false, historical_events_complete: false, failures: [{ message_id: "m1" }] }] });
    expect(await stub.list("sync-requests")).toHaveLength(1);
    expect((await stub.list("sync-requests"))[0]).toMatchObject({ provider_id: "provider-one" });
    const ambiguous = await call("pull_events", { provider_id: "provider-" });
    expect(ambiguous.isError).toBe(true);
    expect(await stub.list("sync-requests")).toHaveLength(1);
    const all = await call("pull_events", {});
    expect(all.payload.providers).toHaveLength(2);
    // Registry order is newest-first, independently of fixture insertion order.
    expect(all.payload.providers.map((receipt: { provider_id: string }) => receipt.provider_id).sort()).toEqual(["provider-one", "provider-two"]);
    expect(all.payload.providers.find((receipt: { provider_id: string }) => receipt.provider_id === "provider-one")).toEqual(provider("provider-one", { status: "partial", complete: false, failures: [{ message_id: "m1", error: "Read failed" }] }));
    expect(all.payload.providers.find((receipt: { provider_id: string }) => receipt.provider_id === "provider-two")).toEqual(provider("provider-two"));
  });
});
