import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

/**
 * Test-runner-level state-store isolation (O15-04648).
 *
 * Runs once per `bun test` process, before any test file is imported, via the
 * package bunfig.toml `[test] preload`. Pins the state-kind override
 * HASNA_STATE_HOME to a fresh, existing temp dir so snapshot-writing tests can
 * never adopt the LIVE instructions state store on a migrated machine
 * (~/.local/state/hasna/instructions): `adoptResolverSnapshotDir` treats an
 * existing HASNA_STATE_HOME override as adoption, so all synthetic snapshot
 * writes land in the temp dir and the real store stays byte-identical.
 *
 * The package.json test script pins the same variable, but that only covers
 * `bun run test`; a bare `bun test` / `bun test <file>` invocation has no
 * script-level pin. This preload closes that gap at the runner level.
 */
const stateHome = mkdtempSync(join(tmpdir(), "hasna-instructions-state-"));
process.env.HASNA_STATE_HOME = stateHome;

// Fail-closed default (owner directive 2026-09-04): with no fleet API env the
// store layer refuses to open the local SQLite store unless the operator set
// the explicit opt-in HASNA_INSTRUCTIONS_LOCAL=1. The suite exercises the
// local transport heavily with no API env, so the runner pins the opt-in here.
// Fail-closed tests that assert the refusal delete the variable (or pass an
// explicit env without it), exactly as they already delete the API vars.
process.env.HASNA_INSTRUCTIONS_LOCAL = "1";
