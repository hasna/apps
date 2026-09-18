import { expect, test } from "bun:test";
import { join } from "node:path";
import { copyFileSync, existsSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { useDefaultTestTimeout } from "../test-preload.js";
useDefaultTestTimeout();
test("durable vault reference uses the normal SDK bootstrap and preserves every refusal", () => {
  const child = Bun.spawnSync([process.execPath, "--no-env-file", join(import.meta.dir, "vault-reference.fixture.ts")], {
    env: { PATH: process.env.PATH, HOME: "/nonexistent-vault-reference-fixture" },
    timeout: 15000, stdout: "pipe", stderr: "pipe",
  });
  expect(child.exitCode).toBe(0);
  const result = JSON.parse(child.stdout.toString());
  for (const name of ["normalFileReferenceWorks", "missingRefusesWithoutLiteralFallback", "unauthorizedRefusesWithoutLiteralFallback", "emptyRefusesWithoutLiteralFallback", "directBootstrapRefusesLockedKeychain", "pointerPreservesAmbientKeychainRefusal", "fileReferenceRetainsInstanceBinding", "fileChangeDuringVaultReadRefuses", "missingBootstrapRefuses", "malformedBootstrapRefuses", "unreadableBootstrapRefuses", "unreachableVaultRefuses", "recursiveBootstrapRefuses", "explicitLocalModeDoesNotInspectFiles"]) {
    expect(result[name], name).toBe(true);
  }
  expect(child.stdout.toString()).not.toContain("dummy-vault-key");
  expect(child.stderr.toString()).not.toContain("dummy-bootstrap-key");
});

test("the unmocked built CLI loads the installed ESM SDK and refuses missing dependencies", async () => {
  const home = mkdtempSync(join(tmpdir(), "vault-cli-"));
  const file = join(home, ".hasna/skills/config/credentials");
  const cli = new URL("../../bin/index.js", import.meta.url).pathname;
  for (const app of ["skills", "secrets"]) mkdirSync(join(home, `.hasna/${app}/config`), { recursive: true, mode: 0o700 });
  const isolated = join(home, "isolated/skills.js");
  mkdirSync(join(home, "isolated"), { mode: 0o700 });
  copyFileSync(cli, isolated);
  let mode = "ok", vaultRequests = 0, skillsRequests = 0, capabilityRequests = 0, registryRequests = 0, correctCredential = true;
  const key = () => mode === "rotate" ? "dummy-vault-key-rotated" : "dummy-vault-key";
  const server = Bun.serve({ hostname: "127.0.0.1", port: 0, fetch(req) {
    const path = new URL(req.url).pathname;
    if (path === "/v1/secrets/get") {
      vaultRequests++;
      correctCredential &&= req.headers.get("x-api-key") === "dummy-bootstrap-key";
      if (mode === "missing") return new Response(null, { status: 404 });
      if (mode === "drift") writeFileSync(file, `HASNA_SKILLS_API_KEY_REF=changed/skills/live/api_key\nHASNA_SKILLS_API_URL=${server.url.origin}\n`);
      return Response.json({ key: "fixture/skills/live/api_key", value: key() });
    }
    if (path === "/api/auth/whoami") {
      skillsRequests++;
      correctCredential &&= req.headers.get("authorization") === `Bearer ${key()}`;
      return Response.json({ user: { id: "fixture-user", email: "fixture@example.com", role: "owner" }, organization: { id: "fixture-org", slug: "fixture" } });
    }
    if (path === "/api/v1/capabilities" && req.method === "GET") {
      capabilityRequests++;
      correctCredential &&= req.headers.get("authorization") === `Bearer ${key()}`;
      return Response.json({ contractVersion: 1, apiVersion: 1, capabilities: ["skills.registry"],
        scopes: ["skills:read"], permissions: { publish: false, profilesWrite: false } });
    }
    registryRequests++;
    return new Response(null, { status: 404 });
  } });
  try {
    for (const current of ["ok", "rotate", "missing", "drift", "absent-sdk", "bootstrap-reference", "bootstrap-mixed"]) {
      mode = current; vaultRequests = 0; skillsRequests = 0; capabilityRequests = 0; correctCredential = true;
      writeFileSync(file, `HASNA_SKILLS_API_KEY_REF=fixture/skills/live/api_key\nHASNA_SKILLS_API_URL=${server.url.origin}\nHASNA_SKILLS_BOUND_API_URL=${server.url.origin}\n`, { mode: 0o600 });
      writeFileSync(join(home, ".hasna/secrets/config/credentials"), `HASNA_SECRETS_API_KEY=dummy-bootstrap-key\nHASNA_SECRETS_API_URL=${server.url.origin}\n`, { mode: 0o600 });
      if (current.startsWith("bootstrap-")) {
        const literal = current === "bootstrap-mixed" ? "HASNA_SECRETS_API_KEY=dummy-bootstrap-key\n" : "";
        writeFileSync(join(home, ".hasna/secrets/config/credentials"), `HASNA_SECRETS_API_KEY_REF=recursive/secrets/live/api_key\n${literal}HASNA_SECRETS_API_URL=${server.url.origin}\n`, { mode: 0o600 });
      }
      const child = Bun.spawn([process.execPath, "--no-env-file", current === "absent-sdk" ? isolated : cli, "auth", "whoami", "--json"], {
        cwd: home, env: { HOME: home, PATH: process.env.PATH, HASNA_SKILLS_API_KEY: "dummy-stale-key", HASNA_SECRETS_API_KEY: "dummy-bootstrap-key", BUN_CONFIG_REGISTRY: server.url.origin }, stdout: "pipe", stderr: "pipe",
      });
      const timer = setTimeout(() => child.kill(), 15000);
      let code: number, stdout: string, stderr: string;
      try { [code, stdout, stderr] = await Promise.all([child.exited, new Response(child.stdout).text(), new Response(child.stderr).text()]); }
      finally { clearTimeout(timer); }
      expect(correctCredential, current).toBe(true);
      for (const secret of [
        "dummy-bootstrap-key",
        "dummy-vault-key",
        "dummy-stale-key",
        "fixture/skills/live/api_key",
        "changed/skills/live/api_key",
        "recursive/secrets/live/api_key",
      ]) {
        expect(stdout).not.toContain(secret); expect(stderr).not.toContain(secret);
      }
      const result = JSON.parse(stdout);
      if (current === "ok" || current === "rotate") {
        expect(code, current).toBe(0); expect(result.status).toBe("authenticated"); expect(result.userId).toBe("fixture-user");
        expect(vaultRequests).toBe(1); expect(skillsRequests).toBe(1); expect(capabilityRequests).toBe(1);
        expect(result.permissions).toEqual({ publish: false, profilesWrite: false });
        expect(result.scopes).toEqual(["skills:read"]);
      } else {
        expect(code, current).not.toBe(0); expect(vaultRequests).toBe(current === "absent-sdk" || current.startsWith("bootstrap-") ? 0 : 1); expect(skillsRequests).toBe(0); expect(capabilityRequests).toBe(0);
      }
      expect(registryRequests, current).toBe(0);
      expect(existsSync(join(home, ".bun/install/cache")), current).toBe(false);
    }
  } finally { server.stop(true); rmSync(home, { recursive: true, force: true }); }
});
