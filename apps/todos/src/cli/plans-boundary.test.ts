import { test, expect, setDefaultTimeout } from "bun:test";
// Spawns child processes (CLI/server/scripts); bun's 5s default is too tight on a loaded host.
setDefaultTimeout(60_000);

import { mkdtempSync, readdirSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { randomUUID } from "node:crypto";
test("plans help is credential-free and real actions reject local selectors without disclosure or SQLite", async () => {
  const root = mkdtempSync(join(tmpdir(), "plans-boundary-"));
  const base = {
    PATH: process.env.PATH ?? "",
    HOME: root,
    USERPROFILE: root,
    HASNA_STATION: randomUUID(),
    TMPDIR: root,
    NO_COLOR: "1",
  };
  const run = async (args: string[], env = base) => {
    const p = Bun.spawn(
      [process.execPath, "--no-env-file", "src/cli/index.tsx", ...args],
      {
        cwd: join(import.meta.dir, "../.."),
        env,
        stdout: "pipe",
        stderr: "pipe",
      },
    );
    const [stdout, stderr, code] = await Promise.all([
      new Response(p.stdout).text(),
      new Response(p.stderr).text(),
      p.exited,
    ]);
    return { stdout, stderr, code };
  };
  try {
    expect((await run(["plans", "--help"])).code).toBe(0);
    const missing = await run(["plans"]);
    expect(missing.code).not.toBe(0);
    expect(missing.stderr).toContain("HASNA_TODOS_API_KEY");
    expect(missing.stderr).not.toContain("LOCAL=1");
    for (const key of [
      "HASNA_TODOS_DB_PATH",
      "TODOS_DB_PATH",
      "HASNA_TODOS_LOCAL",
      "TODOS_LOCAL",
    ]) {
      const rejected = await run(["plans"], {
        ...base,
        [key]: join(root, "private.db"),
      });
      expect(rejected.code).not.toBe(0);
      expect(rejected.stderr).toContain(key);
      expect(rejected.stderr).not.toContain(root);
    }
    expect(
      readdirSync(root, { recursive: true })
        .map(String)
        .filter((p) => p.endsWith(".db")),
    ).toEqual([]);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
}, 20000);
