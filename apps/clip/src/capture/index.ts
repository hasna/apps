import { existsSync, mkdtempSync, unlinkSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { ClipStore } from "../storage.js";
import type { CaptureAnnotation, CaptureCapabilities, CaptureMode, ClipClientOptions, ClipRecord, JsonObject } from "../types.js";
import { applyCaptureAnnotationsToFile, validateCaptureAnnotations } from "./annotate.js";
import { commandExists, runCommand } from "./tools.js";

const CAPTURE_TOOLS = ["screencapture", "gnome-screenshot", "grim", "scrot", "xdotool", "osascript"] as const;

export async function detectActiveWindow(): Promise<CaptureCapabilities["activeWindow"]> {
  if (process.platform === "darwin") {
    if (!commandExists("osascript")) return { available: false, reason: "osascript is not installed" };
    const result = await runCommand("osascript", [
      "-e",
      'tell application "System Events" to get name of first application process whose frontmost is true',
    ]);
    if (!result.ok) return { available: false, reason: result.stderr.trim() || "frontmost app unavailable" };
    const app = result.stdout.trim();
    return app ? { available: true, app, title: app } : { available: false, reason: "frontmost app was empty" };
  }

  if (commandExists("xdotool")) {
    const result = await runCommand("xdotool", ["getactivewindow", "getwindowname"]);
    if (result.ok && result.stdout.trim()) return { available: true, title: result.stdout.trim() };
    return { available: false, reason: result.stderr.trim() || "xdotool could not read active window" };
  }

  return { available: false, reason: "active window detection requires osascript on macOS or xdotool on Linux" };
}

export async function detectCaptureCapabilities(): Promise<CaptureCapabilities> {
  const tools = Object.fromEntries(CAPTURE_TOOLS.map((tool) => [tool, commandExists(tool)])) as Record<string, boolean>;
  const hasLinuxDisplay = Boolean(process.env["DISPLAY"] || process.env["WAYLAND_DISPLAY"]);
  if (process.platform === "linux") tools["display-session"] = hasLinuxDisplay;
  const mac = process.platform === "darwin" && tools["screencapture"];
  const linuxFull = process.platform === "linux" && hasLinuxDisplay && (tools["gnome-screenshot"] || tools["grim"] || tools["scrot"]);
  const linuxInteractive = process.platform === "linux" && hasLinuxDisplay && Boolean(tools["gnome-screenshot"]);
  return {
    platform: process.platform,
    tools,
    modes: {
      full: Boolean(mac || linuxFull),
      window: Boolean(mac || linuxInteractive),
      region: Boolean(mac || linuxInteractive),
    },
    activeWindow: await detectActiveWindow(),
  };
}

function captureCommand(mode: CaptureMode, outputPath: string): { command: string; args: string[] } | null {
  if (process.platform === "darwin" && commandExists("screencapture")) {
    if (mode === "window") return { command: "screencapture", args: ["-x", "-w", outputPath] };
    if (mode === "region") return { command: "screencapture", args: ["-x", "-i", outputPath] };
    return { command: "screencapture", args: ["-x", outputPath] };
  }

  if (process.platform === "linux" && commandExists("gnome-screenshot")) {
    if (mode === "window") return { command: "gnome-screenshot", args: ["-w", "-f", outputPath] };
    if (mode === "region") return { command: "gnome-screenshot", args: ["-a", "-f", outputPath] };
    return { command: "gnome-screenshot", args: ["-f", outputPath] };
  }

  if (process.platform === "linux" && mode === "full" && commandExists("grim")) {
    return { command: "grim", args: [outputPath] };
  }

  if (process.platform === "linux" && mode === "full" && commandExists("scrot")) {
    return { command: "scrot", args: [outputPath] };
  }

  return null;
}

export async function captureScreenshot(
  mode: CaptureMode = "full",
  options: ClipClientOptions & { title?: string; baseUrl?: string; annotations?: CaptureAnnotation[] } = {},
): Promise<ClipRecord> {
  const annotations = validateCaptureAnnotations(options.annotations);
  const capabilities = await detectCaptureCapabilities();
  if (!capabilities.modes[mode]) {
    throw new Error(`Screenshot mode '${mode}' is unavailable on ${process.platform}. Run clip doctor for details.`);
  }
  const dir = mkdtempSync(join(tmpdir(), "clip-capture-"));
  const outputPath = join(dir, "screenshot.png");
  const cleanupPaths = new Set([outputPath]);
  const command = captureCommand(mode, outputPath);
  if (!command) throw new Error(`No capture command found for mode '${mode}'.`);
  const result = await runCommand(command.command, command.args);
  if (!result.ok) throw new Error(result.stderr.trim() || `${command.command} exited ${result.exitCode}`);
  if (!existsSync(outputPath)) throw new Error(`${command.command} did not produce a screenshot file.`);
  const store = new ClipStore(options);
  try {
    const activeWindow = await detectActiveWindow();
    let artifactPath = outputPath;
    let annotationMetadata: JsonObject | undefined;
    if (annotations.length > 0) {
      const annotatedPath = join(dir, "screenshot-annotated.png");
      const annotation = applyCaptureAnnotationsToFile(outputPath, annotatedPath, annotations);
      artifactPath = annotation.outputPath;
      cleanupPaths.add(annotatedPath);
      annotationMetadata = {
        applied: true,
        operations: annotation.operations,
        originalWidth: annotation.originalWidth,
        originalHeight: annotation.originalHeight,
        width: annotation.width,
        height: annotation.height,
      };
    }
    return store.createFileClip({
      path: artifactPath,
      title: options.title ?? (mode === "full" ? "Full screenshot" : `${mode} screenshot`),
      kind: "screenshot",
      mimeType: "image/png",
      source: `capture:${command.command}`,
      metadata: {
        mode,
        command: command.command,
        args: command.args,
        activeWindow,
        bestEffort: true,
        annotations: annotationMetadata,
      },
      baseUrl: options.baseUrl,
    });
  } finally {
    store.close();
    for (const path of cleanupPaths) {
      try {
        unlinkSync(path);
      } catch {
        // Temporary capture cleanup is best-effort.
      }
    }
  }
}
