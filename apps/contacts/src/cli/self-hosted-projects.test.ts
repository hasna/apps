import { describe, expect, test } from "bun:test";

async function runContacts(args: string[], overrides: Record<string, string>) {
  const env = { ...process.env, ...overrides } as Record<string, string>;
  for (const key of [
    "HASNA_CONTACTS_STORAGE_MODE",
    "CONTACTS_STORAGE_MODE",
    "HASNA_CONTACTS_DB_PATH",
    "CONTACTS_DB_PATH",
    "HASNA_CONTACTS_DATABASE_URL",
    "CONTACTS_DATABASE_URL",
  ]) delete env[key];
  Object.assign(env, overrides);
  const child = Bun.spawn([process.execPath, "run", "src/cli/index.tsx", ...args], {
    cwd: import.meta.dir + "/../..",
    env,
    stdout: "pipe",
    stderr: "pipe",
  });
  const [exitCode, stdout, stderr] = await Promise.all([
    child.exited,
    new Response(child.stdout).text(),
    new Response(child.stderr).text(),
  ]);
  return { exitCode, stdout, stderr };
}

describe("contacts project client transport", () => {
  test("refuses plaintext loopback instead of falling back to local state", async () => {
    const result = await runContacts(["projects", "list", "contact-1", "--json"], {
      HASNA_CONTACTS_API_URL: "http://127.0.0.1:54321",
      HASNA_CONTACTS_API_KEY: "test-key",
    });
    expect(result.exitCode).not.toBe(0);
    expect(result.stderr).toContain("CONTACTS_API_HTTPS_REQUIRED");
    expect(result.stdout).toBe("");
  });
});
