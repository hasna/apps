import { mkdtempSync, realpathSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { isolatedInstructionsTestEnv } from "./environment.js";

/**
 * Before any package-cwd test imports, isolate HOME, application/config/state
 * roots, credentials and routing. Pinning only the state directory leaves the
 * owner credential file reachable by CLI children. The package test command
 * isolates before Bun starts; this preload also covers bare package-cwd tests.
 *
 * The temp root is realpath'd: on macOS os.tmpdir() is /var/folders/..., a
 * symlink ancestor, and the project-context guard (PROJECT_CONTEXT_SYMLINK_REJECTED)
 * refuses any path under it. Realpath matches src/lib/test-temp-root.ts.
 */
const testHome = mkdtempSync(join(realpathSync(tmpdir()), "hasna-instructions-test-"));
const isolated = isolatedInstructionsTestEnv(testHome);
// Preserve the state-only directory contract used by the snapshot isolation
// regression's positive control; configuration bytes live in testHome.
isolated.HASNA_STATE_HOME = mkdtempSync(join(realpathSync(tmpdir()), "hasna-instructions-state-"));
for (const key of Object.keys(process.env)) delete process.env[key];
Object.assign(process.env, isolated);

// CLI regression helpers also use isolatedInstructionsTestEnv explicitly:
// running a test path from the monorepo root does not load this bunfig preload.
