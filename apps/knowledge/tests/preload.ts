/**
 * Keep legacy default-local tests independent of the invoking shell.
 *
 * Only role-selection variable names are touched. Values are never read,
 * copied, printed, or persisted. Individual containment tests set synthetic
 * values explicitly after this preload runs.
 */
import { afterEach, beforeEach } from 'bun:test';
import { randomUUID } from 'node:crypto';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { clearKnowledgeTestRoleEnv } from './helpers/sanitized-env';

clearKnowledgeTestRoleEnv();

// Never let a test discover a real user-scoped role config or auth file.
// The path is intentionally not created here, preserving preload zero-I/O.
const isolatedHome = join(tmpdir(), `knowledge-test-home-${randomUUID()}`);
process.env.HOME = isolatedHome;
process.env.USERPROFILE = isolatedHome;

function resetRuntimeRoleState(): void {
  clearKnowledgeTestRoleEnv();
  process.env.HOME = isolatedHome;
  process.env.USERPROFILE = isolatedHome;
}

beforeEach(resetRuntimeRoleState);
afterEach(resetRuntimeRoleState);
