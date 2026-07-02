import { existsSync } from "node:fs";
import { readConfig } from "./config.js";
import { captureScreenshot } from "./capture/index.js";
import { copyTextToClipboard, openLocalTarget } from "./capture/tools.js";
import { detectClipboardCapabilities, shareClipboard } from "./clipboard.js";
import { ClipStore } from "./storage.js";
import { buildShareUrl, resolveBaseUrl } from "./share.js";
import type { CaptureMode, ClipboardKind, ClipClientOptions, ClipRecord, ClipStatus } from "./types.js";
import { detectCaptureCapabilities } from "./capture/index.js";

export class ClipClient {
  readonly options: ClipClientOptions;

  constructor(options: ClipClientOptions = {}) {
    const config = readConfig(options);
    this.options = {
      ...config,
      ...options,
      baseUrl: options.baseUrl ?? config.baseUrl,
    };
  }

  createTextShare(text: string, options: { title?: string; metadata?: Record<string, unknown> } = {}): ClipRecord {
    const store = new ClipStore(this.options);
    try {
      return store.createTextClip({
        text,
        title: options.title,
        metadata: options.metadata,
        source: "sdk:text",
        baseUrl: this.options.baseUrl,
      });
    } finally {
      store.close();
    }
  }

  importFile(path: string, options: { title?: string; metadata?: Record<string, unknown> } = {}): ClipRecord {
    const store = new ClipStore(this.options);
    try {
      return store.createFileClip({
        path,
        title: options.title,
        metadata: options.metadata,
        source: "sdk:file",
        baseUrl: this.options.baseUrl,
      });
    } finally {
      store.close();
    }
  }

  async captureScreenshot(mode: CaptureMode = "full", options: { title?: string } = {}): Promise<ClipRecord> {
    return await captureScreenshot(mode, { ...this.options, title: options.title });
  }

  async shareClipboard(kind: ClipboardKind = "auto", options: { title?: string } = {}): Promise<ClipRecord> {
    return await shareClipboard(kind, { ...this.options, title: options.title });
  }

  listShares(options: { limit?: number; includeDeleted?: boolean } = {}): ClipRecord[] {
    const store = new ClipStore(this.options);
    try {
      return store.listClips({ ...options, baseUrl: this.options.baseUrl });
    } finally {
      store.close();
    }
  }

  getShare(ref: string, options: { includeDeleted?: boolean } = {}): ClipRecord | null {
    const store = new ClipStore(this.options);
    try {
      return store.getClip(ref, { ...options, baseUrl: this.options.baseUrl });
    } finally {
      store.close();
    }
  }

  deleteShare(ref: string): boolean {
    const store = new ClipStore(this.options);
    try {
      return store.deleteClip(ref);
    } finally {
      store.close();
    }
  }

  async copyLink(ref: string): Promise<{ record: ClipRecord; copied: boolean; command?: string; error?: string }> {
    const record = this.requireShare(ref);
    const link = buildShareUrl(record, this.options);
    const result = await copyTextToClipboard(link);
    return { record: { ...record, shareUrl: link }, copied: result.ok, command: result.command, error: result.error };
  }

  async openShare(ref: string): Promise<{ record: ClipRecord; opened: boolean; command?: string; error?: string; target: string }> {
    const record = this.requireShare(ref);
    const target = record.artifactPath && existsSync(record.artifactPath) ? record.artifactPath : buildShareUrl(record, this.options);
    const result = await openLocalTarget(target);
    return { record, opened: result.ok, command: result.command, error: result.error, target };
  }

  async status(): Promise<ClipStatus> {
    const store = new ClipStore(this.options);
    try {
      return {
        storage: store.status(),
        baseUrl: resolveBaseUrl(this.options),
        capture: await detectCaptureCapabilities(),
        clipboard: detectClipboardCapabilities(),
      };
    } finally {
      store.close();
    }
  }

  private requireShare(ref: string): ClipRecord {
    const record = this.getShare(ref);
    if (!record) throw new Error(`Share not found: ${ref}`);
    return record;
  }
}

export function createClipClient(options: ClipClientOptions = {}): ClipClient {
  return new ClipClient(options);
}
