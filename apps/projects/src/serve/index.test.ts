import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { resolveContactsAuthority } from "./index.js";

describe("projects-serve Contacts authority construction", () => {
  test("leaves the unrelated server surface available when no Contacts configuration exists", () => {
    // A caller-built env is hermetic in the shared seam: no Keychain, no disk.
    expect(resolveContactsAuthority({})).toBeUndefined();
  });

  test("a declared Contacts authority with no resolvable key fails closed", () => {
    expect(() => resolveContactsAuthority({
      HASNA_CONTACTS_API_URL: "https://contacts.example.test",
    })).toThrow("HASNA_CONTACTS_API_KEY");
  });

  test("a key with no URL reaches the default fleet gateway — URLs never need configuring", () => {
    const authority = resolveContactsAuthority({ HASNA_CONTACTS_API_KEY: "test-key" });
    expect(authority).toBeDefined();
    expect((authority as unknown as { baseUrl: string }).baseUrl).toBe("https://api.hasna.com/contacts/v1");
  });

  test("constructs the concrete production adapter when URL and API key are configured", () => {
    const authority = resolveContactsAuthority({
      HASNA_CONTACTS_API_URL: "https://contacts.example.test",
      HASNA_CONTACTS_API_KEY: "test-key",
      HASNA_CONTACTS_SERVICE_INSTANCE: "urn:hasna:contacts:production-test",
    });
    expect(authority).toBeDefined();
    expect(authority?.service_instance).toBe("urn:hasna:contacts:production-test");
  });
});

describe("projects-serve production store construction", () => {
  test("server startup uses the verifier-wired ProjectsPgStore factory", () => {
    const source = readFileSync(new URL("./index.ts", import.meta.url), "utf8");
    expect(source).toContain("const store = createProjectsPgStore(client);");
    expect(source).not.toContain("const store = new ProjectsPgStore(client);");
  });
});

import { join } from "node:path";

const SERVE_ENTRY = join(import.meta.dir, "index.ts");

/** Spawn projects-serve with every database-URL selector stripped, so a pass
 * cannot be vacuous: the process must answer --help/--version with NO database
 * URL configured. */
async function runServeWithoutDbUrl(...args: string[]): Promise<{
  stdout: string;
  stderr: string;
  code: number;
  timedOut: boolean;
}> {
  const env: Record<string, string | undefined> = { ...process.env };
  for (const key of [
    "HASNA_PROJECTS_DATABASE_URL",
    "PROJECTS_DATABASE_URL",
    "DATABASE_URL",
    "HASNA_PROJECTS_API_SIGNING_KEY",
    "HASNA_API_SIGNING_KEY",
    "API_KEY_SIGNING_SECRET",
  ]) {
    env[key] = undefined;
  }
  const proc = Bun.spawn(["bun", "run", SERVE_ENTRY, ...args], {
    stdout: "pipe",
    stderr: "pipe",
    env,
  });
  const stdoutPromise = new Response(proc.stdout).text();
  const stderrPromise = new Response(proc.stderr).text();
  const timedOut = await Promise.race([
    proc.exited.then(() => false),
    new Promise<boolean>((resolve) => {
      setTimeout(() => {
        proc.kill();
        resolve(true);
      }, 10_000);
    }),
  ]);
  const [stdout, stderr] = await Promise.all([stdoutPromise, stderrPromise]);
  return { stdout, stderr, code: proc.exitCode ?? -1, timedOut };
}

describe("projects-serve early arguments (binds-before-args class, O15-00084)", () => {
  test("--help answers with usage on stdout, rc=0, with no database URL configured", async () => {
    const result = await runServeWithoutDbUrl("--help");
    expect(result.timedOut).toBe(false);
    expect(result.code).toBe(0);
    expect(result.stdout).toContain("projects-serve");
    expect(result.stdout.toLowerCase()).toContain("usage");
    expect(result.stderr).not.toContain("no database URL");
  });

  test("--version answers with the package version on stdout, rc=0, with no database URL configured", async () => {
    const result = await runServeWithoutDbUrl("--version");
    expect(result.timedOut).toBe(false);
    expect(result.code).toBe(0);
    expect(result.stdout).toMatch(/\d+\.\d+\.\d+/);
    expect(result.stderr).not.toContain("no database URL");
  });

  test("handleEarlyArgs classifies help, version, and start", () => {
    const { handleEarlyArgs } = require("./index.js") as {
      handleEarlyArgs: (argv: string[]) => "help" | "version" | "start";
    };
    expect(handleEarlyArgs(["--help"])).toBe("help");
    expect(handleEarlyArgs(["--version"])).toBe("version");
    expect(handleEarlyArgs([])).toBe("start");
    expect(handleEarlyArgs(["migrate", "--dry-run"])).toBe("start");
    expect(handleEarlyArgs(["--port", "3000"])).toBe("start");
  });
});
