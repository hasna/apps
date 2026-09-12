import { test, expect } from "bun:test";
import { existsSync, mkdtempSync, readFileSync, realpathSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { randomUUID } from "node:crypto";
import { tmpdir } from "node:os";
import * as workspaceProfile from "./workspace-profile.js";
import { captureProfileWorkspace } from "./workspace-profile.js";
import { getAuthFilePath, getIdentityFilePath } from "./auth-store.js";
import { writeSkillsCredentialFixture } from "./credential-fixture.test-utils.js";
import { useDefaultTestTimeout } from "../test-preload.js";

useDefaultTestTimeout();

test("the enrollment writer is gone: this module exports no credential writer", () => {
  // `prepareWorkspaceEnrollment` minted a workspace key and wrote it into the
  // named profile's credentials file. This package writes no credential file
  // (fail-closed re-cut, hasna/apps#1720), so neither the export nor any
  // filesystem writer may come back.
  expect((workspaceProfile as Record<string, unknown>)["prepareWorkspaceEnrollment"]).toBeUndefined();
  const source = readFileSync(new URL("./workspace-profile.ts", import.meta.url), "utf-8");
  for (const writer of ["writeFileSync", "renameSync", "mkdtempSync", "rmSync"]) expect(source, writer).not.toContain(writer);
});

test("a provisioned profile key proves its workspace identity before a fresh-auth mutation", async () => {
  // macOS exposes its temporary directory through /var; fixture identity must
  // be canonical while intentionally linked profile paths remain forbidden.
  const home = realpathSync(mkdtempSync(join(tmpdir(), "skills-workspace-profile-")));
  const userId = randomUUID(), membershipId = randomUUID(), orgId = randomUUID(), key = `sk_${randomUUID()}`;
  const calls: string[] = [];
  const server = Bun.serve({ hostname: "127.0.0.1", port: 0, fetch(req) {
    const path = new URL(req.url).pathname; calls.push(`${req.method} ${path}`);
    const bearer = req.headers.get("authorization")?.slice(7);
    if (path === "/api/auth/whoami") {
      return Response.json({ authMethod: bearer === key ? "api_key" : "jwt",
        user: { id: userId, membershipId, email: "user@example.test", displayName: null, role: "owner" },
        organization: { id: orgId, slug: "a", name: "A" } });
    }
    return new Response("", { status: 404 });
  } });
  const origin = `http://127.0.0.1:${server.port}`;
  const env = { HOME: home, HASNA_HOME: join(home, "fleet"), HASNA_PROFILE: "target", HASNA_SKILLS_API_URL: origin, PATH: process.env.PATH };
  try {
    // The operator's provisioning step, simulated.
    writeSkillsCredentialFixture(env, { apiKey: key, apiUrl: origin, identity: { userId, orgId, email: "user@example.test" } });
    const captured = await captureProfileWorkspace("test", env);
    expect(captured.origin).toBe(origin);
    expect(captured.context).toEqual({ userId, membershipId });
    expect(calls).toEqual(["GET /api/auth/whoami"]);

    // Identity metadata naming another principal blocks the mutation before any OTP is spent.
    writeFileSync(getIdentityFilePath(env), JSON.stringify({ userId: randomUUID() }), { mode: 0o600 });
    await expect(captureProfileWorkspace("test", env)).rejects.toThrow("does not match its authenticated key");
    // Nothing here edits the provisioned file.
    expect(existsSync(getAuthFilePath(env))).toBe(true);
    expect(readFileSync(getAuthFilePath(env), "utf8")).toContain(key);
  } finally { server.stop(true); rmSync(home, { recursive: true, force: true }); }
});
