import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { createHash } from "node:crypto";
import { mkdirSync, rmSync, symlinkSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import {
  CURSOR_GLOBAL_AUTHORITY_MANAGED_MARKER,
  CURSOR_GLOBAL_AUTHORITY_RELATIVE_PATH,
  detectCursorAuthorityConflicts,
  isCursorGlobalAuthorityPath,
  markerPayload,
  observeCursorGlobalAuthority,
  observeCursorGlobalAuthorityAtPath,
  stampCursorGlobalAuthorityMarker,
} from "./cursor-authority";
import { makeTempRoot } from "./test-temp-root";

function sha256(content: string): string {
  return createHash("sha256").update(content).digest("hex");
}

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

  test("treats a fixed authority stamped by the package apply path as managed", () => {
    const payload = [
      "---",
      "alwaysApply: true",
      "---",
      "# Managed global rule",
      "",
    ].join("\n");
    mkdirSync(join(root, "home", ".cursor", "rules"), { recursive: true });
    writeFileSync(authorityPath(), stampCursorGlobalAuthorityMarker(payload));

    const observation = observeCursorGlobalAuthority({ home: homePath() });
    expect(observation).toMatchObject({
      status: "managed",
      fileType: "regular",
      markers: [CURSOR_GLOBAL_AUTHORITY_MANAGED_MARKER],
      provenance: { authority: "managed", detection: "managed-marker" },
    });
    expect(detectCursorAuthorityConflicts(observation)).toEqual([]);
  });

  test("stampCursorGlobalAuthorityMarker is idempotent and carries a valid payload hash", () => {
    const payload = [
      "---",
      "alwaysApply: true",
      "---",
      "# Managed global rule",
      "",
    ].join("\n");
    const stamped = stampCursorGlobalAuthorityMarker(payload);
    const again = stampCursorGlobalAuthorityMarker(stamped);
    expect(again).toBe(stamped);

    mkdirSync(join(root, "home", ".cursor", "rules"), { recursive: true });
    writeFileSync(authorityPath(), stamped);
    const observation = observeCursorGlobalAuthorityAtPath(authorityPath());
    expect(observation).toMatchObject({
      status: "managed",
      provenance: { authority: "managed", detection: "managed-marker" },
    });
    expect(detectCursorAuthorityConflicts(observation)).toEqual([]);
  });

  test("re-stamps a stale marker whose hash no longer matches the payload", () => {
    // Regression: the stamp used to be idempotent on marker PRESENCE, so a
    // file whose payload changed after stamping (an out-of-band edit, or a
    // template re-render that expanded variables) kept its stale marker hash
    // forever. Every re-apply then propagated the invalid stamp, the observer
    // reported marker-integrity-mismatch, and the cursor project render stayed
    // blocked with no repair path (H-00154, station hasna-global.mdc).
    const payload = [
      "---",
      "alwaysApply: true",
      "---",
      "# Managed global rule",
      "",
    ].join("\n");
    const stamped = stampCursorGlobalAuthorityMarker(payload);

    // Simulate an out-of-band edit AFTER stamping: same shape as the station
    // file, whose {{WORKSPACE_ROOT}} placeholders were expanded after the
    // 0.4.34 stamping. The marker line survives verbatim; the payload changes.
    const tampered = stamped.replace(
      "# Managed global rule",
      "# Managed global rule (edited after stamping)",
    );

    mkdirSync(join(root, "home", ".cursor", "rules"), { recursive: true });
    writeFileSync(authorityPath(), tampered);
    expect(observeCursorGlobalAuthorityAtPath(authorityPath())).toMatchObject({
      status: "invalid",
      provenance: { detection: "marker-integrity-mismatch" },
    });

    // The stamp must repair the stale marker: hash of the CURRENT payload.
    const repaired = stampCursorGlobalAuthorityMarker(tampered);
    expect(repaired).not.toBe(tampered);
    const match = repaired.match(/^<!-- Managed by @hasna\/configs cursor global authority hash=(sha256:[a-f0-9]{64}) -->$/m);
    expect(match).not.toBeNull();
    expect(match![1]).toBe(`sha256:${sha256(markerPayload(repaired, match![0], match!.index))}`);

    // The repaired file round-trips as managed and unblocks the render.
    writeFileSync(authorityPath(), repaired);
    const observation = observeCursorGlobalAuthorityAtPath(authorityPath());
    expect(observation).toMatchObject({
      status: "managed",
      fileType: "regular",
      markers: [CURSOR_GLOBAL_AUTHORITY_MANAGED_MARKER],
      provenance: { authority: "managed", detection: "managed-marker" },
    });
    expect(detectCursorAuthorityConflicts(observation)).toEqual([]);

    // And the repaired state is idempotent: a second stamp is a no-op.
    expect(stampCursorGlobalAuthorityMarker(repaired)).toBe(repaired);
  });

  test("re-stamps a stale frontmatter-bearing marker in place, keeping frontmatter at byte 0", () => {
    const payload = [
      "---",
      "alwaysApply: true",
      "---",
      "# Managed global rule",
      "",
    ].join("\n");
    const stamped = stampCursorGlobalAuthorityMarker(payload);
    // Insert a payload change after the marker line, leaving the marker in
    // place — the station shape (rendered content grew after stamping).
    const stale = stamped.replace(
      "\n# Managed global rule",
      "\n# Managed global rule (expanded after stamping)",
    );
    const repaired = stampCursorGlobalAuthorityMarker(stale);

    expect(repaired.startsWith("---\n")).toBe(true);
    expect(repaired.indexOf(`<!-- ${CURSOR_GLOBAL_AUTHORITY_MANAGED_MARKER} hash=`))
      .toBeGreaterThan(repaired.indexOf("\n---\n"));
    expect(repaired.match(/Managed by @hasna\/configs cursor global authority/g)).toHaveLength(1);

    mkdirSync(join(root, "home", ".cursor", "rules"), { recursive: true });
    writeFileSync(authorityPath(), repaired);
    expect(observeCursorGlobalAuthorityAtPath(authorityPath())).toMatchObject({
      status: "managed",
      provenance: { authority: "managed", detection: "managed-marker" },
    });
  });

  test("keeps frontmatter at byte 0 when stamping a frontmatter-bearing global rule", () => {
    // Cursor requires YAML frontmatter to start the file; a marker stamped in
    // front of `---` silently drops the frontmatter (gray-matter parses
    // data: {}) and Cursor stops loading the rule. The stamp must land AFTER
    // the closing `---`, matching the package's own session-render cursor
    // files. parseLeadingFrontmatter mirrors gray-matter's behavior on this
    // shape: only a file whose byte 0 is `---\n` yields data.
    function parseLeadingFrontmatter(content: string): Record<string, string> {
      if (!content.startsWith("---\n")) return {};
      const end = content.indexOf("\n---", 4);
      if (end < 0) return {};
      const data: Record<string, string> = {};
      for (const line of content.slice(4, end).split("\n")) {
        const match = line.match(/^([A-Za-z0-9_.-]+):\s*(.*)$/);
        if (match) data[match[1]] = match[2];
      }
      return data;
    }

    const payload = [
      "---",
      "alwaysApply: true",
      "---",
      "# Managed global rule",
      "",
    ].join("\n");
    const stamped = stampCursorGlobalAuthorityMarker(payload);

    expect(stamped.startsWith("---\n")).toBe(true);
    expect(parseLeadingFrontmatter(stamped)).toEqual({ alwaysApply: "true" });
    expect(stamped.indexOf(`<!-- ${CURSOR_GLOBAL_AUTHORITY_MANAGED_MARKER} hash=`))
      .toBeGreaterThan(stamped.indexOf("\n---\n"));

    const again = stampCursorGlobalAuthorityMarker(stamped);
    expect(again).toBe(stamped);
    expect(again.match(/Managed by @hasna\/configs cursor global authority/g)).toHaveLength(1);

    mkdirSync(join(root, "home", ".cursor", "rules"), { recursive: true });
    writeFileSync(authorityPath(), stamped);
    const observation = observeCursorGlobalAuthorityAtPath(authorityPath());
    expect(observation).toMatchObject({
      status: "managed",
      fileType: "regular",
      markers: [CURSOR_GLOBAL_AUTHORITY_MANAGED_MARKER],
      provenance: { authority: "managed", detection: "managed-marker" },
    });
    expect(observeCursorGlobalAuthority({ home: homePath() })).toMatchObject({
      status: "managed",
      provenance: { authority: "managed", detection: "managed-marker" },
    });
    expect(detectCursorAuthorityConflicts(observation)).toEqual([]);
  });

  test("isCursorGlobalAuthorityPath matches only the fixed authority path", () => {
    const previousHome = process.env["HOME"];
    process.env["HOME"] = homePath();
    try {
      expect(isCursorGlobalAuthorityPath(join(homePath(), ".cursor", "rules", "hasna-global.mdc"))).toBe(true);
      expect(isCursorGlobalAuthorityPath(join(homePath(), ".cursor", "rules", "other.mdc"))).toBe(false);
      expect(isCursorGlobalAuthorityPath(join(homePath(), ".cursor", "rules"))).toBe(false);
      expect(isCursorGlobalAuthorityPath(join(homePath(), "outside", "hasna-global.mdc"))).toBe(false);
    } finally {
      process.env["HOME"] = previousHome;
    }
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

  test("round-trips the stamped payload exactly: sha256(markerPayload) equals the stamped hash for plain, frontmatter-bearing, and marker-quoting content", () => {
    // The stamp hashes the pre-stamp content and embeds that digest in the
    // marker line; the observer must recover the exact pre-stamp payload by
    // removing the marker at its actual position. Any reconstruction that
    // differs (even by one byte) breaks a legitimate stamped file.
    const embeddedMarker = `<!-- ${CURSOR_GLOBAL_AUTHORITY_MANAGED_MARKER} hash=sha256:${"a".repeat(64)} -->`;
    const fixtures = [
      "# Managed global rule\n",
      "---\nalwaysApply: true\n---\n# Managed global rule\n",
      [
        "---",
        `description: "quotes the marker text: ${embeddedMarker}"`,
        "---",
        "# Managed global rule",
        "",
      ].join("\n"),
    ];

    for (const payload of fixtures) {
      const stamped = stampCursorGlobalAuthorityMarker(payload);
      const match = stamped.match(/^<!-- Managed by @hasna\/configs cursor global authority hash=(sha256:[a-f0-9]{64}) -->$/m);
      expect(match, "stamped file must carry exactly one marker line").not.toBeNull();
      const markerLine = match![0];
      const markerHash = match![1];

      const payloadFromMarker = markerPayload(stamped, markerLine, match!.index);
      expect(payloadFromMarker).toBe(payload);
      expect(`sha256:${sha256(payloadFromMarker)}`).toBe(markerHash);
    }
  });

  test("accepts a stamped frontmatter-bearing authority whose content quotes the marker text elsewhere", () => {
    // The observer matches the anchored marker line only. A file whose own
    // body merely contains the marker text (for example a YAML description
    // quoting it) must not corrupt the payload reconstruction: the payload is
    // the content with the matched marker line removed at its position, and
    // the stamped hash must still verify.
    const payload = [
      "---",
      `description: "quotes the marker text: <!-- ${CURSOR_GLOBAL_AUTHORITY_MANAGED_MARKER} hash=sha256:${"a".repeat(64)} -->"`,
      "---",
      "# Managed global rule",
      "",
    ].join("\n");
    mkdirSync(join(root, "home", ".cursor", "rules"), { recursive: true });
    writeFileSync(authorityPath(), stampCursorGlobalAuthorityMarker(payload));

    const observation = observeCursorGlobalAuthority({ home: homePath() });
    expect(observation).toMatchObject({
      status: "managed",
      fileType: "regular",
      markers: [CURSOR_GLOBAL_AUTHORITY_MANAGED_MARKER],
      provenance: { authority: "managed", detection: "managed-marker" },
    });
    expect(detectCursorAuthorityConflicts(observation)).toEqual([]);
  });
});
