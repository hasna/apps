import { describe, expect, it } from "bun:test";
import { chmodSync, existsSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createClipClient } from "./index.js";

function overridePlatform(platform: NodeJS.Platform): () => void {
  const previous = process.platform;
  Object.defineProperty(process, "platform", { configurable: true, value: platform });
  return () => Object.defineProperty(process, "platform", { configurable: true, value: previous });
}

describe("public SDK", () => {
  it("creates and retrieves a text share", () => {
    const dir = mkdtempSync(join(tmpdir(), "clip-sdk-"));
    try {
      const client = createClipClient({ homeDir: dir, baseUrl: "http://127.0.0.1:3741" });
      const record = client.createTextShare("sdk text", { title: "SDK" });
      expect(client.getShare(record.slug)?.text).toBe("sdk text");
      expect(client.listShares({ limit: 5 })[0]?.id).toBe(record.id);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it("imports files, opens/copies links best-effort, and lists deleted records", async () => {
    const dir = mkdtempSync(join(tmpdir(), "clip-sdk-file-"));
    const previousPath = process.env["PATH"];
    try {
      process.env["PATH"] = "";
      const source = join(dir, "source.txt");
      writeFileSync(source, "file text");
      const client = createClipClient({ homeDir: join(dir, "home"), baseUrl: "http://clip.test" });

      const record = client.importFile(source, { title: "Imported", metadata: { safe: true } });
      expect(record.source).toBe("sdk:file");
      expect(record.artifactPath && existsSync(record.artifactPath)).toBe(true);

      const copied = await client.copyLink(record.slug);
      expect(copied).toMatchObject({
        copied: false,
        error: "No clipboard copy tool found (pbcopy, PowerShell, wl-copy, or xclip).",
      });
      expect(copied.record.shareUrl).toBe(`http://clip.test/s/${record.slug}`);

      const opened = await client.openShare(record.slug);
      expect(opened.opened).toBe(false);
      expect(opened.target).toBe(record.artifactPath);

      expect(client.deleteShare(record.id)).toBe(true);
      expect(client.getShare(record.id)).toBeNull();
      expect(client.listShares({ includeDeleted: true })[0]?.deletedAt).toBeTruthy();

      await expect(client.copyLink("missing")).rejects.toThrow("Share not found: missing");

      const status = await client.status();
      expect(status.baseUrl).toBe("http://clip.test");
      expect(status.storage.deleted).toBe(1);
      expect(status.capture.modes.full).toBe(false);
      expect(status.clipboard.supports.text).toBe(false);
    } finally {
      if (previousPath === undefined) {
        delete process.env["PATH"];
      } else {
        process.env["PATH"] = previousPath;
      }
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it("delegates capture and clipboard sharing through client options", async () => {
    const dir = mkdtempSync(join(tmpdir(), "clip-sdk-tools-"));
    const previousPath = process.env["PATH"];
    const previousDisplay = process.env["DISPLAY"];
    const restorePlatform = overridePlatform("linux");
    try {
      const binDir = join(dir, "bin");
      mkdirSync(binDir);
      const screenshot = join(binDir, "gnome-screenshot");
      writeFileSync(screenshot, [
        "#!/bin/sh",
        "out=''",
        "while [ \"$#\" -gt 0 ]; do",
        "  if [ \"$1\" = '-f' ]; then shift; out=\"$1\"; fi",
        "  shift",
        "done",
        "printf 'sdk-shot' > \"$out\"",
      ].join("\n") + "\n");
      chmodSync(screenshot, 0o755);
      const wlPaste = join(binDir, "wl-paste");
      writeFileSync(wlPaste, "#!/bin/sh\n[ \"$1\" = '--no-newline' ] || exit 2\nprintf 'sdk clipboard'\n");
      chmodSync(wlPaste, 0o755);
      process.env["PATH"] = binDir;
      process.env["DISPLAY"] = ":99";

      const client = createClipClient({ homeDir: join(dir, "home"), baseUrl: "http://clip.test" });
      const captured = await client.captureScreenshot("full", { title: "SDK capture" });
      const clipboard = await client.shareClipboard("text", { title: "SDK clipboard" });

      expect(captured.source).toBe("capture:gnome-screenshot");
      expect(captured.title).toBe("SDK capture");
      expect(clipboard.text).toBe("sdk clipboard");
      expect(clipboard.title).toBe("SDK clipboard");
    } finally {
      restorePlatform();
      if (previousPath === undefined) {
        delete process.env["PATH"];
      } else {
        process.env["PATH"] = previousPath;
      }
      if (previousDisplay === undefined) {
        delete process.env["DISPLAY"];
      } else {
        process.env["DISPLAY"] = previousDisplay;
      }
      rmSync(dir, { recursive: true, force: true });
    }
  });
});
