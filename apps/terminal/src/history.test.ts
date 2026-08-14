import { describe, it, expect, beforeEach, afterEach } from "bun:test";
import { loadHistory, saveHistory, appendHistory, loadConfig, saveConfig, DEFAULT_CONFIG, DEFAULT_PERMISSIONS, HistoryEntry, Config } from "./history.js";
import { existsSync, rmSync } from "fs";
import { join } from "path";
import { getTerminalDir } from "./paths.js";

describe("history", () => {
  const HISTORY_FILE = join(getTerminalDir(), "history.json");

  beforeEach(() => {
    if (existsSync(HISTORY_FILE)) rmSync(HISTORY_FILE);
  });

  afterEach(() => {
    if (existsSync(HISTORY_FILE)) rmSync(HISTORY_FILE);
  });

  it("returns empty array when no history file exists", () => {
    expect(loadHistory()).toEqual([]);
  });

  it("saves and loads history", () => {
    const entries: HistoryEntry[] = [
      { nl: "list files", cmd: "ls", output: "file.txt", ts: Date.now() },
    ];
    saveHistory(entries);
    const loaded = loadHistory();
    expect(loaded).toHaveLength(1);
    expect(loaded[0].cmd).toBe("ls");
  });

  it("appends to existing history", () => {
    const entry1: HistoryEntry = { nl: "list files", cmd: "ls", output: "file.txt", ts: Date.now() };
    saveHistory([entry1]);
    const entry2: HistoryEntry = { nl: "run tests", cmd: "bun test", output: "pass", ts: Date.now() };
    appendHistory(entry2);
    const loaded = loadHistory();
    expect(loaded).toHaveLength(2);
  });

  it("caps history at 500 entries", () => {
    const entries = Array(600).fill(null).map((_, i) => ({
      nl: `query ${i}`, cmd: `echo ${i}`, output: "out", ts: i,
    }));
    saveHistory(entries);
    const loaded = loadHistory();
    expect(loaded.length).toBeLessThanOrEqual(500);
  });

  it("returns empty array for corrupted file", () => {
    saveHistory([{ nl: "a", cmd: "b", output: "c", ts: 1 } as HistoryEntry]);
    // Manually corrupt the file
    const { writeFileSync } = require("fs");
    writeFileSync(HISTORY_FILE, "{invalid json");
    expect(loadHistory()).toEqual([]);
  });
});

describe("config", () => {
  const CONFIG_FILE = join(getTerminalDir(), "config.json");

  beforeEach(() => {
    if (existsSync(CONFIG_FILE)) rmSync(CONFIG_FILE);
  });

  afterEach(() => {
    if (existsSync(CONFIG_FILE)) rmSync(CONFIG_FILE);
  });

  it("returns defaults when no config exists", () => {
    const config = loadConfig();
    expect(config.onboarded).toBe(false);
    expect(config.confirm).toBe(false);
    expect(config.permissions.destructive).toBe(true);
  });

  it("saves and loads config", () => {
    const cfg: Config = { ...DEFAULT_CONFIG, onboarded: true };
    saveConfig(cfg);
    const loaded = loadConfig();
    expect(loaded.onboarded).toBe(true);
  });

  it("fills missing fields with defaults", () => {
    const { writeFileSync } = require("fs");
    writeFileSync(CONFIG_FILE, JSON.stringify({ custom_field: true }));
    const loaded = loadConfig();
    expect(loaded.permissions.destructive).toBe(true); // default filled
  });

  it("returns defaults for corrupted file", () => {
    const { writeFileSync } = require("fs");
    writeFileSync(CONFIG_FILE, "{invalid json");
    const config = loadConfig();
    expect(config.onboarded).toBe(false);
  });

  it("DEFAULT_PERMISSIONS has all true", () => {
    const values = Object.values(DEFAULT_PERMISSIONS);
    expect(values.every(v => v === true)).toBe(true);
  });

  it("DEFAULT_CONFIG has expected values", () => {
    expect(DEFAULT_CONFIG.onboarded).toBe(false);
    expect(DEFAULT_CONFIG.confirm).toBe(false);
  });
});
