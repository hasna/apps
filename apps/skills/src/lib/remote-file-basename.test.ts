import { expect, test } from "bun:test";
import { createHash } from "node:crypto";
import { join } from "node:path";
import { RemoteSkillsClient as SourceClient } from "./remote-client.js";
import { useDefaultTestTimeout } from "../test-preload.js";
useDefaultTestTimeout();
const installed = process.env.SKILLS_QUOTE_TEST_PACKAGE;
const RemoteSkillsClient: typeof SourceClient = installed ? (await import(join(installed, "dist/sdk/index.js"))).RemoteSkillsClient : SourceClient;
const bytes = new Uint8Array([0, 255, 42]), receipt = "owned-exact-file-approval";

async function fixture(action: (client: SourceClient, calls: Array<{ path: string; body: any }>) => Promise<void>) {
  const calls: Array<{ path: string; body: any }> = [];
  const server = Bun.serve({ hostname: "127.0.0.1", port: 0, async fetch(request) {
    const path = new URL(request.url).pathname;
    const body = request.method === "POST" ? await request.json() : request.method === "PUT" ? new Uint8Array(await request.arrayBuffer()) : null;
    calls.push({ path, body });
    if (path.endsWith("/capabilities")) return Response.json({ contractVersion: 1, apiVersion: 1, capabilities: ["runs.submit", "runs.uploads"], billing: { unit: "credits", boundedRunApproval: true } });
    if (path.endsWith("/quote")) return Response.json({ skill: "owned-file", pricing: { costCredits: 3 }, quoteReceipt: receipt });
    if (path.endsWith("/uploads")) return Response.json({ files: body.files.map((file: { name: string }) => ({ name: file.name, uploadUrl: `${server.url.origin}/object` })) });
    if (path === "/object") {
      expect(request.headers.has("authorization")).toBe(false);
      expect(request.headers.get("content-type")).toBe("application/octet-stream");
      return new Response(null);
    }
    return Response.json({ id: "00000000-0000-4000-8000-000000000001", status: "queued", skill: "owned-file" });
  } });
  try { await action(new RemoteSkillsClient("owned-key", server.url.origin), calls); }
  finally { await server.stop(true); }
}

for (const name of ["café !'()*.txt", ".hidden file", "-leading+%?#&😀.txt", "a".repeat(255), "é".repeat(128)]) {
  test(`exact basename survives quote admission and upload: ${name.slice(0, 30)}`, async () => {
    await fixture(async (client, calls) => {
      const result = await client.submitQuotedRunWithFiles("owned-file", { approved: true }, ["--owned"], [{ name, bytes }], { maxCredits: 3 });
      expect(result.id).toBe("00000000-0000-4000-8000-000000000001");
      const descriptor = { name, sizeBytes: bytes.length, sha256: createHash("sha256").update(bytes).digest("hex"), contentType: "application/octet-stream" };
      expect(calls.find(row => row.path.endsWith("/quote"))?.body.files).toEqual([descriptor]);
      expect(calls.find(row => row.path === "/api/v1/runs/owned-file")?.body).toMatchObject({ input: { approved: true }, args: ["--owned"], files: [descriptor], quoteReceipt: receipt, maxCredits: 3 });
      expect(calls.find(row => row.path.endsWith("/uploads"))?.body.files).toEqual([descriptor]);
      expect(calls.find(row => row.path === "/object")?.body).toEqual(bytes);
    });
  });
}

test("invalid basenames and duplicate exact names are refused before any HTTP", async () => {
  await fixture(async (client, calls) => {
    for (const name of ["", ".", "..", "../secret", "dir/name", "dir\\name", "/absolute", "a\0b", "a\nb", "a\u007fb", "\ud800", "\udc00", "a".repeat(256)]) {
      await expect(client.submitQuotedRunWithFiles("owned-file", {}, [], [{ name, bytes }], { maxCredits: 3 })).rejects.toThrow("safe basenames");
      expect(calls).toEqual([]);
    }
    await expect(client.submitQuotedRunWithFiles("owned-file", {}, [], [{ name: "same", bytes }, { name: "same", bytes }], { maxCredits: 3 })).rejects.toThrow("safe basenames");
    expect(calls).toEqual([]);
  });
});

test("canonically equivalent Unicode names remain distinct exact descriptors", async () => {
  await fixture(async (client, calls) => {
    const names = ["é.txt", "e\u0301.txt"];
    await client.uploadRunFiles("00000000-0000-4000-8000-000000000001", names.map(name => ({ name, bytes })));
    expect(calls.find(row => row.path.endsWith("/uploads"))?.body.files.map((file: { name: string }) => file.name)).toEqual(names);
    expect(calls.filter(row => row.path === "/object")).toHaveLength(2);
  });
});
