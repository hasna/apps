import { describe, expect, test, beforeEach } from "bun:test";
import { mkdtempSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { loadConfig, saveConfig, defaultConfig, configPath } from "../src/config";

let dir: string;

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), "statusline-test-"));
  process.env.STATUSLINE_CONFIG = join(dir, "config.json");
});

describe("config", () => {
  test("configPath honors STATUSLINE_CONFIG", () => {
    expect(configPath()).toBe(process.env.STATUSLINE_CONFIG!);
  });

  test("load returns defaults when missing", () => {
    const cfg = loadConfig();
    expect(cfg.segments).toEqual(defaultConfig().segments);
    expect(cfg.separator).toBe(" · ");
  });

  test("save then load round-trips", () => {
    const cfg = loadConfig();
    cfg.segments = ["machine", "cost"];
    cfg.separator = " | ";
    saveConfig(cfg);
    const loaded = loadConfig();
    expect(loaded.segments).toEqual(["machine", "cost"]);
    expect(loaded.separator).toBe(" | ");
    // file is real JSON
    expect(() => JSON.parse(readFileSync(configPath(), "utf8"))).not.toThrow();
  });

  test("garbage file falls back to defaults", () => {
    Bun.write(configPath(), "{not json");
    const cfg = loadConfig();
    expect(cfg.segments).toEqual(defaultConfig().segments);
  });
});
