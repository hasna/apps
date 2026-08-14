import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { mkdirSync, rmSync, symlinkSync, writeFileSync } from "node:fs";
import { createHash } from "node:crypto";
import { join } from "node:path";
import {
  CURSOR_GLOBAL_AUTHORITY_MANAGED_MARKER,
  CURSOR_GLOBAL_AUTHORITY_RELATIVE_PATH,
  detectCursorAuthorityConflicts,
  observeCursorGlobalAuthority,
} from "./cursor-authority";
import { makeTempRoot } from "./test-temp-root";

let root = "";

beforeEach(() => {
  root = makeTempRoot("open-configs-cursor-authority-");
});

afterEach(() => {
  rmSync(root, { recursive: true, force: true });
});

function homePath(): string {
  return join(root, "home");
}

function authorityPath(): string {
  return join(homePath(), CURSOR_GLOBAL_AUTHORITY_RELATIVE_PATH);
}

function managedAuthority(payload: string): string {
  const digest = createHash("sha256").update(payload).digest("hex");
  return `<!-- ${CURSOR_GLOBAL_AUTHORITY_MANAGED_MARKER} hash=sha256:${digest} -->\n${payload}`;
}

describe("Cursor fixed global authority detection", () => {
  test("treats a missing fixed authority as clean", () => {
    const observation = observeCursorGlobalAuthority({ home: homePath() });
    expect(observation).toMatchObject({
      status: "absent",
      fileType: "missing",
      sha256: null,
      provenance: { authority: "absent", detection: "missing" },
    });
    expect(detectCursorAuthorityConflicts(observation)).toEqual([]);
  });

  test("does not trust a self-declared marker without package-owned provenance", () => {
    const payload = [
      "---",
      "alwaysApply: true",
      "---",
      "# Managed global rule",
      "",
    ].join("\n");
    mkdirSync(join(root, "home", ".cursor", "rules"), { recursive: true });
    writeFileSync(authorityPath(), managedAuthority(payload));

    const observation = observeCursorGlobalAuthority({ home: homePath() });
    expect(observation).toMatchObject({
      status: "unmanaged",
      fileType: "regular",
      markers: [CURSOR_GLOBAL_AUTHORITY_MANAGED_MARKER],
      provenance: { authority: "unmanaged", detection: "unknown-content" },
    });
    expect(detectCursorAuthorityConflicts(observation)[0]?.kind).toBe("unknown-unmanaged-authority");
  });

  test("fails closed for unknown or unmanaged content", () => {
    mkdirSync(join(root, "home", ".cursor", "rules"), { recursive: true });
    writeFileSync(authorityPath(), "---\nalwaysApply: true\n---\n# Local authority\n");

    const observation = observeCursorGlobalAuthority({ home: homePath() });
    const [conflict] = detectCursorAuthorityConflicts(observation);

    expect(observation).toMatchObject({
      status: "unmanaged",
      fileType: "regular",
      provenance: { authority: "unmanaged", detection: "unknown-content" },
    });
    expect(conflict).toMatchObject({
      kind: "unknown-unmanaged-authority",
      sha256: observation.sha256,
      provenance: { detection: "unknown-content" },
    });
  });

  test("fails closed when the managed marker hash does not match", () => {
    mkdirSync(join(root, "home", ".cursor", "rules"), { recursive: true });
    writeFileSync(
      authorityPath(),
      `<!-- ${CURSOR_GLOBAL_AUTHORITY_MANAGED_MARKER} hash=sha256:${"0".repeat(64)} -->\n# Changed content\n`,
    );

    const observation = observeCursorGlobalAuthority({ home: homePath() });
    expect(observation).toMatchObject({
      status: "invalid",
      provenance: { detection: "marker-integrity-mismatch" },
    });
    expect(detectCursorAuthorityConflicts(observation)[0]?.kind).toBe("invalid-unmanaged-authority");
  });

  test("fails closed for symlinked fixed authorities", () => {
    const outside = join(root, "outside.mdc");
    mkdirSync(join(root, "home", ".cursor", "rules"), { recursive: true });
    writeFileSync(outside, "# Outside authority\n");
    symlinkSync(outside, authorityPath());

    const observation = observeCursorGlobalAuthority({ home: homePath() });
    expect(observation).toMatchObject({
      status: "invalid",
      fileType: "symlink",
      sha256: null,
      provenance: { detection: "non-regular-file" },
    });
    expect(detectCursorAuthorityConflicts(observation)[0]?.kind).toBe("invalid-unmanaged-authority");
  });

  test("fails closed for non-regular fixed authorities", () => {
    mkdirSync(authorityPath(), { recursive: true });

    const observation = observeCursorGlobalAuthority({ home: homePath() });
    expect(observation).toMatchObject({
      status: "invalid",
      fileType: "directory",
      sha256: null,
      provenance: { detection: "non-regular-file" },
    });
    expect(detectCursorAuthorityConflicts(observation)[0]?.kind).toBe("invalid-unmanaged-authority");
  });

  test("fails closed for oversized fixed authorities", () => {
    mkdirSync(join(root, "home", ".cursor", "rules"), { recursive: true });
    writeFileSync(authorityPath(), Buffer.alloc(256 * 1024 + 1, 0x23));

    const observation = observeCursorGlobalAuthority({ home: homePath() });
    expect(observation).toMatchObject({
      status: "invalid",
      fileType: "regular",
      sha256: null,
      provenance: { detection: "oversized-file" },
    });
    expect(detectCursorAuthorityConflicts(observation)[0]?.kind).toBe("invalid-unmanaged-authority");
  });

  test("fails closed when a regular fixed authority cannot be read", () => {
    mkdirSync(join(root, "home", ".cursor", "rules"), { recursive: true });
    writeFileSync(authorityPath(), "# unreadable in this probe\n");

    expect(observeCursorGlobalAuthority({
      home: homePath(),
      readFile: () => {
        throw new Error("permission denied");
      },
    })).toMatchObject({
      status: "invalid",
      fileType: "regular",
      sha256: null,
      provenance: { detection: "unreadable-file" },
    });
  });
});
