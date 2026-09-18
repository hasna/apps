import assert from "node:assert/strict";
import { randomBytes, randomUUID } from "node:crypto";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, readlinkSync, realpathSync, rmSync, symlinkSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { ApiKeyStore, mintApiKey } from "@hasna/contracts/auth";
import { PgTrashStore } from "../src/api/store.js";
import { createTrashHandler } from "../src/api/service.js";
import { ApiError, type Entry } from "../src/api/domain.js";
import type { TransferGrant, TrashObjects } from "../src/api/objects.js";
import { inspectCapsuleStream } from "../src/capsule.js";
import { TrashApi } from "../src/client.js";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js";
import { createTrashMcpServer } from "../src/mcp/server.js";
import { runHostedCli } from "../src/cli/hosted.js";
import { HostedTrash, HostedOperationError } from "../src/hosted.js";

const databaseUrl = process.env.TRASH_TEST_DATABASE_URL;
if (!databaseUrl) throw new Error("TRASH_TEST_DATABASE_URL must identify an explicitly disposable PostgreSQL database.");
const tenant = `test-${randomUUID()}`; const signingSecret = randomBytes(32);
const store = await PgTrashStore.open(databaseUrl, { migrate: true });
const root = realpathSync(mkdtempSync(join(tmpdir(), "trash-pg-filesystem-")));
const payloads = new Map<string, Buffer>(); let loseCommit = false;
function grant(entry: Entry, method: "GET" | "PUT"): TransferGrant {
  return { url: `https://fixture-bucket.s3.us-east-1.amazonaws.com/${entry.id}?X-Amz-Signature=fixture`, method,
    headers: method === "GET" ? {} : { "content-length": String(entry.artifact.sizeBytes), "content-type": "application/octet-stream", "if-none-match": "*", "x-amz-checksum-sha256": Buffer.from(entry.artifact.sha256, "hex").toString("base64"), "x-amz-server-side-encryption": "AES256" },
    expiresAt: new Date(Date.now() + 60_000).toISOString() };
}
const objects: TrashObjects = {
  async ready() {}, async upload(entry) { return grant(entry, "PUT"); }, async download(entry) { return grant(entry, "GET"); },
  async verify(entry) {
    const bytes = payloads.get(entry.id); if (!bytes) throw new ApiError(409, "upload_missing", "Fixture upload missing.");
    return { version: "fixture-version", receipt: await inspectCapsuleStream(new Blob([bytes]).stream(), entry.artifact.sizeBytes) };
  }, async remove(entry) { payloads.delete(entry.id); },
};
const handler = createTrashHandler(store, objects, { signingSecret });
const keys = new ApiKeyStore(store.authQueryClient());
try {
  const key = mintApiKey({ app: "trash", signingSecret, tid: tenant, agent: "station-fixture", scopes: ["trash:read", "trash:write"] });
  await keys.insertMinted(key);
  const api = new TrashApi({ env: { HASNA_TRASH_API_KEY: key.token, HASNA_TRASH_API_URL: "https://trash.example.test" }, fetchImpl: async (url, init) => {
    const response = await handler(new Request(url, init));
    if (loseCommit && url.endsWith("/commit")) { void response.body?.cancel(); throw new Error("Fixture lost commit response"); }
    return response;
  } });
  const station = () => ({ name: "station-fixture", hostname: "Mac", source: "tailscale" as const, platform: "darwin", architecture: "arm64" });
  const client = new HostedTrash({ api, env: { HOME: root }, operationRoot: join(root, "operations"), station,
    transferFetch: async (url, init) => {
      const id = new URL(url).pathname.slice(1);
      if (init?.method === "PUT") { payloads.set(id, Buffer.from(await new Response(init.body).arrayBuffer())); return new Response(null, { status: 200 }); }
      return new Response(payloads.get(id)!);
    },
  });
  const source = join(root, "source"); mkdirSync(source); mkdirSync(join(source, "empty"));
  const bytes = Buffer.from([0, 255, 23, 99]); writeFileSync(join(source, "résumé.bin"), bytes); symlinkSync("missing", join(source, "dangling"));
  const entry = await client.put(source, { agent: "postgres-proof" });
  assert.equal(existsSync(source), false); assert.equal(entry.state, "trashed"); assert.equal(client.pending().length, 0);
  const stored = await store.entry(tenant, entry.id);
  assert.equal(stored.objectVersion, "fixture-version"); assert.equal(stored.agent.name, "postgres-proof");
  assert.equal(Date.parse(stored.expiresAt!) - Date.parse(stored.trashedAt!), 90 * 86_400_000);
  await client.restore(entry.id);
  assert.deepEqual(readFileSync(join(source, "résumé.bin")), bytes); assert.equal(readlinkSync(join(source, "dangling")), "missing");
  assert.equal((await store.entry(tenant, entry.id)).state, "restored");
  const interrupted = join(root, "interrupted"); writeFileSync(interrupted, "recoverable original"); loseCommit = true;
  await assert.rejects(client.put(interrupted), HostedOperationError);
  const pending = client.pending()[0]!; assert.equal(pending.phase, "committing"); assert.equal(existsSync(interrupted), false);
  assert.equal((await store.entry(tenant, pending.entryId!)).state, "trashed");
  loseCommit = false; await client.recover(pending.id); assert.equal(client.pending().length, 0);
  await client.restore(pending.entryId!); assert.equal(readFileSync(interrupted, "utf8"), "recoverable original");
  // Exercise the exact CLI dispatcher against real PostgreSQL and filesystem operations.
  const cliSource = join(root, "cli-source"); writeFileSync(cliSource, "CLI bytes");
  let output = ""; let errors = "";
  const cli = (verb: string, rest: string[]) => runHostedCli({ verb, rest, flags: { json: true }, guard: null }, { api, hosted: client, stdout: (text) => { output += text; }, stderr: (text) => { errors += text; } });
  assert.equal(await cli("put", [cliSource]), 0); assert.equal(errors, "");
  const cliEntry = JSON.parse(output)[0]; assert.equal(existsSync(cliSource), false); assert.equal(cliEntry.station, "station-fixture");
  assert.equal("artifact" in cliEntry, false); output = "";
  assert.equal(await cli("list", ["--limit", "1", "--path", "cli-source"]), 0);
  assert.equal(JSON.parse(output).items[0].id, cliEntry.id); output = "";
  assert.equal(await cli("restore", [cliEntry.id]), 0); assert.equal(readFileSync(cliSource, "utf8"), "CLI bytes");
  const mcpSource = join(root, "mcp-source"); writeFileSync(mcpSource, "MCP bytes");
  const mcp = createTrashMcpServer({ api, hosted: client }); const mcpClient = new Client({ name: "postgres-proof", version: "1" });
  const [mcpTransport, serverTransport] = InMemoryTransport.createLinkedPair();
  try {
    await mcp.connect(serverTransport); await mcpClient.connect(mcpTransport);
    const removed = await mcpClient.callTool({ name: "trash_put", arguments: { path: mcpSource } });
    assert.notEqual(removed.isError, true); assert.equal(existsSync(mcpSource), false);
    const mcpEntry = JSON.parse((removed.content as Array<{text: string}>)[0]!.text);
    const backed = await mcpClient.callTool({ name: "trash_backup", arguments: { id: mcpEntry.id, version: mcpEntry.version } });
    assert.notEqual(backed.isError, true); assert.equal((await api.get(mcpEntry.id)).backup, "requested");
    const restored = await mcpClient.callTool({ name: "trash_restore", arguments: { id: mcpEntry.id } });
    assert.notEqual(restored.isError, true); assert.equal(readFileSync(mcpSource, "utf8"), "MCP bytes");
  } finally { await mcpClient.close(); await mcp.close(); }
  await keys.revoke(key.kid, "fixture complete", Date.now(), { app: "trash" });
  const denied = join(root, "denied"); writeFileSync(denied, "untouched");
  await assert.rejects(client.put(denied)); assert.equal(readFileSync(denied, "utf8"), "untouched");
  console.log(JSON.stringify({ proof: "postgres-hosted-filesystem", passed: true, objectPlane: "injected fixture adapter; not S3", checks: ["canonical-client-transport", "signed-station-registration", "verified-capture", "90-day-commit-clock", "unicode-binary-tree-restore", "symlink-restore", "lost-response-idempotency", "journal-recovery", "revoked-key-preserves-source", "cli-put-list-restore", "mcp-put-backup-request-restore"] }));
} finally {
  await store.sql.unsafe("DELETE FROM api_keys WHERE tid=$1", [tenant]);
  for (const table of ["trash_idempotency", "trash_entries", "trash_station_keys", "trash_stations"]) await store.sql.unsafe(`DELETE FROM ${table} WHERE tenant=$1`, [tenant]);
  await store.close(); rmSync(root, { recursive: true, force: true });
}
