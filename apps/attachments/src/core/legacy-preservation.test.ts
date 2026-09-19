import { test, expect } from "bun:test";
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, existsSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

test("client import and failed resolution never discover or copy legacy datasets", async () => {
  const temporary = mkdtempSync(join(tmpdir(), "attachments-preservation-"));
  try {
    for (const name of [".hasna/attachments", ".attachments", ".open-attachments"]) {
      const legacy = join(temporary, name);
      mkdirSync(legacy, { recursive: true });
      writeFileSync(join(legacy, "attachments.db"), "legacy sentinel");
    }
    const child = Bun.spawnSync([process.execPath, "-e", `
      const { resolveStore } = await import("./src/index.ts");
      try { resolveStore({}); process.exit(2); } catch {}
    `], { cwd: join(import.meta.dir, "../.."), env: { PATH: process.env.PATH, HOME: temporary, HASNA_CONFIG_HOME: join(temporary, "config") } });
    expect(child.exitCode).toBe(0);
    expect(existsSync(join(temporary, "config"))).toBe(false);
    for (const name of [".hasna/attachments", ".attachments", ".open-attachments"]) {
      expect(readFileSync(join(temporary, name, "attachments.db"), "utf8")).toBe("legacy sentinel");
    }
  } finally {
    rmSync(temporary, { recursive: true, force: true });
  }
});
