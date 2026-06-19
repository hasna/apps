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

export interface OpenFilesAssetRef {
  kind: "asset";
  uri: string;
  asset_id: string;
  revision_id?: string;
}

export type OpenFilesSourceRef = OpenFilesFileRef | OpenFilesSourcePathRef | OpenFilesAssetRef;

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

export function buildOpenFilesAssetRef(assetId: string): string {
  return `${OPEN_FILES_SCHEME}asset/${encodeURIComponent(assertSegment(assetId, "asset id"))}`;
}

export function buildOpenFilesAssetRevisionRef(assetId: string, revisionId: string): string {
  return `${buildOpenFilesAssetRef(assetId)}/revision/${encodeURIComponent(assertSegment(revisionId, "asset revision id"))}`;
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

  if (entity === "asset") {
    const assetId = decodeURIComponent(parts[1] ?? "");
    if (!assetId) throw new Error("Invalid open-files asset ref. Missing asset id.");
    let revisionId: string | undefined;
    if (parts.length > 2) {
      if (parts[2] !== "revision" || !parts[3] || parts.length !== 4) {
        throw new Error("Invalid open-files asset ref. Expected open-files://asset/<id>/revision/<revision_id>.");
      }
      revisionId = decodeURIComponent(parts[3]);
    }
    return { kind: "asset", uri, asset_id: assetId, revision_id: revisionId };
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

  throw new Error("Invalid open-files ref. Expected open-files://file/<id>, open-files://asset/<id>, or open-files://source/<id>/path/<path>.");
}

export function isOpenFilesSourceRef(uri: string): boolean {
  try {
    parseOpenFilesSourceRef(uri);
    return true;
  } catch {
    return false;
  }
}
