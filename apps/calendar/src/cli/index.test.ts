import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { describe, expect, test } from "bun:test";
import { createCalendar } from "../db/calendars.js";
import { createEvent } from "../db/events.js";
import { closeDatabase, getDatabase } from "../db/database.js";
import { createOrg } from "../db/orgs.js";

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

async function seedCalendar(dbPath: string, eventCount = 22) {
  const db = getDatabase(dbPath);
  const org = createOrg({ name: "Output Org" }, db);
  const calendar = createCalendar({ name: "Output Calendar", org_id: org.id }, db);
  const longDescription = "Long planning details ".repeat(40);

  for (let i = 0; i < eventCount; i += 1) {
    const startAt = new Date(Date.UTC(2026, 3, 1 + i, 9, 0, 0)).toISOString().replace(".000Z", "Z");
    const endAt = new Date(Date.UTC(2026, 3, 1 + i, 10, 0, 0)).toISOString().replace(".000Z", "Z");
    createEvent({
      title: `Planning Event ${String(i + 1).padStart(3, "0")}`,
      calendar_id: calendar.id,
      org_id: org.id,
      start_at: startAt,
      end_at: endAt,
      description: longDescription,
      location: `Room ${i + 1}`,
    }, db);
  }
  closeDatabase();

  return { org, calendar, longDescription };
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

  test("event list is compact and paged by default", async () => {
    const tempDir = await mkdtemp(join(tmpdir(), "calendar-cli-"));
    const dbPath = join(tempDir, "calendar.db");
    try {
      const { calendar, longDescription } = await seedCalendar(dbPath);
      const result = await runCalendar(["list", "--calendar", calendar.id], dbPath);

      expect(result.exitCode).toBe(0);
      expect(result.stderr).toBe("");
      expect(result.stdout).toContain("Showing 1-20 of 22.");
      expect(result.stdout).toContain("Next page: rerun with --cursor 20.");
      expect(result.stdout).toContain("Use --verbose or calendar show <id> for details.");
      expect(result.stdout).not.toContain(longDescription.slice(0, 120));
      expect(result.stdout.split("\n").filter((line) => line.includes("Planning Event"))).toHaveLength(20);
    } finally {
      await rm(tempDir, { recursive: true, force: true });
    }
  });

  test("event list verbose reveals truncated detail fields", async () => {
    const tempDir = await mkdtemp(join(tmpdir(), "calendar-cli-"));
    const dbPath = join(tempDir, "calendar.db");
    try {
      const { calendar, longDescription } = await seedCalendar(dbPath, 1);
      const result = await runCalendar(["list", "--calendar", calendar.id, "--limit", "1", "--verbose"], dbPath);

      expect(result.exitCode).toBe(0);
      expect(result.stderr).toBe("");
      expect(result.stdout).toContain("location=Room 1");
      expect(result.stdout).toContain("desc=Long planning details");
      expect(result.stdout).toContain("...");
      expect(result.stdout).not.toContain(longDescription);
    } finally {
      await rm(tempDir, { recursive: true, force: true });
    }
  });

  test("event list JSON remains a full record array unless paging is requested", async () => {
    const tempDir = await mkdtemp(join(tmpdir(), "calendar-cli-"));
    const dbPath = join(tempDir, "calendar.db");
    try {
      const { calendar, longDescription } = await seedCalendar(dbPath, 105);
      const result = await runCalendar(["list", "--calendar", calendar.id, "--json"], dbPath);

      expect(result.exitCode).toBe(0);
      expect(result.stderr).toBe("");
      const events = JSON.parse(result.stdout) as Array<{ description: string }>;
      expect(events).toHaveLength(105);
      expect(events[0]!.description).toBe(longDescription);
    } finally {
      await rm(tempDir, { recursive: true, force: true });
    }
  });

  test("event list JSON with paging returns pagination metadata", async () => {
    const tempDir = await mkdtemp(join(tmpdir(), "calendar-cli-"));
    const dbPath = join(tempDir, "calendar.db");
    try {
      const { calendar } = await seedCalendar(dbPath, 22);
      const result = await runCalendar(["list", "--calendar", calendar.id, "--json", "--limit", "5", "--cursor", "10"], dbPath);

      expect(result.exitCode).toBe(0);
      expect(result.stderr).toBe("");
      const page = JSON.parse(result.stdout) as { items: unknown[]; total: number; limit: number; cursor: number; next_cursor: number };
      expect(page.items).toHaveLength(5);
      expect(page.total).toBe(22);
      expect(page.limit).toBe(5);
      expect(page.cursor).toBe(10);
      expect(page.next_cursor).toBe(15);
    } finally {
      await rm(tempDir, { recursive: true, force: true });
    }
  });

  test("list pagination options require strict integers", async () => {
    const tempDir = await mkdtemp(join(tmpdir(), "calendar-cli-"));
    try {
      const result = await runCalendar(["list", "--limit", "2x"], join(tempDir, "calendar.db"));

      expect(result.exitCode).toBe(1);
      expect(result.stdout).toContain('Expected an integer, got "2x"');
    } finally {
      await rm(tempDir, { recursive: true, force: true });
    }
  });
});
