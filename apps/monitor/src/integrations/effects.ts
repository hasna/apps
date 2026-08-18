/**
 * Effect identity and persistence (design §4 "Shared contracts", §5 slug_effects).
 *
 * The stable effect key is sha256(slug \0 run_id \0 action_index \0 target \0
 * operation) — the FROZEN contract vector: the five design components joined
 * by U+0000. This vector is pinned by a fixture in effects.test.ts; any change
 * to the serialization changes every shared caller's key and label and is a
 * contract break. Records persist under the monitor data dir in a bounded JSON
 * store; when the slug_effects table lands (MON-V2-02 migration 008),
 * SQLEffectStore implements the same EffectStore interface (claims backed by a
 * claims table).
 */
import { createHash, randomBytes } from "crypto";
import {
  chmodSync,
  existsSync,
  linkSync,
  mkdirSync,
  readFileSync,
  renameSync,
  unlinkSync,
  writeFileSync,
} from "fs";
import { join } from "path";
import type { EffectRecord, EffectRequest } from "./adapter.js";

export type { EffectRecord } from "./adapter.js";

function sha256Hex(text: string): string {
  return createHash("sha256").update(text, "utf8").digest("hex");
}

/**
 * Deterministic digest of an arbitrary bounded value (canonical JSON string).
 */
export function digestOf(value: unknown): string {
  return sha256Hex(JSON.stringify(value));
}

/**
 * Stable effect key — the FROZEN contract vector. sha256 of the five design
 * components joined by U+0000, so the same inputs always produce the same key
 * and any changed component produces a different key. Shared callers (the
 * loops-store label, queue/lease-boundary lookups) derive their identity from
 * this exact key; it MUST NOT be re-serialized differently in any layer.
 */
export function effectKey(req: EffectRequest): string {
  return sha256Hex([req.slug, req.runId, req.actionIndex, req.target, req.operation].join("\0"));
}

/**
 * An exclusive, expiring cross-process claim on one effect key. The token
 * fences subsequent operations: only the holder's token can release it, and a
 * holder's write is authoritative while the claim is fresh.
 */
export interface EffectClaim {
  token: string;
  acquiredAt: string;
  expiresAt: string;
}

/** Durable, idempotent effect store. Upsert by effect key; never duplicates. */
export interface EffectStore {
  record(record: EffectRecord): Promise<void>;
  get(effectKey: string): Promise<EffectRecord | null>;
  /**
   * Acquire the exclusive claim for one effect key, or null when another
   * process holds a fresh claim. A stale (expired) claim is broken by the
   * acquisition. Serializes the reconcile-then-create sequence across
   * processes, so two monitors cannot both observe "no effect" and both
   * create.
   */
  claim(effectKey: string, ttlMs: number): Promise<EffectClaim | null>;
  /** Fenced release: only the claim's own token releases it. */
  release(effectKey: string, token: string): Promise<void>;
}

/** One fenced cross-process claim is the write serialization for one key. */
const CLAIM_MAX_ATTEMPTS = 3;

/**
 * Bounded JSON-file effect store. One mode-600 file per effect key, written
 * atomically (unique temp file + rename), plus one fenced claim file per key
 * for cross-process serialization. Interim backing store until migration 008
 * provides slug_effects.
 */
export class FileEffectStore implements EffectStore {
  constructor(private readonly dir: string) {}

  async record(record: EffectRecord): Promise<void> {
    mkdirSync(this.dir, { recursive: true, mode: 0o700 });
    const target = join(this.dir, `${record.effectKey}.json`);
    // Unique temp path per write: concurrent writers to one key never share a
    // temp file, so neither can clobber the other's in-progress write. rename
    // is atomic; the last completed write wins.
    const tmp = join(this.dir, `${record.effectKey}.${process.pid}.${randomBytes(4).toString("hex")}.tmp`);
    writeFileSync(tmp, JSON.stringify(record), { encoding: "utf8", mode: 0o600 });
    chmodSync(tmp, 0o600);
    renameSync(tmp, target);
  }

  async get(effectKey: string): Promise<EffectRecord | null> {
    const file = join(this.dir, `${effectKey}.json`);
    if (!existsSync(file)) return null;
    return JSON.parse(readFileSync(file, "utf8")) as EffectRecord;
  }

  async claim(effectKey: string, ttlMs: number): Promise<EffectClaim | null> {
    mkdirSync(this.dir, { recursive: true, mode: 0o700 });
    const target = join(this.dir, `${effectKey}.claim.json`);
    const token = randomBytes(16).toString("hex");
    const now = new Date();
    const claim: EffectClaim = {
      token,
      acquiredAt: now.toISOString(),
      expiresAt: new Date(now.getTime() + ttlMs).toISOString(),
    };
    // Candidate file is written fully BEFORE it is linked into place, so the
    // claim file only ever appears fully-formed.
    const candidate = join(this.dir, `${effectKey}.claim.${token}.cand`);
    writeFileSync(candidate, JSON.stringify(claim), { encoding: "utf8", mode: 0o600 });
    chmodSync(candidate, 0o600);

    for (let attempt = 0; attempt < CLAIM_MAX_ATTEMPTS; attempt++) {
      // Break a stale claim if one exists. read-then-unlink is safe: the link
      // below is the atomic gate, so two breakers cannot both win.
      try {
        const existing = JSON.parse(readFileSync(target, "utf8")) as EffectClaim;
        if (existing.expiresAt > new Date().toISOString()) {
          try {
            unlinkSync(candidate);
          } catch {
            // already gone — nothing to clean
          }
          return null; // held fresh by another process
        }
        unlinkSync(target);
      } catch {
        // absent or unparseable — the link below decides
      }
      try {
        // Atomic acquire: hard-link creation fails with EEXIST if another
        // process claimed the slot first. Never clobbers a fresh claim.
        linkSync(candidate, target);
      } catch {
        continue; // lost the slot — re-read and retry
      }
      try {
        unlinkSync(candidate);
      } catch {
        // already gone — nothing to clean
      }
      return claim;
    }
    try {
      unlinkSync(candidate);
    } catch {
      // already gone — nothing to clean
    }
    return null; // contended beyond the retry bound
  }

  async release(effectKey: string, token: string): Promise<void> {
    const target = join(this.dir, `${effectKey}.claim.json`);
    try {
      const existing = JSON.parse(readFileSync(target, "utf8")) as EffectClaim;
      if (existing.token !== token) return; // fenced: only the holder releases
      unlinkSync(target);
    } catch {
      // absent — nothing to release
    }
  }
}
