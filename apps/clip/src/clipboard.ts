import { existsSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { ClipStore } from "./storage.js";
import type { ClipboardCapabilities, ClipboardHistoryKind, ClipboardHistoryRecord, ClipboardKind, ClipClientOptions, ClipRecord, JsonObject } from "./types.js";
import { commandExists, runCommand, runCommandBytes } from "./capture/tools.js";

const CLIPBOARD_TOOLS = ["pbpaste", "pngpaste", "osascript", "wl-paste", "wl-copy", "xclip"] as const;

export function detectClipboardCapabilities(): ClipboardCapabilities {
  const tools = Object.fromEntries(CLIPBOARD_TOOLS.map((tool) => [tool, commandExists(tool)])) as Record<string, boolean>;
  return {
    platform: process.platform,
    tools,
    supports: {
      text: Boolean((process.platform === "darwin" && tools["pbpaste"]) || tools["wl-paste"] || tools["xclip"]),
      image: Boolean(tools["pngpaste"] || tools["wl-paste"] || tools["xclip"]),
      file: Boolean(tools["wl-paste"]),
    },
  };
}

interface ClipboardPayload {
  kind: ClipboardHistoryKind;
  title: string;
  mimeType?: string;
  source: string;
  metadata: JsonObject;
  text?: string;
  buffer?: Uint8Array;
  path?: string;
  extension?: string;
}

async function readClipboardText(): Promise<string | null> {
  if (process.platform === "darwin" && commandExists("pbpaste")) {
    const result = await runCommand("pbpaste");
    return result.ok && result.stdout.length ? result.stdout : null;
  }
  if (commandExists("wl-paste")) {
    const result = await runCommand("wl-paste", ["--no-newline"]);
    return result.ok && result.stdout.length ? result.stdout : null;
  }
  if (commandExists("xclip")) {
    const result = await runCommand("xclip", ["-selection", "clipboard", "-o"]);
    return result.ok && result.stdout.length ? result.stdout : null;
  }
  return null;
}

async function readClipboardImage(): Promise<{ bytes: Uint8Array; mimeType: string; source: string } | null> {
  if (commandExists("pngpaste")) {
    const { result, bytes } = await runCommandBytes("pngpaste", ["-"]);
    if (result.ok && bytes.byteLength > 0) return { bytes, mimeType: "image/png", source: "clipboard:pngpaste" };
  }
  if (commandExists("wl-paste")) {
    const { result, bytes } = await runCommandBytes("wl-paste", ["--type", "image/png"]);
    if (result.ok && bytes.byteLength > 0) return { bytes, mimeType: "image/png", source: "clipboard:wl-paste" };
  }
  if (commandExists("xclip")) {
    const { result, bytes } = await runCommandBytes("xclip", ["-selection", "clipboard", "-t", "image/png", "-o"]);
    if (result.ok && bytes.byteLength > 0) return { bytes, mimeType: "image/png", source: "clipboard:xclip" };
  }
  return null;
}

function uriListToPath(text: string): string | null {
  for (const rawLine of text.split(/\r?\n/)) {
    const line = rawLine.trim();
    if (!line || line.startsWith("#")) continue;
    if (line.startsWith("file://")) {
      try {
        const path = fileURLToPath(line);
        if (existsSync(path)) return path;
      } catch {
        continue;
      }
    }
    if (existsSync(line)) return line;
  }
  return null;
}

async function readClipboardFilePath(): Promise<string | null> {
  if (commandExists("wl-paste")) {
    const result = await runCommand("wl-paste", ["--type", "text/uri-list"]);
    if (result.ok) {
      const path = uriListToPath(result.stdout);
      if (path) return path;
    }
  }
  const text = await readClipboardText();
  return text ? uriListToPath(text) : null;
}

async function readClipboardPayload(kind: ClipboardKind, title?: string): Promise<ClipboardPayload> {
  if (kind === "auto" || kind === "file") {
    const path = await readClipboardFilePath();
    if (path) {
      return {
        kind: "clipboard-file",
        title: title ?? "Clipboard file",
        path,
        source: "clipboard:file",
        metadata: { clipboardKind: "file", bestEffort: true },
      };
    }
    if (kind === "file") throw new Error("Clipboard does not contain a readable file path.");
  }

  if (kind === "auto" || kind === "image") {
    const image = await readClipboardImage();
    if (image) {
      return {
        kind: "clipboard-image",
        title: title ?? "Clipboard image",
        mimeType: image.mimeType,
        buffer: image.bytes,
        source: image.source,
        metadata: { clipboardKind: "image", bestEffort: true },
        extension: ".png",
      };
    }
    if (kind === "image") throw new Error("Clipboard image capture is unavailable or empty.");
  }

  if (kind === "auto" || kind === "text") {
    const text = await readClipboardText();
    if (text) {
      return {
        kind: "clipboard-text",
        title: title ?? "Clipboard text",
        mimeType: "text/plain; charset=utf-8",
        text,
        source: "clipboard:text",
        metadata: { clipboardKind: "text", bestEffort: true },
      };
    }
  }

  throw new Error("Clipboard content could not be read with the available platform tools.");
}

export async function captureClipboardHistory(
  kind: ClipboardKind = "auto",
  options: ClipClientOptions & { title?: string; maxItems?: number } = {},
): Promise<ClipboardHistoryRecord> {
  const payload = await readClipboardPayload(kind, options.title);
  const store = new ClipStore(options);
  try {
    return store.addClipboardHistory({
      kind: payload.kind,
      title: payload.title,
      text: payload.text,
      buffer: payload.buffer,
      path: payload.path,
      mimeType: payload.mimeType,
      source: payload.source,
      metadata: payload.metadata,
      extension: payload.extension,
      maxItems: options.maxItems,
    });
  } finally {
    store.close();
  }
}

export async function shareClipboard(
  kind: ClipboardKind = "auto",
  options: ClipClientOptions & { title?: string; baseUrl?: string } = {},
): Promise<ClipRecord> {
  const payload = await readClipboardPayload(kind, options.title);
  const store = new ClipStore(options);
  try {
    if (payload.path) {
      return store.createFileClip({
        path: payload.path,
        title: options.title,
        kind: "clipboard-file",
        source: payload.source,
        metadata: payload.metadata,
        baseUrl: options.baseUrl,
      });
    }
    if (payload.buffer) {
      if (!payload.mimeType) throw new Error("Clipboard buffer content is missing a MIME type.");
      return store.createBufferClip({
        buffer: payload.buffer,
        kind: payload.kind,
        title: payload.title,
        mimeType: payload.mimeType,
        source: payload.source,
        metadata: payload.metadata,
        extension: payload.extension,
        baseUrl: options.baseUrl,
      });
    }
    if (payload.text !== undefined) {
      return store.createTextClip({
        text: payload.text,
        title: payload.title,
        source: payload.source,
        metadata: payload.metadata,
        baseUrl: options.baseUrl,
      });
    }
    throw new Error("Clipboard content could not be shared with the available platform tools.");
  } finally {
    store.close();
  }
}
