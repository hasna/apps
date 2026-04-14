import { afterEach, describe, expect, test } from "bun:test";
import { mkdtempSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import {
  computeHash,
  getDefaultClipboardConfig,
  getOrCreateClipboardKey,
  getClipboardStatus,
  readClipboardConfig,
  readClipboardHistory,
  writeClipboardConfig,
  addClipboardEntry,
  clearClipboardHistory,
  sanitizeClipboardForRead,
  shouldSkipContent,
} from "../src/commands/clipboard.js";
import type { ClipboardEntry } from "../src/types.js";

function makePaths(dir: string) {
  return {
    keyPath: join(dir, "clipboard.key"),
    configPath: join(dir, "clipboard-config.json"),
    historyPath: join(dir, "clipboard-history.json"),
  };
}

describe("clipboard", () => {
  afterEach(() => {
    delete process.env["HASNA_MACHINES_MACHINE_ID"];
  });

  test("computeHash returns consistent short hashes", () => {
    const h1 = computeHash("hello");
    const h2 = computeHash("hello");
    expect(h1).toBe(h2);
    expect(h1.length).toBe(16);
    expect(computeHash("hello")).not.toBe(computeHash("world"));
  });

  test("shouldSkipContent detects secret patterns", () => {
    expect(shouldSkipContent("my password is 123", ["password"])).toBe(true);
    expect(shouldSkipContent("AKIAIOSFODNN7EXAMPLE", ["AKIA"])).toBe(true);
    expect(shouldSkipContent("-----BEGIN RSA PRIVATE KEY-----", ["-----BEGIN"])).toBe(true);
    expect(shouldSkipContent("hello world", ["password", "secret"])).toBe(false);
  });

  test("sanitizeClipboardForRead blocks large content", () => {
    const large = "x".repeat(2 * 1024 * 1024); // 2MB
    const result = sanitizeClipboardForRead(large, 1024 * 1024, []);
    expect(result.ok).toBe(false);
    expect(result.reason).toBe("content exceeds size limit");
  });

  test("sanitizeClipboardForRead blocks secret patterns", () => {
    const result = sanitizeClipboardForRead("my secret token is AKIA123", 1024 * 1024, ["secret", "AKIA"]);
    expect(result.ok).toBe(false);
    expect(result.reason).toBe("content matches skip pattern");
  });

  test("sanitizeClipboardForRead allows normal content", () => {
    const result = sanitizeClipboardForRead("hello world", 1024 * 1024, ["password"]);
    expect(result.ok).toBe(true);
  });

  test("getDefaultClipboardConfig returns defaults", () => {
    const config = getDefaultClipboardConfig();
    expect(config.enabled).toBe(true);
    expect(config.port).toBe(19452);
    expect(config.maxHistory).toBe(500);
    expect(config.skipPatterns.length).toBeGreaterThan(0);
  });

  test("clipboard key creation and retrieval", () => {
    const dir = mkdtempSync(join(tmpdir(), "clipboard-"));
    process.env["HASNA_MACHINES_CLIPBOARD_KEY_PATH"] = join(dir, "clipboard.key");

    const key = getOrCreateClipboardKey();
    expect(key.length).toBe(32);

    const key2 = getOrCreateClipboardKey();
    expect(key).toBe(key2);

    delete process.env["HASNA_MACHINES_CLIPBOARD_KEY_PATH"];
  });

  test("clipboard config read/write", () => {
    const dir = mkdtempSync(join(tmpdir(), "clipboard-cfg-"));
    const paths = makePaths(dir);

    const config = getDefaultClipboardConfig();
    config.port = 12345;
    writeClipboardConfig(config, paths.configPath);

    const loaded = readClipboardConfig(paths.configPath);
    expect(loaded.port).toBe(12345);
    expect(loaded.enabled).toBe(true);
  });

  test("clipboard history add and read", () => {
    const dir = mkdtempSync(join(tmpdir(), "clipboard-hist-"));
    const paths = makePaths(dir);

    const entry: ClipboardEntry = {
      hash: "abc123",
      content: "hello world",
      contentType: "text",
      sourceMachine: "spark01",
      timestamp: new Date().toISOString(),
    };
    addClipboardEntry(entry, paths.historyPath);

    const history = readClipboardHistory(paths.historyPath);
    expect(history.length).toBe(1);
    expect(history[0].hash).toBe("abc123");
    expect(history[0].sourceMachine).toBe("spark01");
  });

  test("clearClipboardHistory removes the file", () => {
    const dir = mkdtempSync(join(tmpdir(), "clipboard-clear-"));
    const paths = makePaths(dir);

    addClipboardEntry(
      { hash: "x", content: "y", contentType: "text", sourceMachine: "z", timestamp: new Date().toISOString() },
      paths.historyPath
    );
    expect(readClipboardHistory(paths.historyPath).length).toBe(1);

    clearClipboardHistory(paths.historyPath);
    expect(readClipboardHistory(paths.historyPath).length).toBe(0);
  });

  test("getClipboardStatus returns status", () => {
    const dir = mkdtempSync(join(tmpdir(), "clipboard-status-"));
    const paths = makePaths(dir);

    process.env["HASNA_MACHINES_CLIPBOARD_KEY_PATH"] = paths.keyPath;
    process.env["HASNA_MACHINES_CLIPBOARD_HISTORY_PATH"] = paths.historyPath;

    const status = getClipboardStatus(paths.historyPath);
    expect(status.running).toBe(false);
    expect(status.port).toBe(19452);
    expect(status.historyCount).toBe(0);

    delete process.env["HASNA_MACHINES_CLIPBOARD_KEY_PATH"];
    delete process.env["HASNA_MACHINES_CLIPBOARD_HISTORY_PATH"];
  });
});
