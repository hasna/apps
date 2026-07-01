import type { Database } from 'bun:sqlite';
import { existsSync } from 'node:fs';
import { normalizeArtifactKey } from './artifact-store';
import { migrateKnowledgeDb, openKnowledgeDb } from './knowledge-db';
import type { StorageContract } from './storage-contract';

export type KnowledgeProvenanceIssueSeverity = 'warn' | 'error';

export interface KnowledgeProvenanceIssue {
  severity: KnowledgeProvenanceIssueSeverity;
  code: string;
  artifact_uri?: string;
  artifact_key?: string;
  page_id?: string;
  path?: string;
  message: string;
}

export interface KnowledgeProvenanceStatus {
  ok: boolean;
  read_only: true;
  storage_type: StorageContract['storage_type'];
  artifact_root_uri: string;
  counts: {
    storage_objects: number;
    wiki_pages: number;
    wiki_pages_with_artifacts: number;
    storage_objects_with_provenance: number;
    audit_events: number;
    warnings: number;
    errors: number;
  };
  issues: KnowledgeProvenanceIssue[];
  message: string;
}

interface StorageObjectRow {
  artifact_uri: string;
  kind: string;
  metadata_json: string;
}

interface WikiPageRow {
  id: string;
  path: string;
  artifact_uri: string | null;
  status: string;
  metadata_json: string;
}

function parseJsonObject(value: string | null): Record<string, unknown> {
  if (!value) return {};
  try {
    const parsed = JSON.parse(value);
    return parsed && typeof parsed === 'object' && !Array.isArray(parsed) ? parsed as Record<string, unknown> : {};
  } catch {
    return {};
  }
}

function objectRecord(value: unknown): Record<string, unknown> | null {
  return value && typeof value === 'object' && !Array.isArray(value) ? value as Record<string, unknown> : null;
}

function stringValue(value: unknown): string | null {
  return typeof value === 'string' && value.trim().length > 0 ? value : null;
}

function auditCount(db: Database): number {
  const row = db.query<{ n: number }, []>('SELECT COUNT(*) AS n FROM audit_events').get();
  return row?.n ?? 0;
}

function generatedArtifactHasAuditSupport(db: Database, key: string, uri: string): boolean {
  const action = key.startsWith('wiki/generated/')
    ? 'wiki_compile'
    : key.startsWith('wiki/answers/')
      ? 'wiki_answer_file'
      : null;
  if (!action) return true;
  const row = db.query<{ n: number }, [string, string, string, string]>(
    `SELECT COUNT(*) AS n
     FROM audit_events
     WHERE action = ?
       AND (target_uri = ? OR target_uri = ? OR metadata_json LIKE ?)`,
  ).get(action, uri, key, `%${key}%`);
  return (row?.n ?? 0) > 0;
}

export function provenanceStatusFor(dbPath: string, storage: StorageContract): KnowledgeProvenanceStatus {
  if (!existsSync(dbPath)) {
    return {
      ok: true,
      read_only: true,
      storage_type: storage.storage_type,
      artifact_root_uri: storage.artifact_store.uri_prefix,
      counts: {
        storage_objects: 0,
        wiki_pages: 0,
        wiki_pages_with_artifacts: 0,
        storage_objects_with_provenance: 0,
        audit_events: 0,
        warnings: 0,
        errors: 0,
      },
      issues: [],
      message: 'No knowledge.db found; provenance catalog is empty.',
    };
  }
  migrateKnowledgeDb(dbPath);
  const db = openKnowledgeDb(dbPath);
  const issues: KnowledgeProvenanceIssue[] = [];
  try {
    const storageRows = db.query<StorageObjectRow, []>(
      `SELECT artifact_uri, kind, metadata_json
       FROM storage_objects
       ORDER BY artifact_uri ASC`,
    ).all();
    const wikiRows = db.query<WikiPageRow, []>(
      `SELECT id, path, artifact_uri, status, metadata_json
       FROM wiki_pages
       ORDER BY path ASC`,
    ).all();
    const storageByUri = new Map(storageRows.map((row) => [row.artifact_uri, row]));
    const wikiByUri = new Map(wikiRows.filter((row) => row.artifact_uri).map((row) => [row.artifact_uri as string, row]));
    let storageObjectsWithProvenance = 0;

    for (const row of storageRows) {
      const metadata = parseJsonObject(row.metadata_json);
      const key = stringValue(metadata.key);
      if (!key) {
        issues.push({
          severity: 'error',
          code: 'storage_object_missing_key',
          artifact_uri: row.artifact_uri,
          message: 'storage_objects row is missing metadata.key, so artifact provenance cannot be tied to a stable artifact key.',
        });
      } else {
        try {
          normalizeArtifactKey(key);
        } catch (error) {
          issues.push({
            severity: 'error',
            code: 'storage_object_invalid_key',
            artifact_uri: row.artifact_uri,
            artifact_key: key,
            message: error instanceof Error ? error.message : 'storage_objects metadata.key is invalid.',
          });
        }
      }

      const provenance = objectRecord(metadata.provenance);
      if (provenance) {
        storageObjectsWithProvenance += 1;
        const provenanceKey = stringValue(provenance.artifact_key);
        if (key && provenanceKey && provenanceKey !== key) {
          issues.push({
            severity: 'error',
            code: 'provenance_artifact_key_mismatch',
            artifact_uri: row.artifact_uri,
            artifact_key: key,
            message: `Artifact provenance points at ${provenanceKey}, but storage metadata key is ${key}.`,
          });
        }
      } else if (row.kind === 'wiki_page' || (key?.startsWith('wiki/') ?? false)) {
        issues.push({
          severity: 'warn',
          code: 'generated_artifact_missing_provenance',
          artifact_uri: row.artifact_uri,
          artifact_key: key ?? undefined,
          message: 'Generated wiki artifact has no metadata.provenance object; legacy rows remain readable but should be regenerated through knowledge CLI/MCP/SDK.',
        });
      }

      if (key && !generatedArtifactHasAuditSupport(db, key, row.artifact_uri)) {
        issues.push({
          severity: 'warn',
          code: 'generated_artifact_missing_audit_event',
          artifact_uri: row.artifact_uri,
          artifact_key: key,
          message: 'Generated wiki artifact has no matching durable-write audit event.',
        });
      }

      if (row.kind === 'wiki_page' && !wikiByUri.has(row.artifact_uri)) {
        issues.push({
          severity: 'error',
          code: 'wiki_artifact_missing_catalog_page',
          artifact_uri: row.artifact_uri,
          artifact_key: key ?? undefined,
          message: 'storage_objects has a wiki_page artifact that is not referenced by wiki_pages.artifact_uri.',
        });
      }
    }

    for (const page of wikiRows) {
      const metadata = parseJsonObject(page.metadata_json);
      const key = stringValue(metadata.artifact_key);
      if (key && key !== page.path) {
        issues.push({
          severity: 'error',
          code: 'wiki_page_artifact_key_mismatch',
          artifact_uri: page.artifact_uri ?? undefined,
          page_id: page.id,
          path: page.path,
          artifact_key: key,
          message: `wiki_pages metadata artifact_key is ${key}, but page path is ${page.path}.`,
        });
      }
      if (page.status === 'active' && !page.artifact_uri) {
        issues.push({
          severity: 'error',
          code: 'active_wiki_page_missing_artifact_uri',
          page_id: page.id,
          path: page.path,
          artifact_key: key ?? undefined,
          message: 'Active wiki page has no artifact_uri.',
        });
        continue;
      }
      if (page.artifact_uri && !storageByUri.has(page.artifact_uri)) {
        issues.push({
          severity: 'error',
          code: 'wiki_page_missing_storage_object',
          artifact_uri: page.artifact_uri,
          page_id: page.id,
          path: page.path,
          artifact_key: key ?? undefined,
          message: 'wiki_pages.artifact_uri is not recorded in storage_objects; write the page through knowledge CLI/MCP/SDK.',
        });
      } else if (page.artifact_uri) {
        const storageMetadata = parseJsonObject(storageByUri.get(page.artifact_uri)?.metadata_json ?? null);
        const storageKey = stringValue(storageMetadata.key);
        if (storageKey && storageKey !== page.path) {
          issues.push({
            severity: 'error',
            code: 'wiki_page_storage_key_mismatch',
            artifact_uri: page.artifact_uri,
            page_id: page.id,
            path: page.path,
            artifact_key: storageKey,
            message: `storage_objects metadata key is ${storageKey}, but wiki page path is ${page.path}.`,
          });
        }
      }
    }

    const errors = issues.filter((issue) => issue.severity === 'error').length;
    const warnings = issues.filter((issue) => issue.severity === 'warn').length;
    return {
      ok: errors === 0,
      read_only: true,
      storage_type: storage.storage_type,
      artifact_root_uri: storage.artifact_store.uri_prefix,
      counts: {
        storage_objects: storageRows.length,
        wiki_pages: wikiRows.length,
        wiki_pages_with_artifacts: wikiRows.filter((row) => Boolean(row.artifact_uri)).length,
        storage_objects_with_provenance: storageObjectsWithProvenance,
        audit_events: auditCount(db),
        warnings,
        errors,
      },
      issues,
      message: errors === 0
        ? warnings === 0
          ? 'Provenance catalog is consistent'
          : `Provenance catalog has ${warnings} warning(s)`
        : `Provenance catalog has ${errors} error(s) and ${warnings} warning(s)`,
    };
  } finally {
    db.close();
  }
}
