/**
 * Effect identity and persistence (design §4 "Shared contracts", §5 slug_effects).
 *
 * The stable effect key is hash(slug, run_id, action_index, target, operation).
 * Records persist under the monitor data dir in a bounded JSON store; when the
 * slug_effects table lands (MON-V2-02 migration 008), SQLEffectStore implements
 * the same EffectStore interface.
 */
import { createHash } from "crypto";
import { chmodSync, existsSync, mkdirSync, readFileSync, renameSync, writeFileSync } from "fs";
import { join } from "path";
import type { EffectRecord, EffectRequest } from "./adapter.js";

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
 * Stable effect key: hash of the five design components. Same inputs always
 * produce the same key; any changed component produces a different key.
 */
export function effectKey(req: EffectRequest): string {
  return sha256Hex(
    JSON.stringify({
      slug: req.slug,
      run_id: req.runId,
      action_index: req.actionIndex,
      target: req.target,
      operation: req.operation,
    }),
  );
}

/** Durable, idempotent effect store. Upsert by effect key; never duplicates. */
export interface EffectStore {
  record(record: EffectRecord): Promise<void>;
  get(effectKey: string): Promise<EffectRecord | null>;
}

/**
 * Bounded JSON-file effect store. One mode-600 file per effect key, written
 * atomically (temp file + rename). Interim backing store until migration 008
 * provides slug_effects.
 */
export class FileEffectStore implements EffectStore {
  constructor(private readonly dir: string) {}

  async record(record: EffectRecord): Promise<void> {
    mkdirSync(this.dir, { recursive: true, mode: 0o700 });
    const target = join(this.dir, `${record.effectKey}.json`);
    const tmp = `${target}.tmp`;
    writeFileSync(tmp, JSON.stringify(record), { encoding: "utf8", mode: 0o600 });
    chmodSync(tmp, 0o600);
    renameSync(tmp, target);
  }

  async get(effectKey: string): Promise<EffectRecord | null> {
    const file = join(this.dir, `${effectKey}.json`);
    if (!existsSync(file)) return null;
    return JSON.parse(readFileSync(file, "utf8")) as EffectRecord;
  }
}
