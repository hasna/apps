export type JsonObject = Record<string, unknown>;

export type CaptureMode = "full" | "window" | "region";

export type ClipboardKind = "auto" | "text" | "image" | "file";

export type ClipboardHistoryKind = "clipboard-text" | "clipboard-image" | "clipboard-file";

export type ClipKind =
  | "screenshot"
  | "clipboard-text"
  | "clipboard-image"
  | "clipboard-file"
  | "file"
  | "text";

export interface ClipClientOptions {
  homeDir?: string;
  dbPath?: string;
  artifactDir?: string;
  baseUrl?: string;
  host?: string;
  port?: number;
}

export interface ClipRecord {
  id: string;
  slug: string;
  kind: ClipKind;
  title: string | null;
  mimeType: string;
  artifactPath: string | null;
  text: string | null;
  sizeBytes: number;
  sha256: string;
  source: string;
  metadata: JsonObject;
  createdAt: string;
  updatedAt: string;
  deletedAt: string | null;
  shareUrl?: string;
}

export interface ClipboardHistoryRecord {
  id: string;
  slug: string;
  kind: ClipboardHistoryKind;
  title: string | null;
  mimeType: string;
  artifactPath: string | null;
  text: string | null;
  sizeBytes: number;
  sha256: string;
  source: string;
  metadata: JsonObject;
  createdAt: string;
}

export interface CreateClipMetadata {
  title?: string;
  kind?: ClipKind;
  mimeType?: string;
  source?: string;
  metadata?: JsonObject;
  baseUrl?: string;
}

export interface ClipStorageStatus {
  homeDir: string;
  dbPath: string;
  artifactDir: string;
  totalActive: number;
  deleted: number;
}

export interface CaptureCapabilities {
  platform: NodeJS.Platform;
  tools: Record<string, boolean>;
  modes: Record<CaptureMode, boolean>;
  activeWindow: {
    available: boolean;
    title?: string;
    app?: string;
    reason?: string;
  };
}

export interface ClipboardCapabilities {
  platform: NodeJS.Platform;
  tools: Record<string, boolean>;
  supports: {
    text: boolean;
    image: boolean;
    file: boolean;
  };
}

export interface ClipStatus {
  storage: ClipStorageStatus;
  baseUrl: string;
  capture: CaptureCapabilities;
  clipboard: ClipboardCapabilities;
}
