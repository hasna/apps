// The LocalStore's audio-artifact kit and its test seam.
//
// It lives OUTSIDE ./sqlite-store.ts on purpose: `__setLocalArtifactStorage`
// is re-exported from `src/store.ts`, and anything `src/store.ts` imports
// statically ends up in the CLI and MCP bundles. Keeping the seam here (state
// only, no `bun:sqlite`) lets the sqlite-backed store stay behind the single
// gated dynamic import in ./load.ts while tests keep injecting a bucket the
// way they always did.

import type { AudioArtifactStorage } from "../lib/audio-artifact-storage.js";
import { resolveAudioArtifactStorage } from "../lib/audio-artifact-storage.js";

// Test seam: an explicit artifact storage that wins over env resolution for
// the LocalStore upload-at-creation path. Mirrors __resetStore's contract —
// tests that inject a storage must reset it in afterEach.
let localArtifactStorageOverride: AudioArtifactStorage | null | undefined;

/** The artifact kit the LocalStore uploads through. */
export function localArtifactStorageFor(): AudioArtifactStorage {
  return localArtifactStorageOverride ?? resolveAudioArtifactStorage();
}

/** Test helper: force the LocalStore's artifact kit (e.g. an in-memory bucket). */
export function __setLocalArtifactStorage(storage: AudioArtifactStorage | null): void {
  localArtifactStorageOverride = storage;
}

/** Test helper: clear the artifact-storage override. */
export function __resetLocalArtifactStorage(): void {
  localArtifactStorageOverride = undefined;
}
