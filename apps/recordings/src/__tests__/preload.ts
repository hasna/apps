import { ensureNativeFsGuardAddon } from "./helpers/native-fs-guard";

/**
 * Ensure the native filesystem guard fixture exists before any test file runs.
 *
 * The addon is produced by prepack, which runs after prepublishOnly
 * (typecheck && test), so a fresh checkout never has it. Compiling here — and
 * publishing the path through RECORDINGS_TEST_FS_GUARD_ADDON — removes the
 * cross-file timing dependency where the compile lived in another test file's
 * module scope and the publication suite lost the race on a fresh tree.
 */
process.env.RECORDINGS_TEST_FS_GUARD_ADDON = ensureNativeFsGuardAddon();
