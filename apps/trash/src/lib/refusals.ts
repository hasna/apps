/**
 * Capture refusals — the record that makes §11.7 auditable.
 *
 * §11.7 (binding): if we cannot capture a path, we do not delete it — UNLESS
 * the path matches an `excludeGlobs` entry, in which case the delete proceeds
 * and the refusal is recorded. Both halves are recorded here: a refusal the
 * operator never sees is indistinguishable from a delete that never happened.
 *
 * The journal is one small JSON file per refusal under
 * `<state>/trash/refusals/` — never a database, and never a single appended
 * file that a torn write can corrupt (§4 layout rules apply to state files
 * too).
 */

import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { randomUUID } from "node:crypto";
import { publishNoReplace, writeTempSync, ensureDir } from "./fsx.js";

export type CaptureRefusalReason =
  /** Larger than `capture.maxEntryBytes`. */
  | "too_large"
  /** Free space would drop below `capture.minFreeBytes`. */
  | "disk_low"
  /** `EXDEV` — a different filesystem. Refused, never copied (§11.10). */
  | "cross_device"
  /** An intermediate path component is a symlink; we never traverse one (§4). */
  | "symlink_component"
  /** fifo / socket / device node — not a capturable payload. */
  | "special_file"
  /** `EPERM`/`EACCES` — the delete could not be completed by this user. */
  | "permission"
  /** The parent directory is not writable, so the move could not happen. */
  | "not_deletable"
  /** The store or retention quota is full and everything left is un-uploaded. */
  | "quota_exceeded"
  /** `/`, the home directory, `~/.hasna`, `~/.ssh`, `~/.aws`, a system root. */
  | "protected_path"
  /** The capture failed to read or hash the payload. */
  | "hash_unreadable"
  /** Any other filesystem failure surfaced during capture. */
  | "io_error";

export interface RefusalRecord {
  schema: "hasna.trash.refusal.v1";
  at: string;
  /** The path as given (never canonicalized). */
  target: string;
  absoluteTarget: string;
  reason: CaptureRefusalReason;
  detail: string;
  /** True when the path matched `capture.excludeGlobs` (or `--force` was given). */
  excluded: boolean;
  /** The glob that carried the exemption, when one did. */
  excludeGlob: string | null;
  forced: boolean;
  /**
   * True when the delete proceeded anyway (the §11.7 exempt branch), false
   * when the delete was refused and the path is still there.
   */
  deleted: boolean;
  entryId: string | null;
  agent: string | null;
}

export function refusalFileName(at: string, reason: CaptureRefusalReason): string {
  const stamp = new Date(at).toISOString().replace(/[:.]/g, "").replace("Z", "");
  return `${stamp}-${reason}-${randomUUID()}.json`;
}

/** Append a refusal to the journal, durably. Returns the record written. */
export function recordRefusal(refusalDir: string, record: Omit<RefusalRecord, "schema">): RefusalRecord {
  const full: RefusalRecord = { schema: "hasna.trash.refusal.v1", ...record };
  ensureDir(refusalDir);
  const tmp = writeTempSync(refusalDir, ".tmp-", `${JSON.stringify(full, null, 2)}\n`);
  publishNoReplace(tmp, join(refusalDir, refusalFileName(full.at, full.reason)));
  return full;
}

export interface RefusalQuery {
  reason?: CaptureRefusalReason;
  limit?: number;
  /** Only refusals at or after this ISO timestamp. */
  since?: string;
}

/** Read the journal, newest first. A torn/unparseable record is skipped, never fatal. */
export function listRefusals(refusalDir: string, query: RefusalQuery = {}): RefusalRecord[] {
  let names: string[];
  try {
    names = readdirSync(refusalDir).filter((name) => name.endsWith(".json"));
  } catch {
    return [];
  }
  const out: RefusalRecord[] = [];
  for (const name of names.sort().reverse()) {
    try {
      const parsed = JSON.parse(readFileSync(join(refusalDir, name), "utf8")) as RefusalRecord;
      if (parsed?.schema !== "hasna.trash.refusal.v1") continue;
      if (query.reason && parsed.reason !== query.reason) continue;
      if (query.since && Date.parse(parsed.at) < Date.parse(query.since)) continue;
      out.push(parsed);
    } catch {
      // a half-written or foreign file in the journal is ignored, not fatal
    }
  }
  return typeof query.limit === "number" ? out.slice(0, query.limit) : out;
}

export interface RefusalTally {
  total: number;
  deleted: number;
  refused: number;
  byReason: Record<string, number>;
}

export function tallyRefusals(refusalDir: string): RefusalTally {
  const tally: RefusalTally = { total: 0, deleted: 0, refused: 0, byReason: {} };
  for (const record of listRefusals(refusalDir)) {
    tally.total += 1;
    if (record.deleted) tally.deleted += 1;
    else tally.refused += 1;
    tally.byReason[record.reason] = (tally.byReason[record.reason] ?? 0) + 1;
  }
  return tally;
}
