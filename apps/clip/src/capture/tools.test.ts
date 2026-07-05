import { describe, expect, it } from "bun:test";
import { chmodSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { bytesToBuffer, commandExists, copyTextToClipboard, openLocalTarget, runCommand, runCommandBytes } from "./tools.js";

function restorePath(value: string | undefined): void {
  if (value === undefined) {
    delete process.env["PATH"];
  } else {
    process.env["PATH"] = value;
  }
}

function writeTool(binDir: string, name: string, body: string): string {
  const path = join(binDir, name);
  writeFileSync(path, `#!/bin/sh\n${body}`);
  chmodSync(path, 0o755);
  return path;
}

function overridePlatform(platform: NodeJS.Platform): () => void {
  const previous = process.platform;
  Object.defineProperty(process, "platform", { configurable: true, value: platform });
  return () => Object.defineProperty(process, "platform", { configurable: true, value: previous });
}

describe("capture tool shims", () => {
  it("reports missing commands without spawning", async () => {
    const previousPath = process.env["PATH"];
    try {
      process.env["PATH"] = "";

      expect(commandExists("definitely-not-installed")).toBe(false);
      expect(await runCommand("definitely-not-installed")).toMatchObject({
        exitCode: 127,
        stderr: "definitely-not-installed not found",
        ok: false,
      });
      const missingBytes = await runCommandBytes("definitely-not-installed");
      expect(missingBytes.result).toMatchObject({
        exitCode: 127,
        stderr: "definitely-not-installed not found",
        ok: false,
      });
      expect(missingBytes.bytes.byteLength).toBe(0);
    } finally {
      restorePath(previousPath);
    }
  });

  it("captures stdout, stderr, exit code, and piped input", async () => {
    const dir = mkdtempSync(join(tmpdir(), "clip-tools-command-"));
    const previousPath = process.env["PATH"];
    try {
      const binDir = join(dir, "bin");
      mkdirSync(binDir);
      writeTool(binDir, "echo-input", "input=$(/bin/cat)\nprintf 'out:%s' \"$input\"\nprintf 'warn' >&2\nexit 7\n");
      process.env["PATH"] = binDir;

      const result = await runCommand("echo-input", ["ignored"], "hello");

      expect(result).toMatchObject({
        command: "echo-input",
        args: ["ignored"],
        exitCode: 7,
        stdout: "out:hello",
        stderr: "warn",
        ok: false,
      });
    } finally {
      restorePath(previousPath);
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it("captures binary stdout and converts bytes to buffers", async () => {
    const dir = mkdtempSync(join(tmpdir(), "clip-tools-bytes-"));
    const previousPath = process.env["PATH"];
    try {
      const binDir = join(dir, "bin");
      mkdirSync(binDir);
      writeTool(binDir, "bytes", "printf 'abc'\n");
      process.env["PATH"] = binDir;

      const { result, bytes } = await runCommandBytes("bytes");

      expect(result.ok).toBe(true);
      expect(bytesToBuffer(bytes).toString("utf8")).toBe("abc");
    } finally {
      restorePath(previousPath);
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it("copies text through the first available Linux clipboard command", async () => {
    const dir = mkdtempSync(join(tmpdir(), "clip-tools-copy-"));
    const previousPath = process.env["PATH"];
    try {
      const binDir = join(dir, "bin");
      mkdirSync(binDir);
      writeTool(binDir, "wl-copy", "input=$(/bin/cat)\n[ \"$input\" = 'share-link' ] || exit 5\n");
      process.env["PATH"] = binDir;

      expect(await copyTextToClipboard("share-link")).toEqual({ ok: true, command: "wl-copy" });
    } finally {
      restorePath(previousPath);
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it("copies text through pbcopy on macOS", async () => {
    const dir = mkdtempSync(join(tmpdir(), "clip-tools-pbcopy-"));
    const previousPath = process.env["PATH"];
    const restorePlatform = overridePlatform("darwin");
    try {
      const binDir = join(dir, "bin");
      mkdirSync(binDir);
      writeTool(binDir, "pbcopy", "input=$(/bin/cat)\n[ \"$input\" = 'mac-link' ] || exit 5\n");
      process.env["PATH"] = binDir;

      expect(await copyTextToClipboard("mac-link")).toEqual({ ok: true, command: "pbcopy" });
    } finally {
      restorePlatform();
      restorePath(previousPath);
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it("returns command errors from clipboard and opener tools", async () => {
    const dir = mkdtempSync(join(tmpdir(), "clip-tools-errors-"));
    const previousPath = process.env["PATH"];
    const restorePlatform = overridePlatform("linux");
    try {
      const binDir = join(dir, "bin");
      mkdirSync(binDir);
      writeTool(binDir, "xclip", "printf 'copy failed' >&2\nexit 8\n");
      writeTool(binDir, "xdg-open", "printf 'open failed' >&2\nexit 9\n");
      process.env["PATH"] = binDir;

      expect(await copyTextToClipboard("x")).toEqual({ ok: false, command: "xclip", error: "copy failed" });
      expect(await openLocalTarget("http://clip.test")).toEqual({ ok: false, command: "xdg-open", error: "open failed" });
    } finally {
      restorePlatform();
      restorePath(previousPath);
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it("uses gio when xdg-open is absent", async () => {
    const dir = mkdtempSync(join(tmpdir(), "clip-tools-gio-"));
    const previousPath = process.env["PATH"];
    const restorePlatform = overridePlatform("linux");
    try {
      const binDir = join(dir, "bin");
      mkdirSync(binDir);
      writeTool(binDir, "gio", "[ \"$1\" = 'open' ] || exit 2\n[ \"$2\" = 'target' ] || exit 3\n");
      process.env["PATH"] = binDir;

      expect(await openLocalTarget("target")).toEqual({ ok: true, command: "gio" });
    } finally {
      restorePlatform();
      restorePath(previousPath);
      rmSync(dir, { recursive: true, force: true });
    }
  });
});
