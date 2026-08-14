import { createHash } from "node:crypto";
import { lstatSync, readFileSync } from "node:fs";
import { homedir } from "node:os";
import { join, resolve } from "node:path";

export const CURSOR_GLOBAL_AUTHORITY_RELATIVE_PATH = ".cursor/rules/hasna-global.mdc";
export const CURSOR_GLOBAL_AUTHORITY_MAX_BYTES = 256 * 1024;
export const CURSOR_GLOBAL_AUTHORITY_MANAGED_MARKER = "Managed by @hasna/configs cursor global authority";

const CURSOR_GLOBAL_AUTHORITY_MARKER_PATTERN =
  /^<!-- Managed by @hasna\/configs cursor global authority hash=(sha256:[a-f0-9]{64}) -->$/m;

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

function markerPayload(content: string, markerLine: string): string {
  const withTrailingNewline = `${markerLine}\n`;
  if (content.startsWith(withTrailingNewline)) return content.slice(withTrailingNewline.length);
  if (content.startsWith(markerLine)) return content.slice(markerLine.length).replace(/^\n/, "");
  return content.replace(`${markerLine}\n`, "").replace(markerLine, "");
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
 * case. Existing content remains blocked unless a future registry-backed
 * migration contract proves package ownership; a self-declared marker is
 * intentionally insufficient.
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
  const payloadSha256 = sha256(markerPayload(content, markerLine));
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

  // A self-declared marker is not package-owned provenance. The live source
  // registry/config version is not available to this filesystem-only planner,
  // so even a matching hash remains unmanaged until a signed or registry-backed
  // migration contract supplies that proof.
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
