import { describe, expect, it } from "bun:test";
import { spawnSync } from "node:child_process";
import { existsSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { buildBrowseCommand } from "./execute.js";

describe("buildBrowseCommand", () => {
  it("keeps double quotes and command separators inside the path argument", () => {
    const command = buildBrowseCommand({
      target: `/tmp/project"; touch /tmp/owned; echo "`,
      recursive: false,
      includeHidden: false,
      depth: 2,
    });

    expect(command).toBe(`ls -l '/tmp/project"; touch /tmp/owned; echo "'`);
  });

  it("escapes single quotes in recursive browse paths", () => {
    const command = buildBrowseCommand({
      target: "/tmp/project's files",
      recursive: true,
      includeHidden: false,
      depth: 3,
    });

    expect(command).toBe(
      `find '/tmp/project'\\''s files' -maxdepth 3 -not -path '*/node_modules/*' -not -path '*/.git/*' -not -path '*/dist/*' -not -path '*/.next/*' -not -name '.*'`,
    );
  });

  it("does not let option-like recursive paths become find predicates", () => {
    const dir = mkdtempSync(join(tmpdir(), "terminal-browse-"));
    mkdirSync(join(dir, "-delete"));
    writeFileSync(join(dir, "keep.ts"), "keep");

    try {
      const command = buildBrowseCommand({
        target: "-delete",
        recursive: true,
        includeHidden: false,
        depth: 2,
      });

      spawnSync("/bin/bash", ["-c", command], { cwd: dir, encoding: "utf8" });

      expect(existsSync(join(dir, "keep.ts"))).toBe(true);
      expect(existsSync(join(dir, "-delete"))).toBe(true);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it("keeps find expression tokens as recursive path operands", () => {
    for (const target of ["(", "!"]) {
      const dir = mkdtempSync(join(tmpdir(), "terminal-browse-"));
      mkdirSync(join(dir, target));
      writeFileSync(join(dir, target, "inside.ts"), "inside");

      try {
        const command = buildBrowseCommand({
          target,
          recursive: true,
          includeHidden: false,
          depth: 2,
        });

        const result = spawnSync("/bin/bash", ["-c", command], { cwd: dir, encoding: "utf8" });

        expect(result.status).toBe(0);
        expect(result.stdout).toContain(`./${target}`);
        expect(result.stdout).toContain(`./${target}/inside.ts`);
      } finally {
        rmSync(dir, { recursive: true, force: true });
      }
    }
  });
});
