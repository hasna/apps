import { describe, expect, test } from "bun:test";
import { resolveTaskId } from "./helpers.js";

/**
 * Regression: task-id resolution must be CONSISTENT across commands whether the
 * machine reads its local SQLite island or the shared self_hosted cloud store.
 *
 * The bug (reported): `todos show <8-char-prefix>` said "Task not found" while
 * `todos comment <same-prefix>` resolved it, and resolver-based commands
 * (comment/inspect/lock/…) failed on cloud-only tasks even when given a valid
 * full UUID — because the resolver required the row to exist in the LOCAL mirror.
 *
 * The fix: a full task UUID is authoritative and passes through untouched (the
 * downstream read/write validates existence), so every id-based command accepts
 * it identically. Before the fix this call hit the local mirror, found nothing,
 * and killed the process via `process.exit(1)`.
 */
describe("resolveTaskId — cloud-safe, consistent id handling", () => {
  test("returns a full task UUID verbatim without requiring a local row", () => {
    const uuid = "175ee112-473e-48d2-9230-c8d0c5fbb663";
    expect(resolveTaskId(uuid)).toBe(uuid);
  });

  test("canonicalizes an upper-case full UUID to lower-case (cloud is case-sensitive)", () => {
    const uuid = "A1B2C3D4-1111-2222-3333-444455556666";
    expect(resolveTaskId(uuid)).toBe(uuid.toLowerCase());
  });

  test("trims surrounding whitespace on a full UUID", () => {
    const uuid = "175ee112-473e-48d2-9230-c8d0c5fbb663";
    expect(resolveTaskId(`  ${uuid}\n`)).toBe(uuid);
  });
});
