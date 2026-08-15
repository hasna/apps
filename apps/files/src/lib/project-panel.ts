import {
  parseContract,
  SCHEMA_IDS,
  type ProjectPanel,
  type ProjectPanelInput,
} from "@hasna/contracts";
import { getDb } from "../db/database.js";
import { listFiles } from "../db/files.js";
import { getProject, listProjects } from "../db/projects.js";
import { getSource } from "../db/sources.js";
import type { FileWithTags, Project, Source } from "../types/index.js";

export interface FilesProjectPanelOptions {
  limit?: number;
}

const SOURCE_PACKAGE = "@hasna/files";

function clampLimit(limit: number | undefined): number {
  if (!Number.isFinite(limit ?? 0)) return 20;
  return Math.max(1, Math.min(100, Math.trunc(limit ?? 20)));
}

function slugify(value: string): string {
  return value
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .replace(/-{2,}/g, "-") || "project";
}

function projectSlug(project: Project | null, fallback: string): string {
  const metadataSlug = typeof project?.metadata?.slug === "string" ? project.metadata.slug : undefined;
  return slugify(metadataSlug ?? project?.name ?? fallback);
}

function resolveProject(ref: string): Project | null {
  const exact = getProject(ref);
  if (exact) return exact;
  const wanted = ref.trim().toLowerCase();
  return listProjects().find((project) => {
    return project.name.toLowerCase() === wanted || slugify(project.name) === wanted;
  }) ?? null;
}

function toTimestamp(value: string | undefined): string | undefined {
  if (!value) return undefined;
  const normalized = value.includes("T") ? value : `${value.replace(" ", "T")}Z`;
  const date = new Date(normalized);
  return Number.isNaN(date.valueOf()) ? undefined : date.toISOString();
}

function fileUri(id: string): string {
  return `files://file/${id}`;
}

function sourceUri(id: string): string {
  return `files://source/${id}`;
}

function projectResource(id: string, name: string, externalId: string) {
  return {
    kind: "project" as const,
    id,
    name,
    uri: `project://${id}`,
    externalId,
    sourcePackage: SOURCE_PACKAGE,
  };
}

function fileResource(file: FileWithTags) {
  return {
    kind: "file" as const,
    id: file.id,
    name: file.name,
    uri: fileUri(file.id),
    externalId: file.id,
    sourcePackage: SOURCE_PACKAGE,
    tags: file.tags,
  };
}

function sourceResource(source: Source) {
  return {
    kind: "document" as const,
    id: source.id,
    name: source.name,
    uri: sourceUri(source.id),
    externalId: source.id,
    sourcePackage: SOURCE_PACKAGE,
    tags: [source.type, source.enabled ? "enabled" : "disabled"],
  };
}

function countSearchDocuments(projectId: string): { indexedFiles: number; documents: number } {
  const row = getDb().query<{ indexed_files: number; documents: number }, [string]>(
    `SELECT
       COUNT(DISTINCT d.file_id) AS indexed_files,
       COUNT(*) AS documents
     FROM file_search_documents d
     JOIN project_files pf ON pf.file_id = d.file_id
     JOIN files f ON f.id = d.file_id
     WHERE pf.project_id = ?
       AND f.status = 'active'
       AND d.status IN ('ready', 'partial')`,
  ).get(projectId);
  return {
    indexedFiles: row?.indexed_files ?? 0,
    documents: row?.documents ?? 0,
  };
}

function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  const units = ["KB", "MB", "GB", "TB"];
  let value = bytes / 1024;
  let unit = units[0]!;
  for (let index = 1; value >= 1024 && index < units.length; index++) {
    value /= 1024;
    unit = units[index]!;
  }
  return `${value >= 10 ? value.toFixed(0) : value.toFixed(1)} ${unit}`;
}

function newestFirst(a: FileWithTags, b: FileWithTags): number {
  return (toTimestamp(b.modified_at ?? b.indexed_at) ?? "").localeCompare(toTimestamp(a.modified_at ?? a.indexed_at) ?? "");
}

export function createFilesProjectPanel(projectRef: string, options: FilesProjectPanelOptions = {}): ProjectPanel {
  const limit = clampLimit(options.limit);
  const project = resolveProject(projectRef);
  const generatedAt = new Date().toISOString();
  const slug = projectSlug(project, projectRef);

  if (!project) {
    const draft: ProjectPanelInput = {
      schema: SCHEMA_IDS.projectPanel,
      id: `files_panel_${slug}`,
      createdAt: generatedAt,
      projectId: slug,
      provider: {
        kind: "files",
        id: `files_${slug}`,
        name: "Files",
        sourcePackage: SOURCE_PACKAGE,
        externalId: projectRef,
      },
      kind: "files",
      title: "Files",
      summary: "No files project is registered for this project yet.",
      state: "empty",
      generatedAt,
      freshness: "unknown",
      metrics: [
        { id: "total_files", label: "Files", value: 0, status: "unknown" },
        { id: "sources", label: "Sources", value: 0, status: "unknown" },
      ],
      warnings: [`No @hasna/files project matched "${projectRef}".`],
      resourceRefs: [
        projectResource(slug, projectRef, projectRef),
      ],
      renderFragment: {
        renderer: "json_render",
        title: "Files",
        spec: {
          component: "project.files.summary",
          state: "empty",
          itemLimit: limit,
        },
      },
    };
    return parseContract(SCHEMA_IDS.projectPanel, draft);
  }

  const files = listFiles({ project_id: project.id, limit: 10_000, sort: "date", sort_dir: "desc" });
  const selectedFiles = [...files].sort(newestFirst).slice(0, limit);
  const sourceIds = [...new Set(files.map((file) => file.source_id))];
  const sources = sourceIds.map((id) => getSource(id)).filter((source): source is Source => source !== null);
  const tags = new Set(files.flatMap((file) => file.tags));
  const totalBytes = files.reduce((sum, file) => sum + file.size, 0);
  const searchable = countSearchDocuments(project.id);
  const state = files.length === 0 ? "empty" : "ready";
  const latestIndexedAt = selectedFiles.map((file) => toTimestamp(file.indexed_at)).find(Boolean);

  const draft: ProjectPanelInput = {
    schema: SCHEMA_IDS.projectPanel,
    id: `files_panel_${project.id}`,
    createdAt: generatedAt,
    projectId: slug,
    provider: {
      kind: "files",
      id: `files_${slug}`,
      name: "Files",
      sourcePackage: SOURCE_PACKAGE,
      externalId: project.id,
    },
    kind: "files",
    title: "Files",
    summary: files.length === 0
      ? "No active files are attached to this files project."
      : `${files.length} active file${files.length === 1 ? "" : "s"} across ${sources.length} source${sources.length === 1 ? "" : "s"}.`,
    state,
    generatedAt,
    freshness: latestIndexedAt ? "fresh" : "unknown",
    metrics: [
      { id: "total_files", label: "Files", value: files.length, status: files.length > 0 ? "good" : "unknown" },
      { id: "total_bytes", label: "Size", value: totalBytes, unit: "bytes", status: files.length > 0 ? "good" : "unknown" },
      { id: "sources", label: "Sources", value: sources.length, status: sources.length > 0 ? "good" : "unknown" },
      { id: "indexed_files", label: "Searchable files", value: searchable.indexedFiles, status: searchable.indexedFiles > 0 ? "good" : "warning" },
      { id: "search_documents", label: "Search docs", value: searchable.documents, status: searchable.documents > 0 ? "good" : "unknown" },
      { id: "tags", label: "Tags", value: tags.size, status: tags.size > 0 ? "good" : "unknown" },
    ],
    items: selectedFiles.map((file) => ({
      id: file.id,
      title: file.name,
      summary: `${file.mime || "unknown"} · ${formatBytes(file.size)}`,
      status: file.status,
      priority: "unknown",
      timestamp: toTimestamp(file.modified_at ?? file.indexed_at),
      resourceRefs: [
        fileResource(file),
        ...(getSource(file.source_id) ? [sourceResource(getSource(file.source_id)!)] : []),
      ],
      metadata: {
        ext: file.ext,
        mime: file.mime,
        size: file.size,
        path: file.path,
        source_id: file.source_id,
      },
    })),
    actions: [
      { kind: "action", id: "files:search", name: "Search files", sourcePackage: SOURCE_PACKAGE, externalId: "search" },
      { kind: "action", id: "files:context-pack", name: "Build context pack", sourcePackage: SOURCE_PACKAGE, externalId: "context-pack" },
    ],
    resourceRefs: [
      projectResource(slug, project.name, project.id),
      ...sources.slice(0, limit).map(sourceResource),
    ],
    renderFragment: {
      renderer: "json_render",
      title: "Files",
      spec: {
        component: "project.files.summary",
        metrics: ["total_files", "total_bytes", "sources", "indexed_files", "tags"],
        itemLimit: limit,
      },
    },
  };

  return parseContract(SCHEMA_IDS.projectPanel, draft);
}
