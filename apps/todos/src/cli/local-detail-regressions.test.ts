import { afterEach, describe, expect, test } from "bun:test";
import { Database } from "bun:sqlite";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { localRoutingTestEnv } from "../test/local-routing-env.fixture.test.js";

const REPO_ROOT = join(import.meta.dir, "../..");
const roots: string[] = [];

afterEach(() => {
  for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true });
});

function fixture() {
  const root = mkdtempSync(join(tmpdir(), "todos-local-detail-regressions-"));
  roots.push(root);
  return {
    root,
    home: join(root, "home"),
    db: join(root, "todos.db"),
    alternateDb: join(root, "alternate.db"),
  };
}

async function runCli(args: string[], home: string, db: string) {
  const proc = Bun.spawn(["bun", "run", "src/cli/index.tsx", ...args], {
    cwd: REPO_ROOT,
    env: localRoutingTestEnv({
      HOME: home,
      TMPDIR: home,
      HASNA_TODOS_DB_PATH: db,
      TODOS_DB_PATH: db,
      TODOS_AUTO_PROJECT: "false",
    }),
    stdout: "pipe",
    stderr: "pipe",
  });
  const stdoutPromise = new Response(proc.stdout).text();
  const stderrPromise = new Response(proc.stderr).text();
  const [exitCode, stdout, stderr] = await Promise.all([proc.exited, stdoutPromise, stderrPromise]);
  return { exitCode, stdout, stderr };
}

describe("local CLI detail regressions retained under Stage A", () => {
  test.each(["show", "inspect"] as const)(
    "%s leaves the complete persisted legacy task row byte-for-byte unchanged",
    async (command) => {
      const { home, db } = fixture();
      const created = await runCli(["--json", "add", `Non-mutating ${command}`], home, db);
      expect(created.exitCode).toBe(0);
      const task = JSON.parse(created.stdout) as { id: string };

      const prepare = new Database(db);
      let before: Record<string, unknown>;
      try {
        prepare.run(
          `UPDATE tasks
              SET machine_id = NULL,
                  description = ?,
                  metadata = ?,
                  updated_at = ?
            WHERE id = ?`,
          [
            `FAKE_ONLY_${command.toUpperCase()}_LEGACY_DESCRIPTION`,
            JSON.stringify({ fixture: `FAKE_ONLY_${command.toUpperCase()}_LEGACY_METADATA` }),
            "2026-07-18T00:00:00.000Z",
            task.id,
          ],
        );
        before = prepare.query("SELECT * FROM tasks WHERE id = ?").get(task.id) as Record<string, unknown>;
        expect(before.machine_id).toBeNull();
      } finally {
        prepare.close();
      }

      const detail = await runCli(["--json", command, task.id], home, db);
      expect(detail.exitCode).toBe(0);

      const verify = new Database(db, { readonly: true });
      try {
        const after = verify.query("SELECT * FROM tasks WHERE id = ?").get(task.id) as Record<string, unknown>;
        expect(after).toEqual(before!);
      } finally {
        verify.close();
      }
    },
  );

  test("show and inspect redact raw legacy comments at read time without rewriting history", async () => {
    const { home, db } = fixture();
    const created = await runCli(["--json", "add", "Detail regression"], home, db);
    expect(created.exitCode).toBe(0);
    const task = JSON.parse(created.stdout) as { id: string };
    const rawContents = [
      "first persisted comment",
      "Bearer abcdefghijklmnop should redact; password=legacy-password-value; Authorization: Basic bGVnYWN5LXVzZXI6bGVnYWN5LXBhc3M=",
      "visible\u001b]52;c;forged\u0007next\nline",
    ];
    const database = new Database(db);
    try {
      const insert = database.prepare(
        `INSERT INTO task_comments
          (id, task_id, agent_id, content, type, created_at)
         VALUES (?, ?, ?, ?, 'comment', ?)`,
      );
      rawContents.forEach((content, index) => insert.run(
        `legacy-raw-${index}`,
        task.id,
        index === 2 ? "agent\u001b[31m" : null,
        content,
        `2026-07-18T00:00:0${index}.000Z`,
      ));
      expect(database.query("SELECT content FROM task_comments ORDER BY rowid").all())
        .toEqual(rawContents.map((content) => ({ content })));
    } finally {
      database.close();
    }

    for (const command of ["show", "inspect"] as const) {
      const json = await runCli(["--json", command, task.id], home, db);
      expect(json.exitCode).toBe(0);
      const detail = JSON.parse(json.stdout) as { comments: Array<{ content: string }> };
      expect(detail.comments.map((comment) => comment.content)).toEqual([
        "first persisted comment",
        expect.stringContaining("[REDACTED]"),
        "visible\u001b]52;c;forged\u0007next\nline",
      ]);
      expect(JSON.stringify(detail)).not.toContain("abcdefghijklmnop");
      expect(JSON.stringify(detail)).not.toContain("legacy-password-value");
      expect(JSON.stringify(detail)).not.toContain("bGVnYWN5LXVzZXI6bGVnYWN5LXBhc3M=");
    }

    for (const command of ["show", "inspect"] as const) {
      const human = await runCli([command, task.id], home, db);
      expect(human.exitCode).toBe(0);
      expect(human.stdout).not.toContain("abcdefghijklmnop");
      expect(human.stdout).not.toContain("legacy-password-value");
      expect(human.stdout).not.toContain("bGVnYWN5LXVzZXI6bGVnYWN5LXBhc3M=");
      expect(human.stdout).not.toContain("\u001b]52");
      expect(human.stdout).not.toContain("\u0007");
      expect(human.stdout).toContain("\\x1b]52");
      expect(human.stdout).toContain("\\x07next\\nline");
      expect(human.stdout.indexOf("first persisted comment")).toBeLessThan(human.stdout.indexOf("[REDACTED]"));
    }

    const verify = new Database(db, { readonly: true });
    try {
      expect(verify.query("SELECT content FROM task_comments ORDER BY rowid").all())
        .toEqual(rawContents.map((content) => ({ content })));
    } finally {
      verify.close();
    }
  });

  test("a printed short ID is not reused against a different local database", async () => {
    const { home, db, alternateDb } = fixture();
    const created = await runCli(["--json", "add", "Original database task"], home, db);
    expect(created.exitCode).toBe(0);
    const task = JSON.parse(created.stdout) as { id: string; short_id?: string | null };
    const shortId = task.short_id || task.id.slice(0, 8);

    const alternate = await runCli(["--json", "add", "Alternate database task"], home, alternateDb);
    expect(alternate.exitCode).toBe(0);
    const shown = await runCli(["--json", "show", shortId], home, alternateDb);
    expect(shown.exitCode).not.toBe(0);
    expect(`${shown.stdout}\n${shown.stderr}`).toContain("Could not resolve task ID");
  }, 20_000);

  test("equal-time local detail comments use insertion order before the 100-row display bound", async () => {
    const { home, db } = fixture();
    const created = await runCli(["--json", "add", "Bounded comments"], home, db);
    const task = JSON.parse(created.stdout) as { id: string };
    const database = new Database(db);
    try {
      const insert = database.prepare(
        "INSERT INTO task_comments (id, task_id, content, type, created_at) VALUES (?, ?, ?, 'comment', ?)",
      );
      database.transaction(() => {
        for (let index = 0; index < 105; index += 1) {
          insert.run(
            `legacy-${String(index).padStart(3, "0")}`,
            task.id,
            `legacy ${index}`,
            "2026-07-18T00:00:00.000Z",
          );
        }
      })();
    } finally {
      database.close();
    }
    const json = await runCli(["--json", "show", task.id], home, db);
    expect(json.exitCode).toBe(0);
    const detail = JSON.parse(json.stdout) as {
      comments: Array<{ id: string; content: string }>;
      comments_page: Record<string, unknown>;
    };
    expect(detail.comments.map(({ id }) => id)).toEqual(
      Array.from({ length: 100 }, (_, index) => `legacy-${String(index + 5).padStart(3, "0")}`),
    );
    expect(detail.comments_page).toEqual({
      count: 100,
      limit: 100,
      has_more: true,
      next_cursor: null,
      pagination_supported: false,
      source: "local",
    });

    const shown = await runCli(["show", task.id], home, db);
    expect(shown.exitCode).toBe(0);
    expect(shown.stdout).toContain("Comments (100, newer comments shown; older comments omitted");
    expect(shown.stdout).not.toContain("legacy 0\n");
    expect(shown.stdout.indexOf("legacy 5\n")).toBeLessThan(shown.stdout.indexOf("legacy 104\n"));
    expect(shown.stdout).toContain("legacy 104");
  });
});
