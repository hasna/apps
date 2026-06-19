import { mkdtempSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { describe, expect, test } from "bun:test";
import { installStartup } from "./install.js";

describe("installStartup", () => {
  test("writes loops-daemon service with top-level run command", () => {
    const oldHome = process.env.HOME;
    process.env.HOME = mkdtempSync(join(tmpdir(), "loops-home-"));
    try {
      const result = installStartup("loops-daemon", "/usr/bin/bun", ["run"]);
      if (process.platform === "linux") {
        const service = readFileSync(result.path, "utf8");
        expect(service).toContain("ExecStart=/usr/bin/bun loops-daemon run");
        expect(service).not.toContain("loops-daemon daemon run");
      }
    } finally {
      if (oldHome === undefined) delete process.env.HOME;
      else process.env.HOME = oldHome;
    }
  });
});
