import { describe, expect, it } from "bun:test";
import { chmodSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { detectClipboardCapabilities, shareClipboard } from "./clipboard.js";

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
});
