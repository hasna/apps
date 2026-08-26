import { createHash } from "node:crypto";
import { lstatSync, readFileSync } from "node:fs";
import { homedir } from "node:os";
import { join, resolve } from "node:path";

export const CURSOR_GLOBAL_AUTHORITY_RELATIVE_PATH = ".cursor/rules/hasna-global.mdc";
export const CURSOR_GLOBAL_AUTHORITY_MAX_BYTES = 256 * 1024;
export const CURSOR_GLOBAL_AUTHORITY_MANAGED_MARKER = "Managed by @hasna/configs cursor global authority";

const CURSOR_GLOBAL_AUTHORITY_MARKER_PATTERN =
  /^<!-- Managed by @hasna\/configs cursor global authority hash=(sha256:[a-f0-9]{64}) -->$/m;

const CURSOR_GLOBAL_AUTHORITY_FRONTMATTER_PATTERN =
  /^---\n[\s\S]*?\n---(?:\n|$)/;

export type CursorAuthorityFileType = "missing" | "regular" | "symlink" | "directory" | "other";
export type CursorAuthorityObservationStatus = "absent" | "managed" | "unmanaged" | "invalid";
export type CursorAuthorityDetection =
  | "missing"
  | "managed-marker"
  | "unknown-content"
  | "marker-integrity-mismatch"
  | "non-regular-file"
  | "oversized-file"
  | "unreadable-file";

export interface CursorAuthorityObservation {
  tool: "cursor";
  relativePath: typeof CURSOR_GLOBAL_AUTHORITY_RELATIVE_PATH;
  path: string;
  fileType: CursorAuthorityFileType;
  status: CursorAuthorityObservationStatus;
  sha256: string | null;
  markers: string[];
  markerSha256: string | null;
  provenance: {
    source: "filesystem";
    authority: "absent" | "managed" | "unmanaged";
    observedPath: string;
    detection: CursorAuthorityDetection;
  };
}

export type CursorAuthorityConflictKind =
  | "unknown-unmanaged-authority"
  | "invalid-unmanaged-authority";

export interface CursorAuthorityConflict {
  tool: "cursor";
  relativePath: typeof CURSOR_GLOBAL_AUTHORITY_RELATIVE_PATH;
  path: string;
  kind: CursorAuthorityConflictKind;
  sha256: string | null;
  markers: string[];
  provenance: {
    source: "filesystem";
    authority: "unmanaged";
    observedPath: string;
    detection: Exclude<CursorAuthorityDetection, "missing" | "managed-marker">;
  };
  reason: string;
}

export interface CursorAuthorityObservationOptions {
  home?: string;
  readFile?: (path: string) => string;
}

function sha256(content: string | Buffer): string {
  return createHash("sha256").update(content).digest("hex");
}

function homeDir(): string {
  return process.env["HOME"] || homedir();
}

/**
 * Reconstruct the pre-stamp payload from a stamped file: the content with the
 * marker line removed at its actual position, together with the single
 * trailing newline the stamp writes after the marker. `markerIndex` is the
 * position of the matched marker line (its `RegExpMatchArray.index`); the
 * observer passes it so a marker quoted elsewhere in the content cannot shift
 * the removal. `markerIndex` defaults to the first occurrence for standalone
 * use.
 */
export function markerPayload(content: string, markerLine: string, markerIndex?: number): string {
  const index = markerIndex ?? content.indexOf(markerLine);
  if (index < 0) return content;
  return content.slice(0, index) + content.slice(index + markerLine.length).replace(/^\n/, "");
}

function baseObservation(path: string): Omit<CursorAuthorityObservation, "fileType" | "status" | "sha256" | "markers" | "markerSha256" | "provenance"> {
  return {
    tool: "cursor",
    relativePath: CURSOR_GLOBAL_AUTHORITY_RELATIVE_PATH,
    path,
  };
}

/**
 * Cursor reads this fixed global rule before project-scoped `.cursor/rules`
 * files. The session renderer owns only the project-scoped files, so an
 * unmanaged global rule is a second authority. A missing file is the clean
 * case. The package's own apply path stamps every write to this path with
 * {@link stampCursorGlobalAuthorityMarker}; a regular file carrying that
 * marker with a matching payload hash is the package's own output and is
 * accepted as managed. Everything else — foreign content, a tampered marker,
 * a non-regular file — remains blocked, because the renderer cannot guess
 * whether it conflicts with the managed project render.
 */
export function observeCursorGlobalAuthority(
  options: CursorAuthorityObservationOptions = {},
): CursorAuthorityObservation {
  const authorityPath = resolve(join(options.home ?? homeDir(), CURSOR_GLOBAL_AUTHORITY_RELATIVE_PATH));
  const readFile = options.readFile ?? ((path: string) => readFileSync(path, "utf8"));
  return observeCursorGlobalAuthorityPath(authorityPath, readFile);
}

export function observeCursorGlobalAuthorityAtPath(
  authorityPath: string,
): CursorAuthorityObservation {
  return observeCursorGlobalAuthorityPath(
    resolve(authorityPath),
    (path) => readFileSync(path, "utf8"),
  );
}

function observeCursorGlobalAuthorityPath(
  authorityPath: string,
  readFile: (path: string) => string,
): CursorAuthorityObservation {
  const base = baseObservation(authorityPath);

  let stat;
  try {
    stat = lstatSync(authorityPath);
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") {
      return {
        ...base,
        fileType: "missing",
        status: "absent",
        sha256: null,
        markers: [],
        markerSha256: null,
        provenance: {
          source: "filesystem",
          authority: "absent",
          observedPath: authorityPath,
          detection: "missing",
        },
      };
    }
    return {
      ...base,
      fileType: "other",
      status: "invalid",
      sha256: null,
      markers: [],
      markerSha256: null,
      provenance: {
        source: "filesystem",
        authority: "unmanaged",
        observedPath: authorityPath,
        detection: "unreadable-file",
      },
    };
  }

  const fileType: CursorAuthorityFileType = stat.isSymbolicLink()
    ? "symlink"
    : stat.isFile()
      ? "regular"
      : stat.isDirectory()
        ? "directory"
        : "other";
  if (fileType !== "regular") {
    return {
      ...base,
      fileType,
      status: "invalid",
      sha256: null,
      markers: [],
      markerSha256: null,
      provenance: {
        source: "filesystem",
        authority: "unmanaged",
        observedPath: authorityPath,
        detection: "non-regular-file",
      },
    };
  }
  if (stat.size > CURSOR_GLOBAL_AUTHORITY_MAX_BYTES) {
    return {
      ...base,
      fileType,
      status: "invalid",
      sha256: null,
      markers: [],
      markerSha256: null,
      provenance: {
        source: "filesystem",
        authority: "unmanaged",
        observedPath: authorityPath,
        detection: "oversized-file",
      },
    };
  }

  let content: string;
  try {
    content = readFile(authorityPath);
  } catch {
    return {
      ...base,
      fileType,
      status: "invalid",
      sha256: null,
      markers: [],
      markerSha256: null,
      provenance: {
        source: "filesystem",
        authority: "unmanaged",
        observedPath: authorityPath,
        detection: "unreadable-file",
      },
    };
  }

  const contentSha256 = sha256(content);
  const markerMatch = content.match(CURSOR_GLOBAL_AUTHORITY_MARKER_PATTERN);
  const markers = markerMatch ? [CURSOR_GLOBAL_AUTHORITY_MANAGED_MARKER] : [];
  const markerSha256 = markerMatch?.[1]?.slice("sha256:".length) ?? null;
  if (!markerMatch) {
    return {
      ...base,
      fileType,
      status: "unmanaged",
      sha256: contentSha256,
      markers,
      markerSha256,
      provenance: {
        source: "filesystem",
        authority: "unmanaged",
        observedPath: authorityPath,
        detection: "unknown-content",
      },
    };
  }

  const markerLine = markerMatch[0];
  const payloadSha256 = sha256(markerPayload(content, markerLine, markerMatch.index ?? -1));
  if (payloadSha256 !== markerSha256) {
    return {
      ...base,
      fileType,
      status: "invalid",
      sha256: contentSha256,
      markers,
      markerSha256,
      provenance: {
        source: "filesystem",
        authority: "unmanaged",
        observedPath: authorityPath,
        detection: "marker-integrity-mismatch",
      },
    };
  }

  // The marker is the stamp the package's own apply path writes to this path
  // (see stampCursorGlobalAuthorityMarker in this module and writeConfigResult
  // in apply.ts). A valid marker with a matching payload hash is tamper-evident
  // package-owned output; a foreign writer does not emit this exact marker.
  return {
    ...base,
    fileType,
    status: "managed",
    sha256: contentSha256,
    markers,
    markerSha256,
    provenance: {
      source: "filesystem",
      authority: "managed",
      observedPath: authorityPath,
      detection: "managed-marker",
    },
  };
}

/**
 * Whether an expanded target path is the Cursor fixed global authority path
 * under the current home. Used by the apply path to decide when to stamp the
 * managed marker; the comparison mirrors {@link observeCursorGlobalAuthority}'s
 * resolution so the writer and the observer always agree.
 */
export function isCursorGlobalAuthorityPath(path: string): boolean {
  return resolve(path) === resolve(join(homeDir(), CURSOR_GLOBAL_AUTHORITY_RELATIVE_PATH));
}

/**
 * Stamp the managed marker onto content destined for the Cursor fixed global
 * authority path. The marker carries the sha256 of the payload AFTER the
 * marker line, which is exactly the payload the observer recomputes in
 * {@link observeCursorGlobalAuthorityPath} — so a stamped file round-trips as
 * managed. Cursor requires YAML frontmatter to start the file, so content that
 * opens with a `---` frontmatter block is stamped AFTER the closing `---`,
 * matching how the package's own session-render cursor files place their
 * managed marker; plain content without frontmatter is stamped at the top.
 *
 * Idempotency is hash-correctness-based, not presence-based: content whose
 * existing marker's hash still matches its current payload is returned
 * unchanged (re-apply no-op), while content carrying a STALE marker — the
 * payload changed after stamping, e.g. a template re-render that expanded
 * {{VAR}} placeholders — is re-stamped in place with the hash of the current
 * payload. Presence-based idempotency propagated an invalid stamp forever:
 * the observer recomputed the payload hash, reported
 * marker-integrity-mismatch, and every re-apply reproduced the same invalid
 * file, leaving the cursor project render blocked with no repair path
 * (H-00154, station01 ~/.cursor/rules/hasna-global.mdc).
 */
export function stampCursorGlobalAuthorityMarker(content: string): string {
  const existing = content.match(CURSOR_GLOBAL_AUTHORITY_MARKER_PATTERN);
  if (existing) {
    const markerLine = existing[0];
    const index = existing.index ?? content.indexOf(markerLine);
    const payload = markerPayload(content, markerLine, index);
    if (sha256(payload) === existing[1]!.slice("sha256:".length)) {
      return content;
    }
    const digest = sha256(payload);
    const freshMarkerLine = `<!-- ${CURSOR_GLOBAL_AUTHORITY_MANAGED_MARKER} hash=sha256:${digest} -->`;
    return content.slice(0, index) + freshMarkerLine + content.slice(index + markerLine.length);
  }
  const digest = sha256(content);
  const markerLine = `<!-- ${CURSOR_GLOBAL_AUTHORITY_MANAGED_MARKER} hash=sha256:${digest} -->`;
  const frontmatter = content.match(CURSOR_GLOBAL_AUTHORITY_FRONTMATTER_PATTERN)?.[0];
  if (frontmatter) {
    return `${frontmatter}${markerLine}\n${content.slice(frontmatter.length)}`;
  }
  return `${markerLine}\n${content}`;
}

export function detectCursorAuthorityConflicts(
  observation = observeCursorGlobalAuthority(),
): CursorAuthorityConflict[] {
  if (observation.status === "absent" || observation.status === "managed") return [];

  const detection = observation.provenance.detection as Exclude<CursorAuthorityDetection, "missing" | "managed-marker">;
  const invalid = observation.status === "invalid";
  return [{
    tool: "cursor",
    relativePath: CURSOR_GLOBAL_AUTHORITY_RELATIVE_PATH,
    path: observation.path,
    kind: invalid ? "invalid-unmanaged-authority" : "unknown-unmanaged-authority",
    sha256: observation.sha256,
    markers: observation.markers,
    provenance: {
      source: "filesystem",
      authority: "unmanaged",
      observedPath: observation.path,
      detection,
    },
    reason: invalid
      ? `Cursor fixed global authority ${CURSOR_GLOBAL_AUTHORITY_RELATIVE_PATH} is not a verifiable regular managed file; refusing to render project rules.`
      : `Cursor fixed global authority ${CURSOR_GLOBAL_AUTHORITY_RELATIVE_PATH} is unmanaged; refusing to guess whether it conflicts with the managed project render.`,
  }];
}
