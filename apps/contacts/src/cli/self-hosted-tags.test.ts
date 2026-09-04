import { describe, expect, test } from "bun:test";

describe("contacts retired storage selector", () => {
  test("rejects self_hosted mode before any tag request", async () => {
    const env = { ...process.env } as Record<string, string>;
    for (const key of [
      "HASNA_CONTACTS_API_URL",
      "CONTACTS_API_URL",
      "HASNA_CONTACTS_API_KEY",
      "CONTACTS_API_KEY",
      "HASNA_CONTACTS_STORAGE_MODE",
      "CONTACTS_STORAGE_MODE",
      "HASNA_CONTACTS_DB_PATH",
      "CONTACTS_DB_PATH",
      "HASNA_CONTACTS_DATABASE_URL",
      "CONTACTS_DATABASE_URL",
    ]) delete env[key];
    env.HASNA_CONTACTS_STORAGE_MODE = "self_hosted";

    const child = Bun.spawn([
      process.execPath,
      "run",
      "src/cli/index.tsx",
      "tags",
      "bulk",
      "add",
      "monthly-accounting",
      "--contact-ids",
      "contact-1",
    ], {
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

    expect(exitCode).not.toBe(0);
    expect(stderr).toContain("RETIRED_CONTACTS_CLIENT_SELECTOR");
    expect(stdout).toBe("");
  });
});
