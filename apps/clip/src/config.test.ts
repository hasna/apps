import { describe, expect, it } from "bun:test";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { readConfig, updateConfig, writeConfig } from "./config.js";

describe("configuration persistence", () => {
  it("returns empty config for missing, invalid, and non-object config files", () => {
    const dir = mkdtempSync(join(tmpdir(), "clip-config-read-"));
    try {
      expect(readConfig({ homeDir: join(dir, "missing") })).toEqual({});

      const homeDir = join(dir, "home");
      mkdirSync(homeDir);
      writeFileSync(join(homeDir, "config.json"), "[1,2,3]");
      expect(readConfig({ homeDir })).toEqual({});

      writeFileSync(join(homeDir, "config.json"), "{not json");
      expect(readConfig({ homeDir })).toEqual({});
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it("writes known keys and validates port updates", () => {
    const dir = mkdtempSync(join(tmpdir(), "clip-config-write-"));
    try {
      expect(writeConfig({ baseUrl: "http://clip.test" }, { homeDir: dir })).toEqual({ baseUrl: "http://clip.test" });
      expect(updateConfig("host", "0.0.0.0", { homeDir: dir }).host).toBe("0.0.0.0");
      expect(updateConfig("port", "4444", { homeDir: dir }).port).toBe(4444);
      expect(updateConfig("custom", "value", { homeDir: dir }).custom).toBe("value");
      expect(() => updateConfig("port", "70000", { homeDir: dir })).toThrow("port must be between 1 and 65535");
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });
});
