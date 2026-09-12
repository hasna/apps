// The ONLY module in the client graph that reaches `bun:sqlite`.
//
// WHY IT IS A SEPARATE MODULE. The on-box store is opt-in
// (`HASNA_RECORDINGS_LOCAL=1`, alias `RECORDINGS_LOCAL=1`) and a hosted run
// must not be able to open it at all. When the LocalStore was a plain object
// in `src/store.ts`, `bun:sqlite` and the whole `src/db/*` tree were STATICALLY
// reachable from `src/cli/index.ts` and `src/mcp/index.ts`, so the bundler
// emitted them into `dist/cli/index.js` and `dist/mcp/index.js` — the shipped
// hosted binaries carried an embedded local database engine they were never
// allowed to use. Everything sqlite-shaped now lives here and is reached
// through the ONE gated dynamic import in ./load.ts, which `bun build
// --splitting` emits as a chunk under `dist/chunks/` — outside `dist/cli` and
// `dist/mcp`.
//
// Nothing in here decides POLICY. Whether the local store may be used at all
// is decided before the import, by `selectsRecordingsLocalStore`
// (src/lib/local-opt-in.ts) via `resolveRecordingsCloudClient`
// (src/http/client.ts), on the environment alone.

import { Database } from "bun:sqlite";
import { existsSync } from "node:fs";
import * as recordingsDb from "../db/recordings.js";
import * as agentsDb from "../db/agents.js";
import * as projectsDb from "../db/projects.js";
import { CURRENT_MIGRATION_LEVEL } from "../db/database.js";
import { saveFeedback as saveFeedbackLocal } from "../db/feedback.js";
import { withLocalStoreReaderLease } from "../lib/install-maintenance.js";
import { uploadAudioAtCreation } from "../lib/audio-artifact-storage.js";
import { localArtifactStorageFor } from "./artifact-storage.js";
import type { Store } from "../store.js";

/** The on-box SQLite implementation of the one `Store` interface. */
export const localStore: Store = {
  mode: "sqlite",
  baseUrl: null,
  async createRecording(input, idempotencyKey) {
    return withLocalStoreReaderLease(async () => {
      const recording = recordingsDb.createRecording(input, undefined, idempotencyKey);
      if (!recording.audio_path) return recording;
      const uploaded = await uploadAudioAtCreation(
        recording.id,
        recording.audio_path,
        localArtifactStorageFor(),
      );
      if (!uploaded) return recording;
      return recordingsDb.updateRecordingAudio(
        recording.id,
        uploaded.objectKey,
        uploaded.sha256,
        uploaded.bytes,
      ) ?? recording;
    });
  },
  async getRecording(id) {
    return withLocalStoreReaderLease(() => recordingsDb.getRecording(id));
  },
  async listRecordings(filter) {
    return withLocalStoreReaderLease(() => recordingsDb.listRecordings(filter));
  },
  async countRecordings(filter) {
    return withLocalStoreReaderLease(() => recordingsDb.countRecordings(filter));
  },
  async searchRecordings(query, filter) {
    return withLocalStoreReaderLease(() => recordingsDb.searchRecordings(query, filter));
  },
  async deleteRecording(id) {
    return withLocalStoreReaderLease(() => recordingsDb.deleteRecording(id));
  },
  async getRecordingStats() {
    return withLocalStoreReaderLease(() => recordingsDb.getRecordingStats());
  },
  async registerAgent(name, description, role) {
    return withLocalStoreReaderLease(() => agentsDb.registerAgent(name, description, role));
  },
  async getAgent(idOrName) {
    return withLocalStoreReaderLease(() => agentsDb.getAgent(idOrName));
  },
  async listAgents() {
    return withLocalStoreReaderLease(() => agentsDb.listAgents());
  },
  async heartbeatAgent(idOrName) {
    return withLocalStoreReaderLease(() => agentsDb.heartbeatAgent(idOrName));
  },
  async setAgentFocus(idOrName, projectId) {
    return withLocalStoreReaderLease(() => agentsDb.setAgentFocus(idOrName, projectId));
  },
  async registerProject(name, path, description) {
    return withLocalStoreReaderLease(() => projectsDb.registerProject(name, path, description));
  },
  async getProject(idOrPath) {
    return withLocalStoreReaderLease(() => projectsDb.getProject(idOrPath));
  },
  async listProjects() {
    return withLocalStoreReaderLease(() => projectsDb.listProjects());
  },
  async saveFeedback(input) {
    await withLocalStoreReaderLease(() => saveFeedbackLocal(input));
  },
};

/**
 * Count recordings in a SQLite file without opening it read-write.
 *
 * `getDatabase()` would run migrations, which is a write to a file we are only
 * inspecting — and on a legacy file that is a destructive surprise. Open
 * read-only and treat any failure as "unknown" rather than propagating.
 *
 * Callers (src/lib/persistence-probe.ts) only ask about a file that EXISTS,
 * and never on the fail-closed path.
 */
export function readLocalRecordingCount(dbPath: string): number | null {
  try {
    const db = new Database(dbPath, { readonly: true });
    try {
      const row = db.query("SELECT COUNT(*) AS count FROM recordings").get() as
        | { count?: number }
        | null;
      return typeof row?.count === "number" ? row.count : null;
    } finally {
      db.close();
    }
  } catch {
    return null;
  }
}

/**
 * Is an existing local store behind the current schema?
 *
 * Read-only, because the only other way to find out is to open it read-write,
 * which applies the migrations — the exact side effect being checked for.
 * Returns null when the answer cannot be established.
 */
export function localStoreIsBehindSchema(dbPath: string): boolean | null {
  if (!existsSync(dbPath)) return null;
  try {
    const db = new Database(dbPath, { readonly: true });
    try {
      const row = db.query("SELECT MAX(id) AS max_id FROM _migrations").get() as
        | { max_id?: number | null }
        | null;
      const level = typeof row?.max_id === "number" ? row.max_id : -1;
      return level < CURRENT_MIGRATION_LEVEL;
    } finally {
      db.close();
    }
  } catch {
    return null;
  }
}
