import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import { describe, expect, test } from "bun:test";
import { Store } from "../lib/store.js";

const cliPath = join(dirname(fileURLToPath(import.meta.url)), "index.ts");

function runCli(dataDir: string, args: string[]) {
  return spawnSync(process.execPath, [cliPath, ...args], {
    env: {
      ...process.env,
      HASNA_LOOPS_API_URL: "",
      HASNA_LOOPS_API_KEY: "",
      // Local file store requires the explicit opt-in (fail-closed policy).
      HASNA_LOOPS_CONNECTION: "file",
      LOOPS_DATA_DIR: dataDir,
    },
    encoding: "utf8",
  });
}

describe("loops CLI archive ambiguity", () => {
  test("archive and unarchive fail closed by name while ids stay exact", () => {
    const dataDir = mkdtempSync(join(tmpdir(), "loops-cli-archive-ambiguity-"));
    try {
      const store = new Store(join(dataDir, "loops.db"));
      const input = {
        name: "cli-archive-dupe",
        schedule: { type: "once", at: "2026-01-01T00:00:00Z" } as const,
        target: { type: "command", command: "true" } as const,
      };
      const first = store.createLoop(input, new Date("2025-12-31T00:00:00Z"));
      const second = store.createLoop(input, new Date("2025-12-31T00:00:01Z"));
      store.close();

      const ambiguousArchive = runCli(dataDir, ["archive", input.name]);
      expect(ambiguousArchive.status).not.toBe(0);
      expect(ambiguousArchive.stderr).toContain("ambiguous loop name");
      const afterAmbiguousArchive = new Store(join(dataDir, "loops.db"));
      expect(afterAmbiguousArchive.getLoop(first.id)?.archivedAt).toBeUndefined();
      expect(afterAmbiguousArchive.getLoop(second.id)?.archivedAt).toBeUndefined();
      afterAmbiguousArchive.close();

      expect(runCli(dataDir, ["archive", first.id]).status).toBe(0);
      expect(runCli(dataDir, ["archive", input.name]).status).toBe(0);

      const ambiguousUnarchive = runCli(dataDir, ["unarchive", input.name]);
      expect(ambiguousUnarchive.status).not.toBe(0);
      expect(ambiguousUnarchive.stderr).toContain("ambiguous loop name");
      const afterAmbiguousUnarchive = new Store(join(dataDir, "loops.db"));
      expect(afterAmbiguousUnarchive.getLoop(first.id)?.archivedAt).toBeString();
      expect(afterAmbiguousUnarchive.getLoop(second.id)?.archivedAt).toBeString();
      afterAmbiguousUnarchive.close();

      expect(runCli(dataDir, ["unarchive", first.id]).status).toBe(0);
      const afterExactUnarchive = new Store(join(dataDir, "loops.db"));
      expect(afterExactUnarchive.getLoop(first.id)?.archivedAt).toBeUndefined();
      expect(afterExactUnarchive.getLoop(second.id)?.archivedAt).toBeString();
      afterExactUnarchive.close();

      expect(runCli(dataDir, ["unarchive", input.name]).status).toBe(0);
      const afterMixedStateUnarchive = new Store(join(dataDir, "loops.db"));
      expect(afterMixedStateUnarchive.getLoop(first.id)?.archivedAt).toBeUndefined();
      expect(afterMixedStateUnarchive.getLoop(second.id)?.archivedAt).toBeUndefined();
      afterMixedStateUnarchive.close();
    } finally {
      rmSync(dataDir, { recursive: true, force: true });
    }
  });
});
