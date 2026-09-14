import { lstatSync, statSync, mkdtempSync, writeFileSync, linkSync, rmSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { createHash } from "node:crypto";
import { RecordingsSDKError } from "../hosted/transport.js";
import type { HostedTranscriptExport } from "../hosted/library.js";

/** Validate without creating anything; the final exclusive link also handles a racing destination. */
export function transcriptDestination(value: string): string {
  try {
    if (typeof value !== "string" || !value.trim() || value.includes("\0")) throw Error();
    const path = resolve(value);
    if (lstatSync(path, { throwIfNoEntry: false }) || !statSync(dirname(path)).isDirectory()) throw Error();
    return path;
  } catch { throw new RecordingsSDKError("invalid_input"); }
}

/** Publish complete UTF-8 bytes atomically; existing files, symlinks and directories are never replaced. */
export function writeTranscriptExport(value: HostedTranscriptExport, path: string) {
  let stage: string | undefined;
  try {
    const bytes = Buffer.from(value.text, "utf8");
    stage = mkdtempSync(join(dirname(path), ".recordings-export-"));
    const temporary = join(stage, "transcript.txt");
    writeFileSync(temporary, bytes, { flag: "wx", mode: 0o600 });
    linkSync(temporary, path);
    return { recordingId: value.recordingId, format: "txt", byteLength: bytes.length,
      sha256: createHash("sha256").update(bytes).digest("hex"), saved: true };
  } catch { throw new RecordingsSDKError("invalid_input"); }
  finally { if (stage) { try { rmSync(stage, { recursive: true, force: true }); } catch {} } }
}
