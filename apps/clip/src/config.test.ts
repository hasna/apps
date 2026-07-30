import { describe, expect, it } from "bun:test";
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
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

  it("does not overwrite malformed config when updating", () => {
    const homeDir = mkdtempSync(join(tmpdir(), "clip-config-malformed-"));
    const path = join(homeDir, "config.json");
    const contents = '{"baseUrl":"https://example.test","port":8080';
    try {
      writeFileSync(path, contents);

      let thrown: unknown;
      try {
        updateConfig("host", "localhost", { homeDir });
      } catch (error) {
        thrown = error;
      }

      expect(thrown).toBeInstanceOf(Error);
      expect((thrown as Error).message).toContain(path);
      expect((thrown as Error).message).toMatch(/Expected|Unexpected/);
      expect(readFileSync(path, "utf8")).toBe(contents);
    } finally {
      rmSync(homeDir, { recursive: true, force: true });
    }
  });

  it("does not overwrite non-object config when updating", () => {
    const homeDir = mkdtempSync(join(tmpdir(), "clip-config-array-"));
    const path = join(homeDir, "config.json");
    const contents = "[1,2,3]";
    try {
      writeFileSync(path, contents);

      let thrown: unknown;
      try {
        updateConfig("host", "localhost", { homeDir });
      } catch (error) {
        thrown = error;
      }

      expect(thrown).toBeInstanceOf(Error);
      expect((thrown as Error).message).toContain(path);
      expect((thrown as Error).message).toContain("JSON object");
      expect(readFileSync(path, "utf8")).toBe(contents);
    } finally {
      rmSync(homeDir, { recursive: true, force: true });
    }
  });

  it("updates missing and well-formed config without losing keys", () => {
    const missingHomeDir = join(mkdtempSync(join(tmpdir(), "clip-config-missing-")), "home");
    const homeDir = mkdtempSync(join(tmpdir(), "clip-config-valid-"));
    try {
      expect(updateConfig("host", "localhost", { homeDir: missingHomeDir })).toEqual({ host: "localhost" });

      writeConfig({ baseUrl: "https://example.test", port: 8080 }, { homeDir });
      expect(updateConfig("host", "localhost", { homeDir })).toEqual({
        baseUrl: "https://example.test",
        port: 8080,
        host: "localhost",
      });
    } finally {
      rmSync(join(missingHomeDir, ".."), { recursive: true, force: true });
      rmSync(homeDir, { recursive: true, force: true });
    }
  });
});
