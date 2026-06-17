const OPEN_FILES_SCHEME = "open-files://";

export interface OpenFilesFileRef {
  kind: "file";
  uri: string;
  file_id: string;
  revision_id?: string;
}

export interface OpenFilesSourcePathRef {
  kind: "source_path";
  uri: string;
  source_id: string;
  path: string;
}

export type OpenFilesSourceRef = OpenFilesFileRef | OpenFilesSourcePathRef;

export interface OpenFilesSourceRefDescriptor {
  uri: string;
  kind: OpenFilesSourceRef["kind"];
  source_id?: string;
  file_id?: string;
  revision_id?: string;
  path_hint?: string;
  private: boolean;
  public_safe: true;
}

function assertSegment(value: string, label: string): string {
  if (!value || value.includes("/")) {
    throw new Error(`Invalid ${label}. Expected a non-empty URI segment.`);
  }
  return value;
}

export function buildOpenFilesFileRef(fileId: string): string {
  return `${OPEN_FILES_SCHEME}file/${encodeURIComponent(assertSegment(fileId, "file id"))}`;
}

export function buildOpenFilesFileRevisionRef(fileId: string, revisionId: string): string {
  return `${buildOpenFilesFileRef(fileId)}/revision/${encodeURIComponent(assertSegment(revisionId, "revision id"))}`;
}

export function buildOpenFilesSourcePathRef(sourceId: string, path: string): string {
  if (!path) throw new Error("Invalid source path. Expected a non-empty path.");
  return `${OPEN_FILES_SCHEME}source/${encodeURIComponent(assertSegment(sourceId, "source id"))}/path/${encodeURIComponent(path)}`;
}

export function parseOpenFilesSourceRef(uri: string): OpenFilesSourceRef {
  if (!uri.startsWith(OPEN_FILES_SCHEME)) {
    throw new Error(`Unsupported source ref scheme: ${uri}`);
  }

  const parts = uri.slice(OPEN_FILES_SCHEME.length).split("/").filter(Boolean);
  const entity = parts[0];

  if (entity === "file") {
    const fileId = decodeURIComponent(parts[1] ?? "");
    if (!fileId) throw new Error("Invalid open-files file ref. Missing file id.");
    let revisionId: string | undefined;
    if (parts.length > 2) {
      if (parts[2] !== "revision" || !parts[3] || parts.length !== 4) {
        throw new Error("Invalid open-files file ref. Expected open-files://file/<id>/revision/<revision_id>.");
      }
      revisionId = decodeURIComponent(parts[3]);
    }
    return { kind: "file", uri, file_id: fileId, revision_id: revisionId };
  }

  if (entity === "source") {
    const sourceId = decodeURIComponent(parts[1] ?? "");
    if (!sourceId) throw new Error("Invalid open-files source ref. Missing source id.");
    if (parts[2] !== "path" || parts.length < 4) {
      throw new Error("Invalid open-files source ref. Expected open-files://source/<id>/path/<path>.");
    }
    return {
      kind: "source_path",
      uri,
      source_id: sourceId,
      path: decodeURIComponent(parts.slice(3).join("/")),
    };
  }

  throw new Error("Invalid open-files ref. Expected open-files://file/<id> or open-files://source/<id>/path/<path>.");
}

export function isOpenFilesSourceRef(uri: string): boolean {
  try {
    parseOpenFilesSourceRef(uri);
    return true;
  } catch {
    return false;
  }
}

function basename(path: string): string {
  const parts = path.split(/[\\/]+/).filter(Boolean);
  return parts[parts.length - 1] ?? "<redacted>";
}

export function describeOpenFilesSourceRef(
  uri: string,
  options: { private?: boolean } = {},
): OpenFilesSourceRefDescriptor {
  const parsed = parseOpenFilesSourceRef(uri);

  if (parsed.kind === "source_path") {
    return {
      uri: parsed.uri,
      kind: parsed.kind,
      source_id: parsed.source_id,
      path_hint: options.private ? `<redacted>/${basename(parsed.path)}` : parsed.path,
      private: options.private ?? false,
      public_safe: true,
    };
  }

  return {
    uri: parsed.uri,
    kind: parsed.kind,
    file_id: parsed.file_id,
    revision_id: parsed.revision_id,
    private: options.private ?? false,
    public_safe: true,
  };
}

export function buildOpenFilesFleetManifestRef(sourceId: string, path: string): string {
  return buildOpenFilesSourcePathRef(sourceId, path);
}
