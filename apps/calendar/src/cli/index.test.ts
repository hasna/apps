import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { describe, expect, test } from "bun:test";

async function runCalendar(args: string[], dbPath: string) {
  const proc = Bun.spawn({
    cmd: ["bun", "run", "src/cli/index.tsx", ...args],
    cwd: process.cwd(),
    env: {
      ...process.env,
      BUN_TEST: "",
      CALENDAR_DB_PATH: dbPath,
      HASNA_EVENTS_DIR: join(dirname(dbPath), "events"),
      FORCE_COLOR: "0",
      NO_COLOR: "1",
    },
    stdout: "pipe",
    stderr: "pipe",
  });

  const [stdout, stderr, exitCode] = await Promise.all([
    new Response(proc.stdout).text(),
    new Response(proc.stderr).text(),
    proc.exited,
  ]);

  return { stdout, stderr, exitCode };
}

describe("calendar CLI", () => {
  test("root --version matches package.json", async () => {
    const tempDir = await mkdtemp(join(tmpdir(), "calendar-cli-"));
    try {
      const packageJson = await Bun.file(new URL("../../package.json", import.meta.url)).json() as { version: string };
      const result = await runCalendar(["--version"], join(tempDir, "calendar.db"));

      expect(result.exitCode).toBe(0);
      expect(result.stderr).toBe("");
      expect(result.stdout.trim()).toBe(packageJson.version);
    } finally {
      await rm(tempDir, { recursive: true, force: true });
    }
  });

  test("global --json emits parseable JSON output", async () => {
    const tempDir = await mkdtemp(join(tmpdir(), "calendar-cli-"));
    try {
      const result = await runCalendar(["--json", "org-add", "JSON Org"], join(tempDir, "calendar.db"));

      expect(result.exitCode).toBe(0);
      expect(result.stderr).toBe("");
      expect(JSON.parse(result.stdout)).toMatchObject({
        name: "JSON Org",
        slug: "json-org",
      });
    } finally {
      await rm(tempDir, { recursive: true, force: true });
    }
  });

  test("global --json applies to delete commands", async () => {
    const tempDir = await mkdtemp(join(tmpdir(), "calendar-cli-"));
    const dbPath = join(tempDir, "calendar.db");
    try {
      const created = await runCalendar(["--json", "org-add", "Delete JSON Org"], dbPath);
      const org = JSON.parse(created.stdout);

      const deleted = await runCalendar(["--json", "org-delete", org.id], dbPath);

      expect(deleted.exitCode).toBe(0);
      expect(deleted.stderr).toBe("");
      expect(JSON.parse(deleted.stdout)).toEqual({ deleted: true });
    } finally {
      await rm(tempDir, { recursive: true, force: true });
    }
  });

  test("global --json applies to status commands without local JSON branches", async () => {
    const tempDir = await mkdtemp(join(tmpdir(), "calendar-cli-"));
    const dbPath = join(tempDir, "calendar.db");
    try {
      await runCalendar(["--json", "init", "json-agent"], dbPath);

      const heartbeat = await runCalendar(["--json", "heartbeat", "json-agent"], dbPath);

      expect(heartbeat.exitCode).toBe(0);
      expect(heartbeat.stderr).toBe("");
      expect(JSON.parse(heartbeat.stdout)).toMatchObject({ name: "json-agent" });
    } finally {
      await rm(tempDir, { recursive: true, force: true });
    }
  });

  test("global --json serializes thrown command errors", async () => {
    const tempDir = await mkdtemp(join(tmpdir(), "calendar-cli-"));
    try {
      const result = await runCalendar(["--json", "org-update", "missing", "--name", "Updated"], join(tempDir, "calendar.db"));

      expect(result.exitCode).toBe(1);
      expect(result.stderr).toBe("");
      expect(JSON.parse(result.stdout)).toEqual({ error: "Org not found: missing" });
    } finally {
      await rm(tempDir, { recursive: true, force: true });
    }
  });

  test("root --json does not shadow command-local --org options", async () => {
    const tempDir = await mkdtemp(join(tmpdir(), "calendar-cli-"));
    const dbPath = join(tempDir, "calendar.db");
    try {
      const createdOrg = await runCalendar(["--json", "org-add", "Calendar Org"], dbPath);
      const org = JSON.parse(createdOrg.stdout);

      const createdCalendar = await runCalendar(["--json", "cal-add", "Team Calendar", "--org", org.id], dbPath);

      expect(createdCalendar.exitCode).toBe(0);
      expect(createdCalendar.stderr).toBe("");
      expect(JSON.parse(createdCalendar.stdout)).toMatchObject({
        name: "Team Calendar",
        org_id: org.id,
      });
    } finally {
      await rm(tempDir, { recursive: true, force: true });
    }
  });

  test("command-local --json remains available after subcommands", async () => {
    const tempDir = await mkdtemp(join(tmpdir(), "calendar-cli-"));
    try {
      const result = await runCalendar(["org-add", "Local JSON Org", "--json"], join(tempDir, "calendar.db"));

      expect(result.exitCode).toBe(0);
      expect(result.stderr).toBe("");
      expect(JSON.parse(result.stdout)).toMatchObject({
        name: "Local JSON Org",
        slug: "local-json-org",
      });
    } finally {
      await rm(tempDir, { recursive: true, force: true });
    }
  });

  test("delegated -j command errors stay parseable as JSON", async () => {
    const tempDir = await mkdtemp(join(tmpdir(), "calendar-cli-"));
    try {
      const result = await runCalendar(["events", "emit", "calendar.probe", "--data", "{", "-j"], join(tempDir, "calendar.db"));

      expect(result.exitCode).toBe(1);
      expect(result.stderr).toBe("");
      expect(JSON.parse(result.stdout)).toEqual({ error: "JSON Parse error: Expected '}'" });
    } finally {
      await rm(tempDir, { recursive: true, force: true });
    }
  });
});
