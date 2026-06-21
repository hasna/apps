import { describe, expect, it } from "bun:test";
import { mkdtempSync, mkdirSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createHelpers } from "./helpers.js";

describe("createHelpers", () => {
  it("resolves home-relative paths for file tools", () => {
    const previousHome = process.env.HOME;
    process.env.HOME = "/tmp/test home";

    try {
      const helpers = createHelpers("test-session");
      expect(helpers.resolvePath("~/notes.md")).toBe("/tmp/test home/notes.md");
      expect(helpers.resolvePath("~")).toBe("/tmp/test home");
      expect(helpers.resolvePath("src/index.ts", "~/project")).toBe("/tmp/test home/project/src/index.ts");
    } finally {
      process.env.HOME = previousHome;
    }
  });

  it("expands home-relative cwd values before spawning commands", async () => {
    const tempHome = mkdtempSync(join(tmpdir(), "terminal-home-"));
    const workDir = join(tempHome, "work space");
    mkdirSync(workDir);
    const previousHome = process.env.HOME;
    process.env.HOME = tempHome;

    try {
      const helpers = createHelpers("test-session");
      const result = await helpers.exec("pwd", "~/work space", 5000);

      expect(result.exitCode).toBe(0);
      expect(result.stdout.trim()).toBe(workDir);
    } finally {
      process.env.HOME = previousHome;
      rmSync(tempHome, { recursive: true, force: true });
    }
  });
});
