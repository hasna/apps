import { describe, expect, it } from "bun:test";
import { chmodSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { captureClipboardHistory, detectClipboardCapabilities, shareClipboard } from "./clipboard.js";
import { ClipStore } from "./storage.js";

function restoreEnv(name: string, value: string | undefined): void {
  if (value === undefined) {
    delete process.env[name];
  } else {
    process.env[name] = value;
  }
}

function overridePlatform(platform: NodeJS.Platform): () => void {
  const previous = process.platform;
  Object.defineProperty(process, "platform", { configurable: true, value: platform });
  return () => Object.defineProperty(process, "platform", { configurable: true, value: previous });
}

describe("clipboard sharing", () => {
  it("reads image bytes from pngpaste when that advertised capability is available", async () => {
    const dir = mkdtempSync(join(tmpdir(), "clip-clipboard-"));
    const previousPath = process.env["PATH"];
    try {
      const binDir = join(dir, "bin");
      mkdirSync(binDir);
      const pngpaste = join(binDir, "pngpaste");
      writeFileSync(pngpaste, "#!/usr/bin/env bun\nif (process.argv[2] !== '-') process.exit(2);\nprocess.stdout.write('fake-png-bytes');\n");
      chmodSync(pngpaste, 0o755);
      process.env["PATH"] = `${binDir}:${previousPath ?? ""}`;

      const record = await shareClipboard("image", {
        homeDir: join(dir, "home"),
        baseUrl: "http://clip.test",
      });

      expect(record.kind).toBe("clipboard-image");
      expect(record.source).toBe("clipboard:pngpaste");
      expect(record.sizeBytes).toBe("fake-png-bytes".length);
      expect(record.shareUrl).toStartWith("http://clip.test/s/");
    } finally {
      if (previousPath === undefined) {
        delete process.env["PATH"];
      } else {
        process.env["PATH"] = previousPath;
      }
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it("does not advertise file clipboard support from pbpaste alone", () => {
    const dir = mkdtempSync(join(tmpdir(), "clip-clipboard-capability-"));
    const previousPath = process.env["PATH"];
    try {
      const binDir = join(dir, "bin");
      mkdirSync(binDir);
      const pbpaste = join(binDir, "pbpaste");
      writeFileSync(pbpaste, "#!/usr/bin/env bash\nprintf text\n");
      chmodSync(pbpaste, 0o755);
      process.env["PATH"] = binDir;

      const capabilities = detectClipboardCapabilities();

      expect(capabilities.tools["pbpaste"]).toBe(true);
      expect(capabilities.tools["wl-paste"]).toBe(false);
      expect(capabilities.supports.file).toBe(false);
    } finally {
      if (previousPath === undefined) {
        delete process.env["PATH"];
      } else {
        process.env["PATH"] = previousPath;
      }
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it("captures text clipboard content into opt-in history", async () => {
    const dir = mkdtempSync(join(tmpdir(), "clip-clipboard-history-"));
    const previousPath = process.env["PATH"];
    try {
      const binDir = join(dir, "bin");
      mkdirSync(binDir);
      const wlPaste = join(binDir, "wl-paste");
      writeFileSync(wlPaste, "#!/usr/bin/env bash\nif [ \"$1\" = \"--no-newline\" ]; then printf 'history text'; else exit 2; fi\n");
      chmodSync(wlPaste, 0o755);
      process.env["PATH"] = `${binDir}:${previousPath ?? ""}`;

      const homeDir = join(dir, "home");
      const entry = await captureClipboardHistory("text", {
        homeDir,
        title: "Captured text",
        maxItems: 5,
      });

      expect(entry.kind).toBe("clipboard-text");
      expect(entry.text).toBe("history text");
      expect(entry.title).toBe("Captured text");

      const store = new ClipStore({ homeDir });
      try {
        expect(store.listClipboardHistory({ limit: 10 })).toHaveLength(1);
        expect(store.listClips({ limit: 10 })).toHaveLength(0);
      } finally {
        store.close();
      }
    } finally {
      if (previousPath === undefined) {
        delete process.env["PATH"];
      } else {
        process.env["PATH"] = previousPath;
      }
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it("shares text from wl-paste", async () => {
    const dir = mkdtempSync(join(tmpdir(), "clip-clipboard-text-"));
    const previousPath = process.env["PATH"];
    try {
      const binDir = join(dir, "bin");
      mkdirSync(binDir);
      const wlPaste = join(binDir, "wl-paste");
      writeFileSync(wlPaste, "#!/bin/sh\n[ \"$1\" = '--no-newline' ] || exit 2\nprintf 'clipboard text'\n");
      chmodSync(wlPaste, 0o755);
      process.env["PATH"] = binDir;

      const record = await shareClipboard("text", {
        homeDir: join(dir, "home"),
        title: "Text",
      });

      expect(record.kind).toBe("text");
      expect(record.text).toBe("clipboard text");
      expect(record.title).toBe("Text");
      expect(record.source).toBe("clipboard:text");
    } finally {
      if (previousPath === undefined) {
        delete process.env["PATH"];
      } else {
        process.env["PATH"] = previousPath;
      }
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it("shares text from macOS pbpaste", async () => {
    const dir = mkdtempSync(join(tmpdir(), "clip-clipboard-pbpaste-"));
    const previousPath = process.env["PATH"];
    const restorePlatform = overridePlatform("darwin");
    try {
      const binDir = join(dir, "bin");
      mkdirSync(binDir);
      const pbpaste = join(binDir, "pbpaste");
      writeFileSync(pbpaste, "#!/bin/sh\nprintf 'mac clipboard'\n");
      chmodSync(pbpaste, 0o755);
      process.env["PATH"] = binDir;

      const record = await shareClipboard("text", { homeDir: join(dir, "home") });

      expect(record.text).toBe("mac clipboard");
      expect(record.source).toBe("clipboard:text");
    } finally {
      restorePlatform();
      restoreEnv("PATH", previousPath);
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it("shares images from wl-paste and xclip fallbacks", async () => {
    const wlDir = mkdtempSync(join(tmpdir(), "clip-clipboard-wl-image-"));
    const xclipDir = mkdtempSync(join(tmpdir(), "clip-clipboard-xclip-image-"));
    const previousPath = process.env["PATH"];
    try {
      const wlBin = join(wlDir, "bin");
      mkdirSync(wlBin);
      const wlPaste = join(wlBin, "wl-paste");
      writeFileSync(wlPaste, "#!/bin/sh\n[ \"$1\" = '--type' ] && [ \"$2\" = 'image/png' ] || exit 2\nprintf 'wl-image'\n");
      chmodSync(wlPaste, 0o755);
      process.env["PATH"] = wlBin;

      const wlRecord = await shareClipboard("image", { homeDir: join(wlDir, "home") });
      expect(wlRecord.source).toBe("clipboard:wl-paste");
      expect(wlRecord.sizeBytes).toBe("wl-image".length);

      const xclipBin = join(xclipDir, "bin");
      mkdirSync(xclipBin);
      const xclip = join(xclipBin, "xclip");
      writeFileSync(xclip, [
        "#!/bin/sh",
        "if [ \"$3\" = '-t' ] && [ \"$4\" = 'image/png' ] && [ \"$5\" = '-o' ]; then",
        "  printf 'xclip-image'",
        "  exit 0",
        "fi",
        "exit 3",
      ].join("\n") + "\n");
      chmodSync(xclip, 0o755);
      process.env["PATH"] = xclipBin;

      const xclipRecord = await shareClipboard("image", { homeDir: join(xclipDir, "home") });
      expect(xclipRecord.source).toBe("clipboard:xclip");
      expect(xclipRecord.sizeBytes).toBe("xclip-image".length);
    } finally {
      restoreEnv("PATH", previousPath);
      rmSync(wlDir, { recursive: true, force: true });
      rmSync(xclipDir, { recursive: true, force: true });
    }
  });

  it("shares text from xclip", async () => {
    const dir = mkdtempSync(join(tmpdir(), "clip-clipboard-xclip-text-"));
    const previousPath = process.env["PATH"];
    try {
      const binDir = join(dir, "bin");
      mkdirSync(binDir);
      const xclip = join(binDir, "xclip");
      writeFileSync(xclip, "#!/bin/sh\n[ \"$3\" = '-o' ] || exit 2\nprintf 'xclip text'\n");
      chmodSync(xclip, 0o755);
      process.env["PATH"] = binDir;

      const record = await shareClipboard("text", { homeDir: join(dir, "home") });

      expect(record.text).toBe("xclip text");
      expect(record.source).toBe("clipboard:text");
    } finally {
      restoreEnv("PATH", previousPath);
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it("shares file paths from text/uri-list clipboard content before image or text fallbacks", async () => {
    const dir = mkdtempSync(join(tmpdir(), "clip-clipboard-file-"));
    const previousPath = process.env["PATH"];
    try {
      const source = join(dir, "source.txt");
      writeFileSync(source, "file clipboard");

      const binDir = join(dir, "bin");
      mkdirSync(binDir);
      const wlPaste = join(binDir, "wl-paste");
      writeFileSync(wlPaste, [
        "#!/bin/sh",
        "if [ \"$1\" = '--type' ] && [ \"$2\" = 'text/uri-list' ]; then",
        `  printf 'file://${source}\\n'`,
        "  exit 0",
        "fi",
        "if [ \"$1\" = '--type' ] && [ \"$2\" = 'image/png' ]; then",
        "  printf 'image should not be used'",
        "  exit 0",
        "fi",
        "printf 'text should not be used'",
      ].join("\n") + "\n");
      chmodSync(wlPaste, 0o755);
      process.env["PATH"] = binDir;

      const record = await shareClipboard("auto", {
        homeDir: join(dir, "home"),
        baseUrl: "http://clip.test",
      });

      expect(record.kind).toBe("clipboard-file");
      expect(record.source).toBe("clipboard:file");
      expect(record.sizeBytes).toBe("file clipboard".length);
      expect(record.shareUrl).toStartWith("http://clip.test/s/");
    } finally {
      restoreEnv("PATH", previousPath);
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it("skips invalid URI entries and accepts direct clipboard paths", async () => {
    const dir = mkdtempSync(join(tmpdir(), "clip-clipboard-direct-path-"));
    const previousPath = process.env["PATH"];
    try {
      const source = join(dir, "direct.txt");
      writeFileSync(source, "direct clipboard");
      const binDir = join(dir, "bin");
      mkdirSync(binDir);
      const wlPaste = join(binDir, "wl-paste");
      writeFileSync(wlPaste, [
        "#!/bin/sh",
        "if [ \"$1\" = '--type' ] && [ \"$2\" = 'text/uri-list' ]; then",
        "  printf '%s\\n' 'file://%zz' '# ignored' ''",
        `  printf '%s\\n' '${source}'`,
        "  exit 0",
        "fi",
        "exit 4",
      ].join("\n") + "\n");
      chmodSync(wlPaste, 0o755);
      process.env["PATH"] = binDir;

      const record = await shareClipboard("file", { homeDir: join(dir, "home") });

      expect(record.kind).toBe("clipboard-file");
      expect(record.sizeBytes).toBe("direct clipboard".length);
    } finally {
      restoreEnv("PATH", previousPath);
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it("throws specific errors for unavailable explicit clipboard kinds", async () => {
    const previousPath = process.env["PATH"];
    try {
      process.env["PATH"] = "";

      await expect(shareClipboard("file", { dbPath: ":memory:" })).rejects.toThrow("readable file path");
      await expect(shareClipboard("image", { dbPath: ":memory:" })).rejects.toThrow("image capture is unavailable");
      await expect(shareClipboard("auto", { dbPath: ":memory:" })).rejects.toThrow("could not be read");
    } finally {
      restoreEnv("PATH", previousPath);
    }
  });
});
