import { useDefaultTestTimeout } from "../test-preload.js";
useDefaultTestTimeout();
import { afterEach, expect, test } from "bun:test";
import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  admitPlugin,
  planPluginAdmission,
  pluginReceiptPath,
  readPluginAdmissionReceipt,
  resolveAdmittedPlugin,
} from "./plugin-admission.js";
import { pluginFixture, putSynthetic } from "./plugin-admission.test-fixtures.js";
import type { AuthenticatedProfilePrincipal, ProfileClient } from "./profile-client.js";

const roots: string[] = [];
afterEach(() => roots.splice(0).forEach(root => rmSync(root, { recursive: true, force: true })));
function fixture() {
  const root = mkdtempSync(join(tmpdir(), "skills-plugin-security-"));
  roots.push(root);
  return pluginFixture(root);
}

test("the accepted resolver command hashes and executes one pinned inode", async () => {
  const f = fixture();
  const reviewed = await planPluginAdmission("synthetic-integration", "synthetic-profile", f.target, f.options);
  const command = reviewed.sourceCommand;
  expect(command.indexOf("/usr/bin/sha256sum /proc/self/fd/9")).toBeGreaterThan(0);
  expect(command.indexOf("exec /proc/self/fd/9 integration plugin resolve")).toBeGreaterThan(command.indexOf("/usr/bin/sha256sum /proc/self/fd/9"));
  expect(command).toContain(f.target.resolver.digest);

  const approved = Bun.spawn(["/bin/sh", "-c", command], { stdin: "ignore", stdout: "pipe", stderr: "pipe" });
  expect(await approved.exited).toBe(91);

  const marker = join(roots.at(-1)!, "unapproved-resolver-ran");
  putSynthetic(f.target.resolver.executable, `#!/bin/sh\nprintf ran > ${JSON.stringify(marker)}\n`, 0o755);
  const replaced = Bun.spawn(["/bin/sh", "-c", command], { stdin: "ignore", stdout: "pipe", stderr: "pipe" });
  expect(await replaced.exited).not.toBe(0);
  expect(existsSync(marker)).toBe(false);
});

test("a receipt cannot be reused by another principal in the same account", async () => {
  const f = fixture();
  const reviewed = await planPluginAdmission("synthetic-integration", "synthetic-profile", f.target, f.options);
  const receipt = await admitPlugin("synthetic-integration", "synthetic-profile", f.target, reviewed.planDigest, reviewed.evidenceDigest, f.options);
  expect(reviewed.binding.principal).toEqual({ userId: "synthetic-owner", accountId: "synthetic-workspace", role: "owner" });

  f.state.principal = { ...f.state.principal, userId: "different-owner" };
  const other = await planPluginAdmission("synthetic-integration", "synthetic-profile", f.target, f.options);
  expect(other.bindingId).not.toBe(reviewed.bindingId);
  expect(other.planDigest).not.toBe(reviewed.planDigest);
  await expect(resolveAdmittedPlugin(reviewed.bindingId, f.options)).rejects.toThrow("different plugin authority, workspace, or principal");
  expect(receipt.materializedPath).not.toBe(join(f.options.storeRoot, "objects", other.bindingId, other.planDigest.slice(7)));
});

test("owner role and account are checked before admission and on every resolve", async () => {
  for (const role of ["admin", "member", "viewer"] as const) {
    const f = fixture();
    f.state.principal = { ...f.state.principal, role };
    await expect(planPluginAdmission("synthetic-integration", "synthetic-profile", f.target, f.options)).rejects.toThrow("workspace owner");
    expect(f.state.profileCalls).toBe(0);
    expect(f.state.bundleCalls).toBe(0);
  }

  const f = fixture();
  const reviewed = await planPluginAdmission("synthetic-integration", "synthetic-profile", f.target, f.options);
  await admitPlugin("synthetic-integration", "synthetic-profile", f.target, reviewed.planDigest, reviewed.evidenceDigest, f.options);
  f.state.principal = { ...f.state.principal, role: "admin" };
  await expect(resolveAdmittedPlugin(reviewed.bindingId, f.options)).rejects.toThrow("workspace owner");
  f.state.principal = { userId: "synthetic-owner", accountId: "other-account", role: "owner" };
  await expect(resolveAdmittedPlugin(reviewed.bindingId, f.options)).rejects.toThrow("selected workspace");
});

test("principal or role drift during one candidate resolution refuses before publication", async () => {
  for (const second of [
    { userId: "other-owner", accountId: "synthetic-workspace", role: "owner" },
    { userId: "synthetic-owner", accountId: "synthetic-workspace", role: "admin" },
  ] as AuthenticatedProfilePrincipal[]) {
    const f = fixture();
    let calls = 0;
    const client: ProfileClient = {
      ...f.client,
      resolvePrincipal: async () => (++calls === 1 ? { ...f.state.principal } : second),
    };
    await expect(planPluginAdmission("synthetic-integration", "synthetic-profile", f.target, { ...f.options, client })).rejects.toThrow();
    expect(calls).toBe(2);
    expect(readFileSync(f.target.resolver.executable, "utf8")).toContain("exit 91");
  }
});

test("profile revision, aliases, or triggers changing during one candidate resolution refuse", async () => {
  for (const change of ["revision", "alias", "trigger"]) {
    const f = fixture();
    let calls = 0;
    const client: ProfileClient = {
      ...f.client,
      resolveProfile: async id => {
        const profile = await f.client.resolveProfile(id);
        if (++calls === 2) {
          if (change === "revision") {
            profile.profileRevision = `changed-${change}`;
            for (const selection of profile.selections) selection.profileRevision = profile.profileRevision;
          }
          if (change === "alias") profile.selections[0]!.aliases = ["changed-alias"];
          if (change === "trigger") profile.selections[0]!.triggers = { always: true };
        }
        return profile;
      },
    };
    await expect(planPluginAdmission("synthetic-integration", "synthetic-profile", f.target, { ...f.options, client })).rejects.toThrow("profile changed during verification");
    expect(calls).toBe(2);
  }
});

test("legacy vulnerable receipts fail closed instead of being upgraded implicitly", async () => {
  const f = fixture();
  const reviewed = await planPluginAdmission("synthetic-integration", "synthetic-profile", f.target, f.options);
  await admitPlugin("synthetic-integration", "synthetic-profile", f.target, reviewed.planDigest, reviewed.evidenceDigest, f.options);
  const path = pluginReceiptPath(f.options.storeRoot, reviewed.bindingId, reviewed.planDigest);
  const receipt = JSON.parse(readFileSync(path, "utf8"));
  receipt.schemaVersion = 2;
  writeFileSync(path, JSON.stringify(receipt), { mode: 0o600 });
  expect(() => readPluginAdmissionReceipt(f.options.storeRoot, reviewed.bindingId, reviewed.planDigest)).toThrow("schema version 3");
});
