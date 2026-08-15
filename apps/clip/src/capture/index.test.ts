import { describe, expect, it } from "bun:test";
import { chmodSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { captureScreenshot, detectCaptureCapabilities } from "./index.js";

async function withPlatform<T>(platform: NodeJS.Platform, callback: () => Promise<T>): Promise<T> {
  const descriptor = Object.getOwnPropertyDescriptor(process, "platform");
  Object.defineProperty(process, "platform", { value: platform, configurable: true });
  try {
    return await callback();
  } finally {
    if (descriptor) Object.defineProperty(process, "platform", descriptor);
  }
}

function restorePath(previousPath: string | undefined): void {
  if (previousPath === undefined) {
    delete process.env["PATH"];
  } else {
    process.env["PATH"] = previousPath;
  }
}

function writeFakePowerShell(binDir: string): void {
  const powershell = join(binDir, "powershell.exe");
  writeFileSync(powershell, `#!/usr/bin/env bun
const args = process.argv.slice(2);
const fileIndex = args.indexOf("-File");
if (fileIndex < 0) process.exit(6);
const command = await Bun.file(args[fileIndex + 1]).text();
const scriptArgs = args.slice(fileIndex + 2);
if (command.includes("VirtualScreen")) {
  const outputPath = scriptArgs.find((arg) => arg.endsWith(".png"));
  if (!outputPath) process.exit(5);
  await Bun.write(outputPath, "fake-windows-screenshot");
  process.exit(0);
}
process.stderr.write("unexpected PowerShell script");
process.exit(9);
`);
  chmodSync(powershell, 0o755);
}

describe("Windows screenshot capture", () => {
  it("reports full-screen capability when PowerShell is available", async () => {
    const dir = mkdtempSync(join(tmpdir(), "clip-capture-windows-capability-"));
    const previousPath = process.env["PATH"];
    try {
      const binDir = join(dir, "bin");
      mkdirSync(binDir);
      writeFakePowerShell(binDir);
      process.env["PATH"] = binDir;

      await withPlatform("win32", async () => {
        const capabilities = await detectCaptureCapabilities();

        expect(capabilities.platform).toBe("win32");
        expect(capabilities.tools["powershell.exe"]).toBe(true);
        expect(capabilities.modes.full).toBe(true);
        expect(capabilities.modes.window).toBe(false);
        expect(capabilities.modes.region).toBe(false);
        expect(capabilities.activeWindow.available).toBe(false);
      });
    } finally {
      restorePath(previousPath);
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it("captures a Windows full screenshot through PowerShell and stores a share", async () => {
    const dir = mkdtempSync(join(tmpdir(), "clip-capture-windows-"));
    const previousPath = process.env["PATH"];
    try {
      const binDir = join(dir, "bin");
      mkdirSync(binDir);
      writeFakePowerShell(binDir);
      process.env["PATH"] = binDir;

      await withPlatform("win32", async () => {
        const record = await captureScreenshot("full", {
          homeDir: join(dir, "home"),
          baseUrl: "http://clip.test",
        });

        expect(record.kind).toBe("screenshot");
        expect(record.source).toBe("capture:powershell.exe");
        expect(record.mimeType).toBe("image/png");
        expect(record.sizeBytes).toBe("fake-windows-screenshot".length);
        expect(record.metadata.mode).toBe("full");
        expect(record.metadata.args).toEqual(["-Sta", "-File", "<windows-fullscreen-screenshot.ps1>", "<output.png>"]);
        expect(record.shareUrl).toStartWith("http://clip.test/s/");
      });
    } finally {
      restorePath(previousPath);
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it("keeps Windows screenshot capability disabled when PowerShell is absent", async () => {
    const dir = mkdtempSync(join(tmpdir(), "clip-capture-windows-absent-"));
    const previousPath = process.env["PATH"];
    try {
      process.env["PATH"] = dir;

      await withPlatform("win32", async () => {
        const capabilities = await detectCaptureCapabilities();

        expect(capabilities.modes.full).toBe(false);
        await expect(captureScreenshot("full", { homeDir: join(dir, "home") })).rejects.toThrow("unavailable");
      });
    } finally {
      restorePath(previousPath);
      rmSync(dir, { recursive: true, force: true });
    }
  });
});
