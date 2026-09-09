import { expect, test } from "bun:test";
import { join } from "node:path";
import { useDefaultTestTimeout } from "../test-preload.js";
import { RemoteSkillsClient as SourceClient } from "./remote-client.js";
import { describeRemoteFiles } from "./remote-files.js";

useDefaultTestTimeout();
const installed = process.env.SKILLS_QUOTE_TEST_PACKAGE;
const RemoteSkillsClient: typeof SourceClient = installed
  ? (await import(join(installed, process.env.SKILLS_QUOTE_TEST_ENTRY === "root" ? "dist/index.js" : "dist/sdk/index.js"))).RemoteSkillsClient
  : SourceClient;
const receipt = "opaque.receipt-A_-unchanged";
type Call = { path: string; body: any };
async function fixture(run: (client: SourceClient, calls: Call[]) => Promise<void>, options: { receipt?: unknown; absent?: boolean; status?: number; onQuote?: () => void; onCapabilities?: () => void } = {}) {
  const calls: Call[] = [];
  const server = Bun.serve({ hostname: "127.0.0.1", port: 0, async fetch(request): Promise<Response> {
    const path = new URL(request.url).pathname;
    const body = request.method === "POST" ? await request.json() : request.method === "PUT" ? new Uint8Array(await request.arrayBuffer()) : null;
    calls.push({ path, body });
    if (path === "/object") { expect(request.headers.has("authorization")).toBe(false); return new Response(null, { status: 200 }); }
    if (path.endsWith("/quote")) {
      options.onQuote?.();
      return Response.json({ skill: "quoted-skill", pricing: { costCredits: 3 }, ...(options.absent ? {} : { quoteReceipt: options.receipt === undefined ? receipt : options.receipt }) });
    }
    if (path.endsWith("/capabilities")) { options.onCapabilities?.(); return Response.json({ contractVersion: 1, apiVersion: 1, capabilities: ["runs.submit", "runs.uploads"], billing: { unit: "credits", boundedRunApproval: true } }); }
    if (options.status) return Response.json({ code: "PRIVATE_QUOTE_STALE", error: "UNTRUSTED_SERVER_CANARY" }, { status: options.status });
    if (path.endsWith("/uploads")) return Response.json({ files: [{ name: "approved.txt", uploadUrl: server.url.origin + "/object" }] });
    return Response.json({ id: "00000000-0000-4000-8000-000000000001", skill: "quoted-skill", status: "queued" });
  } });
  try { await run(new RemoteSkillsClient("owned-key", server.url.origin + "/prefix"), calls); }
  finally { await server.stop(true); }
}

test("quoted SDK submission binds receipt and a nested snapshot despite caller mutation during quote", async () => {
  const input = { nested: { approved: "original" }, list: [1, 2] }, args = ["--name", "original"];
  const approval = { maxCredits: 3, idempotencyKey: "same-attempt", inputFiles: [] as any[] };
  await fixture(async (client, calls) => {
    await client.submitQuotedRun("requested-skill", input, args, approval);
    const quoted = calls.find(c => c.path.endsWith("/quote"))!, submitted = calls.find(c => c.path.includes("/runs/"))!;
    expect(quoted.body).toEqual({ input: { nested: { approved: "original" }, list: [1, 2] }, args: ["--name", "original"] });
    expect(submitted).toEqual({ path: "/prefix/api/v1/runs/quoted-skill", body: { ...quoted.body, maxCredits: 3, maxCostCents: 3, idempotencyKey: "same-attempt", files: [], quoteReceipt: receipt } });
    expect(calls.filter(c => c.path.endsWith("/quote"))).toHaveLength(1);
  }, { onQuote() { input.nested.approved = "changed"; input.list.push(3); args.push("changed"); approval.maxCredits = 99; approval.idempotencyKey = "changed"; approval.inputFiles.push({ name: "changed" }); } });
});

test("an explicitly approved receipt is sent verbatim without replacing it with a new quote", async () => fixture(async (client, calls) => {
  await client.submitQuotedRun("quoted-skill", { nested: { value: 1 } }, ["literal"], { maxCredits: 3, quoteReceipt: receipt });
  expect(calls.map(c => c.path)).toEqual(["/prefix/api/v1/capabilities", "/prefix/api/v1/runs/quoted-skill"]);
  expect(calls.at(-1)?.body).toEqual({ input: { nested: { value: 1 } }, args: ["literal"], maxCredits: 3, maxCostCents: 3, quoteReceipt: receipt });
}));

test("low-level submitRun explicitly passes the receipt and rejects malformed values before HTTP", async () => fixture(async (client, calls) => {
  await client.submitRun("quoted-skill", { value: true }, ["literal"], { maxCredits: 3, quoteReceipt: receipt });
  expect(calls).toHaveLength(1); expect(calls[0]?.body.quoteReceipt).toBe(receipt);
  for (const value of [null, false, 3, {}, [], "", "x".repeat(4097)]) {
    await expect(client.submitRun("quoted-skill", {}, [], { quoteReceipt: value as any })).rejects.toThrow("quote receipt");
    await expect(client.submitQuotedRun("quoted-skill", {}, [], { quoteReceipt: value as any })).rejects.toThrow("quote receipt");
  }
  expect(calls).toHaveLength(1);
}));

test("malformed quoted receipts cannot be dropped into an unbound submission", async () => {
  for (const value of [null, false, 3, {}, [], "", "x".repeat(4097)]) await fixture(async (client, calls) => {
    await expect(client.submitQuotedRun("quoted-skill", {}, [], { maxCredits: 3 })).rejects.toThrow("quote receipt");
    expect(calls.map(c => c.path)).toEqual(["/prefix/api/v1/skills/quoted-skill/quote"]);
  }, { receipt: value });
});

test("public servers without receipts retain the quoted bounded approval contract", async () => fixture(async (client, calls) => {
  await client.submitQuotedRun("quoted-skill", { a: 1 }, ["two"], { maxCredits: 3 });
  expect(calls.at(-1)?.body).toEqual({ input: { a: 1 }, args: ["two"], maxCredits: 3, maxCostCents: 3 });
}, { absent: true }));

test("stale and expired approval HTTP refusals stop without a new quote, retry, or server-body echo", async () => {
  for (const status of [409, 410]) await fixture(async (client, calls) => {
    let error: any;
    try { await client.submitQuotedRun("quoted-skill", { approved: true }, [], { maxCredits: 3, quoteReceipt: receipt }); } catch (caught) { error = caught; }
    expect(error?.name).toBe("RemoteRequestError"); expect(error?.status).toBe(status);
    expect(error?.message).toContain(`HTTP ${status}`); expect(error?.message).not.toContain("UNTRUSTED_SERVER_CANARY");
    expect(calls.map(c => c.path)).toEqual(["/prefix/api/v1/capabilities", "/prefix/api/v1/runs/quoted-skill"]);
  }, { status });
});

test("file quote, admission and signed upload retain owned bytes and descriptors before asynchronous lookup", async () => {
  const original = new TextEncoder().encode("approved file bytes"), files = [{ name: "approved.txt", contentType: "text/plain", bytes: original.slice() }];
  const expected = describeRemoteFiles(files), input = { nested: { approved: true } }, args = ["--approved"], approval = { maxCredits: 3, idempotencyKey: "file-approval" };
  await fixture(async (client, calls) => {
    await client.submitQuotedRunWithFiles("quoted-skill", input, args, files, approval);
    const quote = calls.find(c => c.path.endsWith("/quote"))!;
    expect(quote.body).toEqual({ input: { nested: { approved: true } }, args: ["--approved"], files: expected });
    expect(calls.find(c => c.path.endsWith("/runs/quoted-skill"))?.body).toEqual({ ...quote.body, quoteReceipt: receipt, maxCredits: 3, maxCostCents: 3, idempotencyKey: "file-approval" });
    expect(calls.find(c => c.path.endsWith("/uploads"))?.body).toEqual({ files: expected });
    expect(calls.find(c => c.path === "/object")?.body).toEqual(original);
  }, { onCapabilities() { input.nested.approved = false; args.push("changed"); approval.maxCredits = 99; files[0]!.bytes.fill(0); files[0]!.name = "changed.txt"; files[0]!.contentType = "application/changed"; } });
});

test("explicit file approval refused by the server cannot upload bytes or obtain a replacement quote", async () => fixture(async (client, calls) => {
  await expect(client.submitQuotedRunWithFiles("quoted-skill", {}, [], [{ name: "approved.txt", bytes: new Uint8Array([1]) }], { maxCredits: 3, quoteReceipt: receipt })).rejects.toThrow("HTTP 409");
  expect(calls.map(c => c.path)).toEqual(["/prefix/api/v1/capabilities", "/prefix/api/v1/runs/quoted-skill"]);
  expect(calls.at(-1)?.body.quoteReceipt).toBe(receipt);
}, { status: 409 }));

test("receipt limits count UTF-8 bytes and never normalize accepted opaque values", async () => fixture(async (client, calls) => {
  for (const value of [" padded opaque value ", "é".repeat(2048)]) {
    await client.submitRun("quoted-skill", {}, [], { quoteReceipt: value });
    expect(calls.at(-1)?.body.quoteReceipt).toBe(value);
  }
  await expect(client.submitRun("quoted-skill", {}, [], { quoteReceipt: "é".repeat(2049) })).rejects.toThrow("quote receipt");
  expect(calls).toHaveLength(2);
}));
