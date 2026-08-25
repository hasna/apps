/**
 * The session WAL (slice C) — append-only JSONL journal with per-entry
 * sha256 checksums.
 *
 * Every durable lifecycle fact (run started/finished, node started/finished,
 * memo set, claim acquired/released) is appended here BEFORE it is acted on.
 * On open, replay() verifies every line's checksum and truncates the first
 * torn tail it finds (a partial write or a corrupted line): the WAL is
 * self-repairing, and replay() reports what it repaired so callers can run
 * torn-run repair with the reconstructed claim state.
 */
import { createHash } from "node:crypto";
import { appendFileSync, mkdirSync, readFileSync, truncateSync, writeFileSync } from "node:fs";
import { join } from "node:path";

export interface ClaimOp {
  op: "claim_acquired";
  runId: string;
  worker: string;
  expiresAt: string;
  fencing: number;
  at: string;
}

export interface ReleaseOp {
  op: "claim_released";
  runId: string;
  fencing: number;
  at: string;
}

export type WalOp =
  | { op: "run_started"; runId: string; at: string }
  | { op: "run_finished"; runId: string; status: string; at: string }
  | { op: "node_started"; runId: string; nodeId: string; at: string }
  | { op: "node_finished"; runId: string; nodeId: string; status: string; at: string }
  | { op: "memo_set"; key: string; at: string }
  | ClaimOp
  | ReleaseOp;

export interface WalEntry {
  seq: number;
  at: string;
  checksum: string;
  op: WalOp;
}

export interface LiveClaim {
  worker: string;
  fencing: number;
  expiresAtMs: number;
}

export interface WalReplay {
  entries: WalEntry[];
  /** True when the file contained a torn tail (partial or corrupt line). */
  torn: boolean;
  /** True when the torn tail was truncated away. */
  repaired: boolean;
  /** Reconstructed live claims from claim_acquired/claim_released pairs. */
  liveClaims(nowMs?: number): Map<string, LiveClaim>;
}

export const WAL_FILE_NAME = "session.wal";
const MAX_WAL_BYTES = 256 * 1024 * 1024;

function checksumOf(op: WalOp): string {
  if (op === undefined || op === null) return "";
  return createHash("sha256").update(JSON.stringify(op)).digest("hex");
}

export class SessionWAL {
  readonly filePath: string;

  private constructor(filePath: string) {
    this.filePath = filePath;
  }

  static open(dataDir: string): SessionWAL {
    mkdirSync(dataDir, { recursive: true });
    // open does NOT replay: the first replay() (or append(), which replays to
    // compute the next seq) detects and truncates any torn tail, and reports
    // it — an open that silently repaired would hide the torn signal.
    return new SessionWAL(join(dataDir, WAL_FILE_NAME));
  }

  static openAt(filePath: string): SessionWAL {
    return new SessionWAL(filePath);
  }

  /** Append one op and return the persisted entry (seq is 1-based). */
  append(op: WalOp): WalEntry {
    const at = op.at ?? new Date().toISOString();
    const full: WalOp = { ...op, at };
    const nextSeq = this.nextSeq();
    const entry: WalEntry = { seq: nextSeq, at, checksum: checksumOf(full), op: full };
    appendFileSync(this.filePath, JSON.stringify(entry) + "\n", "utf8");
    return entry;
  }

  private nextSeq(): number {
    const replay = this.replay();
    return replay.entries.length + 1;
  }

  /** Read and verify the whole WAL; truncate the first torn tail. */
  replay(): WalReplay {
    const entries: WalEntry[] = [];
    let torn = false;
    let repaired = false;
    let content: string;
    try {
      content = readFileSync(this.filePath, "utf8");
    } catch {
      // no WAL yet
      return { entries, torn, repaired, liveClaims: () => new Map() };
    }
    if (content.length > MAX_WAL_BYTES) {
      // unreadably large is a defect: fail loudly rather than silently replaying a prefix
      throw new Error(`session WAL exceeds ${MAX_WAL_BYTES} bytes; refusing to replay a truncated journal`);
    }
    if (content === "") {
      return { entries, torn, repaired, liveClaims: () => new Map() };
    }
    const lines = content.split("\n");
    let badOffset: number | null = null;
    let expectedSeq = 1;
    for (let i = 0; i < lines.length; i++) {
      const line = lines[i];
      if (line === "") continue; // trailing newline
      if (badOffset !== null) break;
      const lineOffset = cumulativeOffset(lines, i);
      let entry: WalEntry;
      try {
        entry = JSON.parse(line) as WalEntry;
      } catch {
        badOffset = lineOffset;
        break;
      }
      if (typeof entry?.seq !== "number" || entry.seq !== expectedSeq || entry.checksum !== checksumOf(entry.op as WalOp)) {
        badOffset = lineOffset;
        break;
      }
      entries.push(entry);
      expectedSeq++;
    }
    if (badOffset !== null) {
      torn = true;
      try {
        truncateSync(this.filePath, badOffset);
        repaired = true;
      } catch {
        // truncation failed — report the torn state and let the caller decide
      }
    }
    return {
      entries,
      torn,
      repaired,
      liveClaims: (nowMs?: number) => reconstructLiveClaims(entries, nowMs),
    };
  }

  close(): void {
    // WAL is append-only on disk; nothing to flush beyond the sync write
  }
}

function cumulativeOffset(lines: string[], index: number): number {
  // the byte offset where line `index` starts (accounting for the \n separators)
  let offset = 0;
  for (let i = 0; i < index; i++) {
    offset += Buffer.byteLength(lines[i]) + 1;
  }
  return offset;
}

function reconstructLiveClaims(entries: WalEntry[], nowMs = Date.now()): Map<string, LiveClaim> {
  const claims = new Map<string, LiveClaim>();
  for (const entry of entries) {
    const op = entry.op;
    if (op.op === "claim_acquired") {
      claims.set(op.runId, { worker: op.worker, fencing: op.fencing, expiresAtMs: Date.parse(op.expiresAt) });
    } else if (op.op === "claim_released") {
      const existing = claims.get(op.runId);
      if (existing && existing.fencing === op.fencing) {
        claims.delete(op.runId);
      }
    }
  }
  for (const [runId, claim] of claims) {
    if (claim.expiresAtMs <= nowMs) claims.delete(runId);
  }
  return claims;
}

/** Write a fresh (empty) WAL — used by tests and by init. */
export function resetWal(filePath: string): void {
  writeFileSync(filePath, "", "utf8");
}
