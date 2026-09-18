import { afterEach, expect, test } from "bun:test";
import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { runCliInCwd } from "./cli.test-utils.js";
import { sessionReceiptPath, writeSelectionJson } from "../lib/selection-cache.js";
import { useDefaultTestTimeout } from "../test-preload.js";

useDefaultTestTimeout();
const roots: string[] = [], servers: ReturnType<typeof Bun.serve>[] = [];
afterEach(() => { for (const server of servers.splice(0)) server.stop(true); for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true }); });

test("the CLI plans and applies one exact session migration using only API reads", async () => {
  const root = mkdtempSync(join(tmpdir(), "skills-session-cli-")); roots.push(root);
  const requests: string[] = [];
  const server = Bun.serve({ hostname: "127.0.0.1", port: 0, fetch(request): Response {
    const url = new URL(request.url); requests.push(`${request.method} ${url.pathname}`);
    if (request.method === "GET" && url.pathname === "/api/v1/profiles/shared/resolve") {
      return Response.json({ authority: `${url.origin}/api/v1`, workspaceId: "example", profileId: "shared", profileRevision: "new-revision", selections: [] });
    }
    return new Response("Unexpected synthetic route", { status: 404 });
  } }); servers.push(server);
  const data = join(root, "data"), cacheDir = join(data, "selection-cache");
  const env = { HOME: root, HASNA_HOME: join(root, "hasna"), HASNA_SKILLS_DIR: data, HASNA_SKILLS_API_KEY: "synthetic-session-fixture", HASNA_SKILLS_API_URL: `http://127.0.0.1:${server.port}`, HASNA_SKILLS_LOCAL: "0" };
  writeSelectionJson(sessionReceiptPath("parent", { cacheDir }), {
    schemaVersion: 1, sessionId: "parent", verifiedAt: "2026-01-01T00:00:00Z", loaded: [],
    profile: { authority: `http://127.0.0.1:${server.port}/api/v1`, workspaceId: "example", profileId: "legacy", profileRevision: "old-revision", selections: [] },
  });
  const original = readFileSync(sessionReceiptPath("parent", { cacheDir }));
  const shown = await runCliInCwd(["sessions", "show", "parent", "--json"], root, env);
  expect(shown.exitCode).toBe(0);
  const metadata = JSON.parse(shown.stdout);
  expect(metadata.profileId).toBe("legacy"); expect(metadata.generation).toBe(0); expect(requests).toEqual([]);
  const args = ["sessions", "reconcile", "parent", "--from-profile", "legacy", "--from-revision", "old-revision", "--receipt-sha256", metadata.receiptSha256, "--selection-profile", "shared", "--profile-revision", "new-revision", "--json"];
  const planned = await runCliInCwd(args, root, env); expect(planned.exitCode).toBe(0);
  const plan = JSON.parse(planned.stdout); expect(plan.applied).toBe(false);
  expect(readFileSync(sessionReceiptPath("parent", { cacheDir }))).toEqual(original);
  const applied = await runCliInCwd([...args, "--apply", "--plan-digest", plan.planDigest, "--plan-issued-at", plan.plan.issuedAt, "--plan-expires-at", plan.plan.expiresAt], root, env);
  expect(applied.exitCode).toBe(0); const result = JSON.parse(applied.stdout);
  expect(result.applied).toBe(true); expect(readFileSync(result.archivePath)).toEqual(original);
  const after = await runCliInCwd(["sessions", "show", "parent", "--json"], root, env);
  expect(JSON.parse(after.stdout)).toMatchObject({ profileRevision: "new-revision", generation: 1 });
  const repeat = await runCliInCwd([...args, "--apply", "--plan-digest", plan.planDigest, "--plan-issued-at", plan.plan.issuedAt, "--plan-expires-at", plan.plan.expiresAt], root, env);
  expect(repeat.exitCode).toBe(1); expect(JSON.parse(repeat.stdout).error.code).toBe("SESSION_RECEIPT_CHANGED");
  expect(requests).toEqual(["GET /api/v1/profiles/shared/resolve", "GET /api/v1/profiles/shared/resolve"]);
});
