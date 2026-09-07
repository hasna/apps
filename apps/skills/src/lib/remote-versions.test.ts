import { expect, test } from "bun:test";
import { RemoteSkillsClient, RemoteRequestError, RemoteRouteUnsupportedError } from "./remote-client.js";
import { useDefaultTestTimeout } from "../test-preload.js";
useDefaultTestTimeout();

const invalidResponse = "Remote skill version payload did not match the expected contract.";
const row = () => ({ slug: "owned-version", version: "2026.09+draft", bundleSha256: "a".repeat(64),
  bundleByteSize: 42, createdAt: "2026-09-07T00:00:00.123456+00:00" });
type Reply = { body: unknown; status?: number; raw?: boolean };
async function fixture(action: (client: RemoteSkillsClient, reply: (value: Reply) => void, paths: string[]) => Promise<void>) {
  const token = crypto.randomUUID(), paths: string[] = [];
  let response: Reply = { body: { versions: [] } };
  const server = Bun.serve({ hostname: "127.0.0.1", port: 0, fetch(request) {
    expect(request.method).toBe("GET");
    expect(request.headers.get("authorization")).toBe(`Bearer ${token}`);
    paths.push(new URL(request.url).pathname);
    return response.raw ? new Response(String(response.body), { status: response.status ?? 200 })
      : Response.json(response.body, { status: response.status ?? 200 });
  } });
  try { await action(new RemoteSkillsClient(token, `${server.url.origin}/prefix`), value => { response = value; }, paths); }
  finally { await server.stop(true); }
}

test("version HTTP reads preserve minimal rows, optional fields, exact timestamps, order and additive data", async () => fixture(async (client, reply, paths) => {
  const minimal = row(), extended = { ...row(), version: "1.0", current: false, storageKind: "future-store",
    manifest: { files: {} }, storageKey: "preserved/key", publishedByUserId: "preserved-author" };
  reply({ body: { versions: [minimal, extended], additiveEnvelope: true } });
  expect(await client.listSkillVersions(minimal.slug)).toEqual([minimal, extended]);
  reply({ body: { slug: minimal.slug, versions: [] } });
  expect(await client.listSkillVersions(minimal.slug)).toEqual([]);
  for (const expected of [minimal, extended, { ...minimal, bundleByteSize: 0, current: true }]) {
    reply({ body: expected });
    expect(await client.getSkillVersion(expected.slug, expected.version)).toEqual(expected);
  }
  expect(paths).toEqual(["/prefix/api/v1/skills/owned-version/versions", "/prefix/api/v1/skills/owned-version/versions",
    "/prefix/api/v1/skills/owned-version/versions/2026.09%2Bdraft", "/prefix/api/v1/skills/owned-version/versions/1.0",
    "/prefix/api/v1/skills/owned-version/versions/2026.09%2Bdraft"]);
}));

test("version lists refuse missing arrays and mismatched envelope identity instead of reporting empty history", async () => fixture(async (client, reply) => {
  for (const body of [null, [], {}, { versions: null }, { versions: {} }, { versions: "empty" },
    { slug: "other", versions: [] }, { slug: null, versions: [row()] }]) {
    reply({ body });
    await expect(client.listSkillVersions("owned-version")).rejects.toThrow(invalidResponse);
  }
}));

test("list and single-version reads reject malformed rows before exposing partial or misbound history", async () => fixture(async (client, reply) => {
  const valid = row();
  const malformed = [null, [], {},
    ...["slug", "version", "bundleSha256", "bundleByteSize", "createdAt"].map(key => ({ ...valid, [key]: undefined })),
    ...["", "other", 1].map(slug => ({ ...valid, slug })),
    ...["", 1].map(version => ({ ...valid, version })),
    ...["", "a".repeat(63), "g".repeat(64), 123].map(bundleSha256 => ({ ...valid, bundleSha256 })),
    ...[-1, 0.5, Number.MAX_SAFE_INTEGER + 1, "42", null].map(bundleByteSize => ({ ...valid, bundleByteSize })),
    ...["", null, 123].map(createdAt => ({ ...valid, createdAt })),
    ...["yes", null, 1].map(current => ({ ...valid, current })),
    ...[null, 1].map(storageKind => ({ ...valid, storageKind })),
    ...[null, [], "object"].map(manifest => ({ ...valid, manifest }))];
  for (const broken of malformed) {
    reply({ body: { versions: [valid, broken] } });
    await expect(client.listSkillVersions(valid.slug)).rejects.toThrow(invalidResponse);
    reply({ body: broken });
    await expect(client.getSkillVersion(valid.slug, valid.version)).rejects.toThrow(invalidResponse);
  }
  reply({ body: { ...valid, version: "different" } });
  await expect(client.getSkillVersion(valid.slug, valid.version)).rejects.toThrow(invalidResponse);
}));

test("version JSON and HTTP errors never display response content", async () => fixture(async (client, reply) => {
  const canary = crypto.randomUUID();
  for (const invoke of [() => client.listSkillVersions("owned-version"), () => client.getSkillVersion("owned-version", row().version)]) {
    reply({ body: `<invalid>${canary}</invalid>`, raw: true });
    await expect(invoke()).rejects.toThrow(invalidResponse);
    for (const status of [400, 401, 403, 500]) {
      reply({ status, body: { error: canary } });
      try { await invoke(); throw Error("Expected the HTTP request to fail"); }
      catch (error) {
        expect(error).toBeInstanceOf(RemoteRequestError);
        expect((error as RemoteRequestError).status).toBe(status);
        expect((error as Error).message).not.toContain(canary);
      }
    }
  }
}));

test("version domain absence stays empty or null while unsupported routes remain errors", async () => fixture(async (client, reply) => {
  reply({ status: 404, body: { code: "SKILL_NOT_FOUND" } });
  expect(await client.listSkillVersions("owned-version")).toEqual([]);
  expect(await client.getSkillVersion("owned-version", row().version)).toBeNull();
  reply({ status: 404, body: { code: "SKILL_VERSION_NOT_FOUND" } });
  expect(await client.getSkillVersion("owned-version", row().version)).toBeNull();
  await expect(client.listSkillVersions("owned-version")).rejects.toBeInstanceOf(RemoteRouteUnsupportedError);
  for (const response of [{ status: 404, body: { code: "NOT_FOUND" } }, { status: 405, body: { code: "SKILL_NOT_FOUND" } }]) {
    reply(response);
    await expect(client.listSkillVersions("owned-version")).rejects.toBeInstanceOf(RemoteRouteUnsupportedError);
    await expect(client.getSkillVersion("owned-version", row().version)).rejects.toBeInstanceOf(RemoteRouteUnsupportedError);
  }
}));
