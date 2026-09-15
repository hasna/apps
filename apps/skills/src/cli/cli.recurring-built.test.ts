import { expect, test } from "bun:test";
import { existsSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { capturePreparationProcess } from "../lib/preparation-process.js";
import { createRecurringProtocolFixture, recurringFixtureRequest } from "../lib/recurring-surface.fixture.js";
import { useDefaultTestTimeout } from "../test-preload.js";
useDefaultTestTimeout();

/** Actual compiled CLI, pipes and loopback HTTP. The server is a protocol
 * fixture; this does not claim real OTP delivery, database authority or payment. */
test("compiled recurring CLI preserves its profile through approval, history and revocation over HTTP", async () => {
  const cli = new URL("../../bin/index.js", import.meta.url).pathname;
  expect(existsSync(cli), "Build the package before testing its compiled CLI").toBe(true);
  let fixture: ReturnType<typeof createRecurringProtocolFixture> | undefined;
  let cleanupSafe = true;
  const server = Bun.serve({ hostname: "127.0.0.1", port: 0, async fetch(request) {
    if (!fixture) return new Response(null, { status: 503 });
    const authorization = request.headers.get("authorization");
    if (!["Bearer inert-selected-key", "Bearer inert-session"].includes(authorization ?? "")
      && !["/auth/login", "/auth/verify"].some(path => new URL(request.url).pathname.endsWith(path))) return new Response(null, { status: 401 });
    if (new URL(request.url).pathname.endsWith("/activate") && authorization !== "Bearer inert-session")
      return new Response(null, { status: 403 });
    return fixture.fetch(request.url, { method: request.method, headers: request.headers,
      body: request.method === "GET" ? undefined : await request.text(), redirect: "error" });
  } });
  fixture = createRecurringProtocolFixture(`${server.url.origin}/prefix`);
  const f = fixture, originalFiles = f.snapshot();
  const invoke = async (args: string[], code = "123456\n") => {
    const env = Object.fromEntries(Object.entries(f.env).filter((row): row is [string, string] => row[1] !== undefined));
    const child = Bun.spawn([process.execPath, "--no-env-file", cli, "recurring", ...args,
      "--user-id", f.context.userId, "--membership-id", f.context.membershipId, "--json"], {
      cwd: f.root, env: { ...env, PATH: process.env.PATH ?? "/usr/bin:/bin", NO_COLOR: "1", BUN_RUNTIME_TRANSPILER_CACHE_PATH: "0" },
      stdin: new Blob([code]), stdout: "pipe", stderr: "pipe", detached: process.platform !== "win32",
    });
    const owned = capturePreparationProcess(child);
    cleanupSafe = false;
    let timedOut = false;
    const timeout = setTimeout(() => { timedOut = true; owned.kill(); }, 15_000);
    try {
      const [stdout, stderr, exitCode] = await Promise.all([
        new Response(child.stdout).text(), new Response(child.stderr).text(), child.exited,
      ]);
      expect(timedOut).toBe(false);
      for (const secret of ["inert-selected-key", "inert-session", "123456"])
        expect(stdout + stderr).not.toContain(secret);
      return { stdout, stderr, exitCode };
    } finally {
      clearTimeout(timeout);
      owned.kill();
      const deadline = performance.now() + 1_500;
      while (process.platform !== "win32" && owned.groupExited() !== true && performance.now() < deadline) await Bun.sleep(10);
      cleanupSafe = process.platform === "win32" ? child.exitCode !== null : owned.groupExited() === true;
      if (!cleanupSafe) throw new Error("Compiled recurring CLI process cleanup is uncertain; preserve its fixture directory");
    }
  };
  const success = async (args: string[]) => {
    const result = await invoke(args);
    expect(result.exitCode, result.stderr).toBe(0);
    return JSON.parse(result.stdout);
  };
  try {
    const request = join(f.root, "request.json");
    writeFileSync(request, JSON.stringify(recurringFixtureRequest()), { mode: 0o600 });
    expect((await success(["preview", "--request", request])).draftId).toBe(f.draftId);
    expect(await success(["draft", f.draftId])).toEqual(f.preview());
    expect(await success(["verification", f.draftId, "--email", "owner@example.test", "--confirm"]))
      .toMatchObject({ verificationRequested: true, activated: false });
    const directory = join(f.root, "compiled-activation");
    const activated = await success(["activate", f.draftId, "--accepted-terms", f.approval.acceptedTermsSha256,
      "--idempotency-key", f.approval.idempotencyKey, "--acceptance", f.approval.acceptance, "--confirm",
      "--recovery-dir", directory, "--email", "owner@example.test", "--code-stdin"]);
    const consentId = activated.result.consent.consentId;
    expect((await success(["list", "--limit", "1"])).items.map((row: { consentId: string }) => row.consentId)).toEqual([consentId]);
    expect((await success(["get", consentId])).consentId).toBe(consentId);
    expect((await success(["occurrences", consentId])).items).toEqual([]);
    expect((await success(["recover", "--recovery-dir", directory])).phase).toBe("observed");
    expect((await success(["revoke", consentId, "--confirm", "--recovery-dir", join(f.root, "compiled-revoke")])).result)
      .toMatchObject({ consentId, cancellationIsSeparate: true, inFlightPolicy: "finish-authorized-attempt" });
    const beforeRefusal = f.calls.length;
    expect((await invoke(["list", "--limit", "101"])).exitCode).not.toBe(0);
    expect(f.calls).toHaveLength(beforeRefusal);
    expect(f.calls.filter(call => call.path.endsWith("/activate"))).toHaveLength(1);
    expect(f.snapshot()).toEqual(originalFiles);
  } finally {
    server.stop(true);
    if (cleanupSafe) f.cleanup();
  }
});
