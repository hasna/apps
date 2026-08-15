import { describe, expect, it } from "bun:test";
import { chmodSync, existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { captureScreenshot, detectActiveWindow, detectCaptureCapabilities } from "./index.js";

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

function writeTool(binDir: string, name: string, body: string): string {
  const path = join(binDir, name);
  writeFileSync(path, `#!/bin/sh\n${body}`);
  chmodSync(path, 0o755);
  return path;
}

describe("screenshot capture", () => {
  it("detects Wayland/X11 Linux capture tools and active windows", async () => {
    const dir = mkdtempSync(join(tmpdir(), "clip-capture-detect-"));
    const previousPath = process.env["PATH"];
    const previousWayland = process.env["WAYLAND_DISPLAY"];
    const restorePlatform = overridePlatform("linux");
    try {
      const binDir = join(dir, "bin");
      mkdirSync(binDir);
      writeTool(binDir, "gnome-screenshot", "exit 0\n");
      writeTool(binDir, "xdotool", "printf 'Focused Window\\n'\n");
      process.env["PATH"] = binDir;
      process.env["WAYLAND_DISPLAY"] = "wayland-9";

      const activeWindow = await detectActiveWindow();
      const capabilities = await detectCaptureCapabilities();

      expect(activeWindow).toEqual({ available: true, title: "Focused Window" });
      expect(capabilities.tools["display-session"]).toBe(true);
      expect(capabilities.modes).toEqual({ full: true, window: true, region: true });
      expect(capabilities.activeWindow.title).toBe("Focused Window");
    } finally {
      restorePlatform();
      restoreEnv("PATH", previousPath);
      restoreEnv("WAYLAND_DISPLAY", previousWayland);
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it("reports xdotool failures without throwing", async () => {
    const dir = mkdtempSync(join(tmpdir(), "clip-capture-active-fail-"));
    const previousPath = process.env["PATH"];
    const restorePlatform = overridePlatform("linux");
    try {
      const binDir = join(dir, "bin");
      mkdirSync(binDir);
      writeTool(binDir, "xdotool", "printf 'window unavailable' >&2\nexit 3\n");
      process.env["PATH"] = binDir;

      expect(await detectActiveWindow()).toEqual({ available: false, reason: "window unavailable" });
    } finally {
      restorePlatform();
      restoreEnv("PATH", previousPath);
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it("captures Linux full-screen screenshots through grim when gnome-screenshot is absent", async () => {
    const dir = mkdtempSync(join(tmpdir(), "clip-capture-grim-"));
    const previousPath = process.env["PATH"];
    const previousDisplay = process.env["DISPLAY"];
    const restorePlatform = overridePlatform("linux");
    try {
      const binDir = join(dir, "bin");
      mkdirSync(binDir);
      writeTool(binDir, "grim", "printf 'grim-bytes' > \"$1\"\n");
      process.env["PATH"] = binDir;
      process.env["DISPLAY"] = ":99";

      const record = await captureScreenshot("full", {
        homeDir: join(dir, "home"),
        baseUrl: "http://clip.test",
      });

      expect(record.kind).toBe("screenshot");
      expect(record.source).toBe("capture:grim");
      expect(record.title).toBe("Full screenshot");
      expect(record.metadata.command).toBe("grim");
      expect(record.metadata.mode).toBe("full");
      expect(record.shareUrl).toStartWith("http://clip.test/s/");
      expect(record.artifactPath && existsSync(record.artifactPath)).toBe(true);
      expect(readFileSync(record.artifactPath!, "utf8")).toBe("grim-bytes");
    } finally {
      restorePlatform();
      restoreEnv("PATH", previousPath);
      restoreEnv("DISPLAY", previousDisplay);
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it("falls back to scrot for Linux full-screen screenshots", async () => {
    const dir = mkdtempSync(join(tmpdir(), "clip-capture-scrot-"));
    const previousPath = process.env["PATH"];
    const previousDisplay = process.env["DISPLAY"];
    const restorePlatform = overridePlatform("linux");
    try {
      const binDir = join(dir, "bin");
      mkdirSync(binDir);
      writeTool(binDir, "scrot", "printf 'scrot-bytes' > \"$1\"\n");
      process.env["PATH"] = binDir;
      process.env["DISPLAY"] = ":99";

      const record = await captureScreenshot("full", {
        homeDir: join(dir, "home"),
        title: "Fallback shot",
      });

      expect(record.source).toBe("capture:scrot");
      expect(record.title).toBe("Fallback shot");
      expect(record.sizeBytes).toBe("scrot-bytes".length);
    } finally {
      restorePlatform();
      restoreEnv("PATH", previousPath);
      restoreEnv("DISPLAY", previousDisplay);
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it("captures Linux window screenshots through gnome-screenshot", async () => {
    const dir = mkdtempSync(join(tmpdir(), "clip-capture-gnome-"));
    const previousPath = process.env["PATH"];
    const previousDisplay = process.env["DISPLAY"];
    const restorePlatform = overridePlatform("linux");
    try {
      const binDir = join(dir, "bin");
      mkdirSync(binDir);
      writeTool(binDir, "gnome-screenshot", [
        "out=''",
        "window='no'",
        "while [ \"$#\" -gt 0 ]; do",
        "  if [ \"$1\" = '-w' ]; then window='yes'; fi",
        "  if [ \"$1\" = '-f' ]; then shift; out=\"$1\"; fi",
        "  shift",
        "done",
        "[ \"$window\" = 'yes' ] || exit 4",
        "printf 'gnome-window' > \"$out\"",
      ].join("\n") + "\n");
      writeTool(binDir, "xdotool", "printf 'Terminal\\n'\n");
      process.env["PATH"] = binDir;
      process.env["DISPLAY"] = ":99";

      const record = await captureScreenshot("window", { homeDir: join(dir, "home") });

      expect(record.source).toBe("capture:gnome-screenshot");
      expect(record.metadata.args).toEqual(["-w", "-f", expect.any(String)]);
      expect(record.metadata.activeWindow).toEqual({ available: true, title: "Terminal" });
      expect(readFileSync(record.artifactPath!, "utf8")).toBe("gnome-window");
    } finally {
      restorePlatform();
      restoreEnv("PATH", previousPath);
      restoreEnv("DISPLAY", previousDisplay);
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it("captures Linux full and region screenshots through gnome-screenshot", async () => {
    const dir = mkdtempSync(join(tmpdir(), "clip-capture-gnome-modes-"));
    const previousPath = process.env["PATH"];
    const previousDisplay = process.env["DISPLAY"];
    const restorePlatform = overridePlatform("linux");
    try {
      const binDir = join(dir, "bin");
      mkdirSync(binDir);
      writeTool(binDir, "gnome-screenshot", [
        "out=''",
        "mode='full'",
        "while [ \"$#\" -gt 0 ]; do",
        "  if [ \"$1\" = '-a' ]; then mode='region'; fi",
        "  if [ \"$1\" = '-f' ]; then shift; out=\"$1\"; fi",
        "  shift",
        "done",
        "printf \"%s\" \"$mode\" > \"$out\"",
      ].join("\n") + "\n");
      process.env["PATH"] = binDir;
      process.env["DISPLAY"] = ":99";

      const full = await captureScreenshot("full", { homeDir: join(dir, "home-full") });
      const region = await captureScreenshot("region", { homeDir: join(dir, "home-region") });

      expect(full.metadata.args).toEqual(["-f", expect.any(String)]);
      expect(readFileSync(full.artifactPath!, "utf8")).toBe("full");
      expect(region.metadata.args).toEqual(["-a", "-f", expect.any(String)]);
      expect(readFileSync(region.artifactPath!, "utf8")).toBe("region");
    } finally {
      restorePlatform();
      restoreEnv("PATH", previousPath);
      restoreEnv("DISPLAY", previousDisplay);
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it("rejects unavailable capture modes before invoking commands", async () => {
    const dir = mkdtempSync(join(tmpdir(), "clip-capture-unavailable-"));
    const previousPath = process.env["PATH"];
    const previousDisplay = process.env["DISPLAY"];
    const restorePlatform = overridePlatform("linux");
    try {
      const binDir = join(dir, "bin");
      mkdirSync(binDir);
      writeTool(binDir, "grim", "exit 9\n");
      process.env["PATH"] = binDir;
      process.env["DISPLAY"] = ":99";

      await expect(captureScreenshot("window", { homeDir: join(dir, "home") })).rejects.toThrow("unavailable");
    } finally {
      restorePlatform();
      restoreEnv("PATH", previousPath);
      restoreEnv("DISPLAY", previousDisplay);
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it("captures macOS screenshots and active application details through screencapture and osascript", async () => {
    const dir = mkdtempSync(join(tmpdir(), "clip-capture-macos-"));
    const previousPath = process.env["PATH"];
    const restorePlatform = overridePlatform("darwin");
    try {
      const binDir = join(dir, "bin");
      mkdirSync(binDir);
      writeTool(binDir, "osascript", "printf 'Safari\\n'\n");
      writeTool(binDir, "screencapture", [
        "out=''",
        "for arg do out=\"$arg\"; done",
        "printf 'mac-region' > \"$out\"",
      ].join("\n") + "\n");
      process.env["PATH"] = binDir;

      const capabilities = await detectCaptureCapabilities();
      const record = await captureScreenshot("region", { homeDir: join(dir, "home-region") });
      const full = await captureScreenshot("full", { homeDir: join(dir, "home-full") });

      expect(capabilities.modes.region).toBe(true);
      expect(capabilities.activeWindow).toEqual({ available: true, app: "Safari", title: "Safari" });
      expect(record.source).toBe("capture:screencapture");
      expect(record.metadata.args).toEqual(["-x", "-i", expect.any(String)]);
      expect(record.metadata.activeWindow).toEqual({ available: true, app: "Safari", title: "Safari" });
      expect(readFileSync(record.artifactPath!, "utf8")).toBe("mac-region");
      expect(full.metadata.args).toEqual(["-x", expect.any(String)]);
    } finally {
      restorePlatform();
      restoreEnv("PATH", previousPath);
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it("reports missing macOS active-window tooling", async () => {
    const dir = mkdtempSync(join(tmpdir(), "clip-capture-macos-missing-"));
    const previousPath = process.env["PATH"];
    const restorePlatform = overridePlatform("darwin");
    try {
      const binDir = join(dir, "bin");
      mkdirSync(binDir);
      process.env["PATH"] = binDir;

      expect(await detectActiveWindow()).toEqual({ available: false, reason: "osascript is not installed" });
    } finally {
      restorePlatform();
      restoreEnv("PATH", previousPath);
      rmSync(dir, { recursive: true, force: true });
    }
  });
});
