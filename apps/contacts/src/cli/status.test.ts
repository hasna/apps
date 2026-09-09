import { afterEach, describe, expect, test } from "bun:test";
import { chmodSync, existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { spawnSync } from "node:child_process";
import { diskFixtureKey, envFixtureKey, runStatusFixture, statusFixtureCommand, statusFixtureEnv } from "./status-fixture";
import { join } from "node:path";

// `contacts status` is the drift-observability surface for the fleet bin-naming
// wave (hasna/apps#1602): it must report "unconfigured" ONLY when no API
// configuration exists, and must never crash at startup from a bundled
// package.json require. These tests run the real CLI entry (src/cli/index.tsx)
// in a child process, exactly as the published artifact would run it.

const tempHomes: string[] = [];
function testEnv(): Record<string, string> {
  const env = statusFixtureEnv();
  tempHomes.push(env.HOME!);
  return env;
}
const runStatus = runStatusFixture;
function stdoutText(result: ReturnType<typeof runStatus>): string { return result.stdout; }
function audit(env: Record<string, string>): Array<Record<string, unknown>> {
  const path = join(env.HOME!, "status-fixture.jsonl");
  return existsSync(path) ? readFileSync(path, "utf8").trim().split("\n").map(line => JSON.parse(line)) : [];
}
function expectRequests(env: Record<string, string>, status: number, repeats = 1) {
  const events = audit(env);
  const requests = events.filter(event => event.kind === "request");
  expect(requests).toHaveLength(2 * repeats);
  for (const path of ["/v1/contacts", "/v1/companies"]) {
    expect(requests.filter(event => event.path === path)).toEqual(Array.from({ length: repeats }, () => ({
      kind: "request", path, authenticated: true, status,
    })));
  }
  if (process.platform === "darwin") {
    expect(events.some(event => event.kind === "keychain" && event.service === "hasna.credentials.contacts.api-key" && event.status === 44)).toBe(true);
  }
  expect(JSON.stringify(events)).not.toContain(envFixtureKey);
  expect(JSON.stringify(events)).not.toContain(diskFixtureKey);
}

function parseStdout(result: ReturnType<typeof runStatus>): Record<string, unknown> {
  return JSON.parse(stdoutText(result)) as Record<string, unknown>;
}

afterEach(() => {
  for (const home of tempHomes.splice(0)) rmSync(home, { recursive: true, force: true });
});

describe("contacts status CLI", () => {
  test("fixture refuses unrecognized process and transport operations", () => {
    const env = testEnv();
    const result = runStatus(["--fixture-boundary-probe"], env, "failure");
    expect(result.exitCode).toBe(0);
    expect(parseStdout(result)).toEqual({ blocked: 17, attempted: 17, absentStatus: 44, platform: process.platform });
    expect(audit(env).filter(event => event.kind === "request")).toEqual([]);
    expect(runStatus(["list"], env).exitCode).not.toBe(0);
    expect(() => statusFixtureCommand(env.HOME!, ["/usr/bin/security", "help"])).toThrow("only launches");
  });

  test.skipIf(process.platform !== "darwin")("OS backstop denies host tools, sockets and outside writes without the preload", () => {
    const env = testEnv();
    const outside = testEnv().HOME!;
    const probe = join(env.HOME!, "os-probe.ts");
    writeFileSync(probe, `
      import { writeFileSync } from "node:fs";
      const inside = ${JSON.stringify(join(env.HOME!, "inside"))};
      const outside = ${JSON.stringify(join(outside, "forbidden"))};
      writeFileSync(inside, "owned fixture");
      let outsideDenied = false, networkDenied = false;
      try { writeFileSync(outside, "must not exist"); } catch (error) { outsideDenied = error.code === "EPERM"; }
      try { const server = Bun.listen({ hostname: "127.0.0.1", port: 0, socket: { data() {} } }); server.stop(); }
      catch (error) { networkDenied = /EPERM|EACCES/.test(error.code ?? "") || /EPERM|EACCES/.test(String(error)); }
      const denied = [];
      for (const tool of ["/usr/bin/security", "/usr/bin/defaults", "/usr/bin/open"]) {
        try { Bun.spawnSync({ cmd: [tool, "help"], stdout: "pipe", stderr: "pipe" });
          denied.push(false); } catch (error) { denied.push(/EPERM|EACCES/.test(String(error))); }
      }
      console.log(JSON.stringify({ outsideDenied, networkDenied, denied }));
    `);
    const command = statusFixtureCommand(env.HOME!, [process.execPath, probe]);
    const result = spawnSync(command[0]!, command.slice(1), {
      env, cwd: env.HOME, encoding: "utf8", timeout: 2500, killSignal: "SIGKILL", maxBuffer: 128 * 1024,
    });
    expect(result.error).toBeUndefined();
    expect(result.status).toBe(0);
    expect(result.signal).toBeNull();
    expect(JSON.parse(result.stdout)).toEqual({ outsideDenied: true, networkDenied: true, denied: [true, true, true] });
    expect(existsSync(join(env.HOME!, "inside"))).toBe(true);
    expect(existsSync(join(outside, "forbidden"))).toBe(false);
  });

  test("answers cleanly (never crashes) when the box is unconfigured", () => {
    const env = testEnv();
    const result = runStatus(["status", "--json"], env);
    expect(audit(env).filter(event => event.kind === "request")).toEqual([]);

    expect(result.exitCode).toBe(0);
    const report = parseStdout(result);
    expect(report).toMatchObject({
      service: "contacts",
      version: expect.any(String),
      storage: "unconfigured",
      api: expect.stringContaining("(not configured"),
      api_url_source: null,
      api_key_source: null,
      api_key_tier: null,
    });
    expect(report.counts).toBeUndefined();
    expect(report.error).toBeUndefined();

    // Success mode must not invent configuration by overwriting process.env.
    const unset = testEnv();
    const emptySuccess = runStatus(["status", "--json"], unset, "success");
    expect(emptySuccess.exitCode).toBe(0);
    expect(parseStdout(emptySuccess).storage).toBe("unconfigured");
    expect(audit(unset).filter(event => event.kind === "request")).toEqual([]);

    const text = runStatus(["status"], testEnv());
    expect(text.exitCode).toBe(0);
    expect(stdoutText(text)).toContain("Storage:  unconfigured");
  });

  test("reports a transport error, not unconfigured, when a configured request fails", () => {
    const env = testEnv();
    // The test boundary supplies HTTP 403; DNS and real transport retries are never involved.
    env.HASNA_CONTACTS_API_URL = "https://contacts.example.invalid";
    env.HASNA_CONTACTS_API_KEY = envFixtureKey;

    const result = runStatus(["status", "--json"], env, "failure");

    expect(result.exitCode).toBe(0);
    const report = parseStdout(result);
    expect(report).toMatchObject({
      service: "contacts",
      version: expect.any(String),
      storage: "error",
      // The RESOLVED /v1 base URL the client sends to, plus where each half
      // came from — names only, never a value.
      api: "https://contacts.example.invalid/v1",
      api_url_source: "HASNA_CONTACTS_API_URL",
      api_key_source: "HASNA_CONTACTS_API_KEY",
      api_key_tier: "env",
      error: expect.any(String),
    });
    expect(stdoutText(result)).toContain("-> 403.");
    expectRequests(env, 403);
    expect(report.storage).not.toBe("unconfigured");
    expect(report.counts).toBeUndefined();
    expect(stdoutText(result)).not.toContain(envFixtureKey);
    expect(result.stderr).not.toContain(envFixtureKey);
  });

  test("reports the resolved authority and the disk tier under HASNA_HOME by source, never by value", () => {
    const env = testEnv();
    env.HASNA_CONTACTS_API_URL = "https://contacts.example.invalid";
    const dir = join(env.HASNA_HOME!, "contacts", "config");
    mkdirSync(dir, { recursive: true });
    writeFileSync(join(dir, "credentials"), `HASNA_CONTACTS_API_KEY=${diskFixtureKey}\n`);
    chmodSync(join(dir, "credentials"), 0o600);

    const result = runStatus(["status", "--json"], env, "failure");
    expect(result.exitCode).toBe(0);
    const report = parseStdout(result);
    expect(report).toMatchObject({
      storage: "error",
      api: "https://contacts.example.invalid/v1",
      api_url_source: "HASNA_CONTACTS_API_URL",
      api_key_tier: "disk",
    });
    expect(stdoutText(result)).toContain("-> 403.");
    expectRequests(env, 403);
    expect(String(report.api_key_source)).toContain(join("contacts", "config", "credentials"));
    expect(stdoutText(result)).not.toContain(diskFixtureKey);
    expect(result.stderr).not.toContain(diskFixtureKey);

    const text = runStatus(["status"], env, "failure");
    expect(text.exitCode).toBe(0);
    expect(stdoutText(text)).toContain("API:      https://contacts.example.invalid/v1");
    expect(stdoutText(text)).toContain("API key source: ");
    expect(stdoutText(text)).toContain("(disk)");
    expect(stdoutText(text)).not.toContain(diskFixtureKey);
    expect(text.stderr).not.toContain(diskFixtureKey);
    expectRequests(env, 403, 2);
  });

  test("reports cloud storage and counts when the API responds", async () => {
    const env = testEnv();
    env.HASNA_CONTACTS_API_URL = "https://contacts.example.test";
    env.HASNA_CONTACTS_API_KEY = envFixtureKey;
    const result = runStatus(["status", "--json"], env, "success");
    expectRequests(env, 200);

    expect(result.exitCode).toBe(0);
    const report = parseStdout(result);
    expect(report).toMatchObject({
      service: "contacts",
      storage: "cloud (/v1)",
      api: "https://contacts.example.test/v1",
      api_url_source: "HASNA_CONTACTS_API_URL",
      api_key_source: "HASNA_CONTACTS_API_KEY",
      counts: { contacts: 2, companies: 1 },
    });
    expect(report.error).toBeUndefined();
    // The reported version comes from src/cli/index.tsx reading
    // apps/contacts/package.json (../../package.json at CLI depth) — the
    // bundle-safe depth the artifact ships with.
    const packageJson = (await Bun.file(join(import.meta.dir, "..", "..", "package.json")).json()) as { version: string };
    expect(report.version).toBe(packageJson.version);
  });
});
