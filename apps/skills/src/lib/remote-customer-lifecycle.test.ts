import { describe, expect, test } from "bun:test";
import { RemoteSkillsAuthClient } from "./remote-auth.js";
import { RemoteSkillsClient } from "./remote-client.js";
import { decodeRemoteFiles, describeRemoteFiles, readBoundedResponse, sha256 } from "./remote-files.js";
import { useDefaultTestTimeout } from "../test-preload.js";

useDefaultTestTimeout();
const bytes = new TextEncoder().encode("verified fixture artifact\n");
const runId = "00000000-0000-4000-8000-000000000001";
type Mode = "ok" | "corrupt" | "short" | "redirect" | "upload-failed" | "no-capability" | "completed-replay" | "upload-race";
async function fixture(action: (client: RemoteSkillsClient, calls: Array<{ path: string; method: string; auth: string | null; body: any }>, redirected: () => number, origin: string) => Promise<void>, mode: Mode = "ok") {
  const calls: Array<{ path: string; method: string; auth: string | null; body: any }> = [];
  let redirectCount = 0;
  const destination = Bun.serve({ hostname: "127.0.0.1", port: 0, fetch() { redirectCount++; return new Response("unexpected"); } });
  const server = Bun.serve({ hostname: "127.0.0.1", port: 0, async fetch(request): Promise<Response> {
    const path = new URL(request.url).pathname;
    const body = request.method === "POST" ? (await request.text()) : request.method === "PUT" ? new Uint8Array(await request.arrayBuffer()) : null;
    calls.push({ path, method: request.method, auth: request.headers.get("authorization"), body: typeof body === "string" && body.startsWith("{") ? JSON.parse(body) : body });
    if (path.endsWith("/auth/keys")) return Response.json(request.method === "POST" ? { key: "new-fixture-key", id: "fixture-key-id" } : [{ id: "fixture-key-id", name: "SDK" }]);
    if (path.includes("/auth/keys/")) return Response.json({ id: "fixture-key-id", revoked: true });
    if (path.endsWith("/auth/verify")) return Response.json({ token: "fixture-session" });
    if (path.includes("/auth/")) return Response.json({ status: "fixture-response" });
    if (path.endsWith("/capabilities")) return Response.json({ product: "skills", contractVersion: 1, apiVersion: 1, capabilities: mode === "no-capability" ? [] : ["runs.submit", "runs.uploads"], billing: { unit: "credits", boundedRunApproval: true } });
    if (path.endsWith("/quote")) return Response.json({ skill: "server-only", pricing: { costCredits: 3 } });
    if (path.endsWith("/uploads") && mode === "upload-race") return Response.json({ code: "RUN_NOT_QUEUED" }, { status: 409 });
    if (path.endsWith("/uploads")) return Response.json({ files: [{ name: "input.txt", uploadUrl: `http://127.0.0.1:${server.port}/object` }] });
    if (path === "/object") return new Response(null, { status: mode === "upload-failed" ? 500 : 200 });
    if (path.endsWith("/artifacts")) return Response.json([{ id: "artifact", fileName: "result.txt", byteSize: bytes.byteLength, sha256: sha256(bytes) }]);
    if (path.endsWith("/download") || path === "/prefix/api/v1/skills") {
      if (mode === "redirect") return new Response(null, { status: 307, headers: { location: `http://127.0.0.1:${destination.port}/leak` } });
      return new Response(mode === "corrupt" ? new Uint8Array(bytes.byteLength) : mode === "short" ? bytes.slice(1) : bytes);
    }
    return Response.json({ id: runId, skill: "server-only", status: path.endsWith("/cancel") ? "cancelled" : mode === "completed-replay" ? "completed" : mode === "upload-race" && request.method === "GET" ? "running" : "queued" });
  } });
  try { await action(new RemoteSkillsClient("fixture-credential", `http://127.0.0.1:${server.port}/prefix/api/v1`), calls, () => redirectCount, `http://127.0.0.1:${server.port}/prefix`); }
  finally { await server.stop(true); await destination.stop(true); }
}

describe("shared remote customer lifecycle transport", () => {
  test("SDK auth and key management preserve the explicit API prefix and exact request contract", async () => fixture(async (client, calls, _redirected, origin) => {
    const auth = new RemoteSkillsAuthClient(`${origin}/api/v1`);
    await auth.requestCode("reader@example.test");
    await auth.verifyCode("reader@example.test", "000000");
    await auth.startDevice();
    await auth.pollDevice("fixture-device");
    expect(calls.slice(0, 4).map(call => [call.path, call.auth])).toEqual([
      ["/prefix/api/auth/login", null], ["/prefix/api/auth/verify", null],
      ["/prefix/api/auth/device/start", null], ["/prefix/api/auth/device/token", null],
    ]);
    expect(calls[1]?.body).toEqual({ email: "reader@example.test", code: "000000" });
    expect(await client.listApiKeys()).toEqual([{ id: "fixture-key-id", name: "SDK" }]);
    expect(await client.createApiKey("SDK", ["runs:read"])).toMatchObject({ id: "fixture-key-id" });
    expect(calls.at(-1)?.body).toEqual({ name: "SDK", scopes: ["runs:read"] });
    expect(await client.revokeApiKey("fixture-key-id")).toMatchObject({ revoked: true });
    expect(calls.at(-1)?.method).toBe("DELETE");
    await auth.listApiKeys("reader@example.test", "000000");
    await auth.createApiKey("reader@example.test", "000000", "Reauthenticated", ["runs:read"]);
    await auth.revokeApiKey("reader@example.test", "000000", "fixture-key-id");
    const sessionCalls = calls.slice(-6);
    expect(sessionCalls.filter(call => call.path.endsWith("/verify")).every(call => call.auth === null)).toBe(true);
    expect(sessionCalls.filter(call => call.path.includes("/auth/keys")).every(call => call.auth === "Bearer fixture-session")).toBe(true);
  }));
  test("tag discovery accepts both instance contracts and rejects mixed or invalid records", async () => {
    let payload: unknown = [];
    const requests: string[] = [];
    const server = Bun.serve({ hostname: "127.0.0.1", port: 0, fetch(request) {
      requests.push(new URL(request.url).pathname);
      return Response.json(payload);
    } });
    const client = new RemoteSkillsClient("fixture-credential", `http://127.0.0.1:${server.port}/prefix/api/v1`);
    try {
      for (const valid of [[], ["writing", "research"], [{ name: "writing", count: 2 }, { name: "research", count: 0 }]]) {
        payload = valid;
        expect(await client.listTags()).toEqual(valid.length === 0 ? [] : ["writing", "research"]);
      }
      for (const invalid of [
        ["writing", { name: "research", count: 2 }], [{ name: "writing" }],
        [{ name: "", count: 1 }], [{ name: "  ", count: 1 }], [{ name: "writing", count: -1 }],
        [{ name: "writing", count: 0.5 }], [{ name: "writing", count: "2" }],
        [{ name: "writing", count: Number.MAX_SAFE_INTEGER + 1 }], [null], { tags: [] },
      ]) {
        payload = invalid;
        await expect(client.listTags()).rejects.toThrow("did not match the expected contract");
      }
      expect(requests).toHaveLength(13);
      expect(requests.every(path => path === "/prefix/api/v1/tags")).toBe(true);
    } finally { await server.stop(true); }
  });
  test("approved uploads declare product files before sending bytes, without forwarding credentials to storage", async () => fixture(async (client, calls) => {
    const files = [{ name: "input.txt", bytes, contentType: "text/plain" }];
    const run = await client.submitQuotedRunWithFiles("server-only", {}, ["--fixture"], files, { maxCredits: 3, idempotencyKey: "same-attempt" });
    expect(run.id).toBe(runId);
    const admission = calls.find(call => call.path.endsWith("/runs/server-only"))!;
    expect(admission.body).toMatchObject({ files: describeRemoteFiles(files), maxCredits: 3, maxCostCents: 3, idempotencyKey: "same-attempt" });
    expect(admission.body.inputFiles).toBeUndefined();
    expect(calls.findIndex(call => call === admission)).toBeLessThan(calls.findIndex(call => call.path.endsWith("/uploads")));
    expect(calls.find(call => call.path === "/object")).toMatchObject({ auth: null, method: "PUT", body: bytes });
    expect(calls.filter(call => call.path !== "/object").every(call => call.auth === "Bearer fixture-credential")).toBe(true);
  }));
  test("file-run replays preserve completed work and a concurrently started worker", async () => {
    for (const mode of ["completed-replay", "upload-race"] as const) await fixture(async (client, calls) => {
      const run = await client.submitQuotedRunWithFiles("server-only", {}, [], [{ name: "input.txt", bytes }], { maxCredits: 3, idempotencyKey: "same-attempt" });
      expect(run.status).toBe(mode === "completed-replay" ? "completed" : "running");
      expect(calls.filter(call => call.path.endsWith("/uploads"))).toHaveLength(mode === "completed-replay" ? 0 : 1);
      expect(calls.filter(call => call.path.endsWith("/cancel") || call.path === "/object")).toHaveLength(0);
    }, mode);
  });
  test("failed uploads request cancellation of the same admitted run", async () => fixture(async (client, calls) => {
    await expect(client.submitQuotedRunWithFiles("server-only", {}, [], [{ name: "input.txt", bytes }], { maxCredits: 3 })).rejects.toThrow("cancellation requested");
    expect(calls.filter(call => call.path.endsWith(`/${runId}/cancel`))).toHaveLength(1);
  }, "upload-failed"));
  test("servers without bounded admission or uploads never receive a run", async () => fixture(async (client, calls) => {
    await expect(client.submitQuotedRun("server-only", {}, [], { maxCredits: 3 })).rejects.toThrow("bounded credit approval");
    await expect(client.submitQuotedRunWithFiles("server-only", {}, [], [{ name: "input.txt", bytes }], { maxCredits: 3 })).rejects.toThrow("input uploads");
    expect(calls.filter(call => call.path.includes("/runs/"))).toEqual([]);
  }, "no-capability"));
  test("download verifies size and SHA-256 against authenticated metadata", async () => fixture(async (client) => {
    const artifact = await client.getVerifiedRunArtifact(runId, "artifact");
    expect(artifact.bytes).toEqual(bytes);
    expect(artifact.sha256).toBe(sha256(bytes));
    expect(artifact.byteSize).toBe(bytes.byteLength);
  }));
  test("corrupt and truncated artifacts fail verification", async () => {
    for (const mode of ["corrupt", "short"] as const) await fixture(async client => {
      await expect(client.getVerifiedRunArtifact(runId, "artifact")).rejects.toThrow("integrity verification failed");
    }, mode);
  });
  test("downloads and multipart publication reject redirects before sending credentials to another origin", async () => fixture(async (client, _calls, redirected) => {
    await expect(client.getVerifiedRunArtifact(runId, "artifact")).rejects.toThrow();
    await expect(client.publishSkill({ slug: "fixture" })).rejects.toThrow();
    expect(redirected()).toBe(0);
  }, "redirect"));
  test("stream limits cancel even when no Content-Length is provided", async () => {
    let cancelled = false;
    const response = new Response(new ReadableStream({ pull(controller) { controller.enqueue(bytes); }, cancel() { cancelled = true; } }));
    await expect(readBoundedResponse(response, 3)).rejects.toThrow("declared size limit");
    expect(cancelled).toBe(true);
    expect(() => decodeRemoteFiles([{ name: "../secret", base64: "YQ==" }])).toThrow("safe basenames");
    expect(() => decodeRemoteFiles([{ name: "file", base64: "not base64" }])).toThrow("encoding");
    expect(decodeRemoteFiles([{ name: "file", base64: "YQ==" }])[0]?.bytes).toEqual(new Uint8Array([97]));
  });
});
