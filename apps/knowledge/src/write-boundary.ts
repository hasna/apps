import { createHash } from 'node:crypto';
import { existsSync, lstatSync, mkdirSync, readdirSync, readFileSync, realpathSync, statSync, writeFileSync } from 'node:fs';
import { join, relative, sep } from 'node:path';
import { normalizeArtifactKey } from './artifact-store';
import { migrateKnowledgeDb, openKnowledgeDb } from './knowledge-db';
import { recordAuditEvent } from './safety';
import type { StorageContract } from './storage-contract';
import type { KnowledgeWorkspace } from './workspace';

export interface KnowledgeWriteBoundaryViolation {
  code:
    | 'write_boundary_not_enabled'
    | 'untracked_artifact_file'
    | 'artifact_hash_mismatch'
    | 'missing_artifact_file'
    | 'invalid_artifact_manifest_key'
    | 'symlink_workspace_path'
    | 'hardlinked_workspace_file'
    | 'workspace_path_escape'
    | 'unexpected_workspace_root_entry'
    | 'direct_workspace_artifact_file';
  severity: 'warn' | 'error';
  path: string | null;
  key: string | null;
  artifact_uri: string | null;
  message: string;
}

export interface KnowledgeWriteBoundaryStatus {
  ok: boolean;
  strict: boolean;
  protected: boolean;
  read_only: true;
  workspace_home: string;
  policy_path: string;
  instructions_path: string;
  artifact_root: string;
  storage_type: StorageContract['storage_type'];
  counts: {
    manifest_artifacts: number;
    local_artifact_files: number;
    checked_workspace_dirs: number;
    violations: number;
  };
  violations: KnowledgeWriteBoundaryViolation[];
  warnings: string[];
  message: string;
}

export interface KnowledgeStorageProtectionResult extends KnowledgeWriteBoundaryStatus {
  rules: string[];
  files_written: string[];
}

export const WRITE_BOUNDARY_RULES = [
  'Agents must not write directly to .hasna/apps/knowledge or generated artifact files.',
  'Use knowledge CLI, knowledge-mcp, or the @hasna/knowledge SDK for every durable knowledge write.',
  'Use --approve-write --approved-by <name> for generated wiki or repair writes that require approval.',
  'Run knowledge storage validate --strict after changes to detect direct artifact writes.',
];

const WRITE_BOUNDARY_POLICY_FILE = 'write-boundary.json';
const WRITE_BOUNDARY_INSTRUCTIONS_FILE = 'WRITE_BOUNDARY.md';

interface BoundaryScanUnsafePath {
  code:
    | 'symlink_workspace_path'
    | 'hardlinked_workspace_file'
    | 'workspace_path_escape'
    | 'unexpected_workspace_root_entry';
  path: string;
  message: string;
}

function parseMetadataJson(value: string): Record<string, unknown> {
  try {
    const parsed = JSON.parse(value);
    return parsed && typeof parsed === 'object' && !Array.isArray(parsed) ? parsed as Record<string, unknown> : {};
  } catch {
    return {};
  }
}

function writeBoundaryPolicyPath(workspace: KnowledgeWorkspace): string {
  return join(workspace.home, WRITE_BOUNDARY_POLICY_FILE);
}

function writeBoundaryInstructionsPath(workspace: KnowledgeWorkspace): string {
  return join(workspace.home, WRITE_BOUNDARY_INSTRUCTIONS_FILE);
}

function portableRelativePath(root: string, file: string): string {
  return relative(root, file).split(sep).join('/');
}

function isInsidePath(root: string, target: string): boolean {
  const rel = relative(root, target);
  return rel === '' || (!rel.startsWith('..') && rel !== '..' && !rel.startsWith(`..${sep}`));
}

function listFilesRecursive(root: string): { files: string[]; unsafe_paths: BoundaryScanUnsafePath[] } {
  if (!existsSync(root)) return { files: [], unsafe_paths: [] };
  if (lstatSync(root).isSymbolicLink()) {
    return {
      files: [],
      unsafe_paths: [{
        code: 'symlink_workspace_path',
        path: root,
        message: 'Knowledge workspace path is a symlink; direct symlink writes can bypass the artifact boundary.',
      }],
    };
  }
  const files: string[] = [];
  const unsafePaths: BoundaryScanUnsafePath[] = [];
  const rootReal = realpathSync(root);
  const visit = (dir: string) => {
    for (const entry of readdirSync(dir, { withFileTypes: true })) {
      const path = join(dir, entry.name);
      if (entry.isSymbolicLink()) {
        unsafePaths.push({
          code: 'symlink_workspace_path',
          path,
          message: 'Knowledge workspace path is a symlink; direct symlink writes can bypass the artifact boundary.',
        });
        continue;
      }
      const realPath = realpathSync(path);
      if (!isInsidePath(rootReal, realPath)) {
        unsafePaths.push({
          code: 'workspace_path_escape',
          path,
          message: 'Knowledge workspace path resolves outside the guarded root.',
        });
        continue;
      }
      if (entry.isDirectory()) {
        visit(path);
      } else if (entry.isFile()) {
        const stats = statSync(path);
        if (stats.nlink > 1) {
          unsafePaths.push({
            code: 'hardlinked_workspace_file',
            path,
            message: 'Knowledge workspace file has multiple hard links; direct edits can bypass artifact ownership.',
          });
        }
        files.push(path);
      }
    }
  };
  visit(root);
  return {
    files: files.sort((a, b) => a.localeCompare(b)),
    unsafe_paths: unsafePaths.sort((a, b) => a.path.localeCompare(b.path)),
  };
}

const ALLOWED_WORKSPACE_ROOT_FILES = new Set([
  'config.json',
  'db.json',
  'db.json.lock',
  'knowledge.db',
  'knowledge.db-journal',
  'knowledge.db-shm',
  'knowledge.db-wal',
  WRITE_BOUNDARY_POLICY_FILE,
  WRITE_BOUNDARY_INSTRUCTIONS_FILE,
]);

const ALLOWED_WORKSPACE_ROOT_DIRS = new Set([
  'artifacts',
  'cache',
  'exports',
  'indexes',
  'logs',
  'runs',
  'schemas',
  'wiki',
]);

function scanWorkspaceRoot(workspace: KnowledgeWorkspace): BoundaryScanUnsafePath[] {
  const root = workspace.home;
  if (!existsSync(root)) return [];
  const rootReal = realpathSync(root);
  const unsafePaths: BoundaryScanUnsafePath[] = [];
  for (const entry of readdirSync(root, { withFileTypes: true })) {
    const path = join(root, entry.name);
    if (entry.isSymbolicLink()) {
      unsafePaths.push({
        code: 'symlink_workspace_path',
        path,
        message: 'Knowledge workspace root entry is a symlink; direct symlink writes can bypass the artifact boundary.',
      });
      continue;
    }
    const realPath = realpathSync(path);
    if (!isInsidePath(rootReal, realPath)) {
      unsafePaths.push({
        code: 'workspace_path_escape',
        path,
        message: 'Knowledge workspace root entry resolves outside the guarded root.',
      });
      continue;
    }
    if (entry.isDirectory()) {
      if (!ALLOWED_WORKSPACE_ROOT_DIRS.has(entry.name)) {
        unsafePaths.push({
          code: 'unexpected_workspace_root_entry',
          path,
          message: 'Unexpected directory under .hasna/apps/knowledge; write generated knowledge through CLI/MCP/SDK.',
        });
      }
      continue;
    }
    if (entry.isFile()) {
      const stats = statSync(path);
      if (stats.nlink > 1) {
        unsafePaths.push({
          code: 'hardlinked_workspace_file',
          path,
          message: 'Knowledge workspace root file has multiple hard links; direct edits can bypass artifact ownership.',
        });
      }
      if (!ALLOWED_WORKSPACE_ROOT_FILES.has(entry.name)) {
        unsafePaths.push({
          code: 'unexpected_workspace_root_entry',
          path,
          message: 'Unexpected file under .hasna/apps/knowledge; write durable knowledge through CLI/MCP/SDK.',
        });
      }
    }
  }
  return unsafePaths.sort((a, b) => a.path.localeCompare(b.path));
}

function sha256File(path: string): string {
  return `sha256:${createHash('sha256').update(readFileSync(path)).digest('hex')}`;
}

function writeBoundaryMarkdown(workspace: KnowledgeWorkspace): string {
  return [
    '# Knowledge Write Boundary',
    '',
    'This workspace is protected against direct agent writes.',
    '',
    '## Rules',
    '',
    ...WRITE_BOUNDARY_RULES.map((rule) => `- ${rule}`),
    '',
    '## Allowed Write Paths',
    '',
    '- `knowledge wiki compile --approve-write --approved-by <name>`',
    '- `knowledge wiki file-answer --approve-write --approved-by <name>`',
    '- `knowledge ingest ...`, `knowledge reindex ...`, `knowledge sync ...`, and other knowledge CLI/MCP/SDK commands that record provenance and audit evidence.',
    '',
    'Direct file writes under this directory are treated as knowledge corruption because they bypass citations, storage manifests, run ledgers, and audit events.',
    '',
    `Workspace: ${workspace.home}`,
    '',
  ].join('\n');
}

export function writeBoundaryStatusFor(
  dbPath: string,
  workspace: KnowledgeWorkspace,
  storage: StorageContract,
  options: { strict?: boolean } = {},
): KnowledgeWriteBoundaryStatus {
  const strict = options.strict === true;
  const policyPath = writeBoundaryPolicyPath(workspace);
  const instructionsPath = writeBoundaryInstructionsPath(workspace);
  const protectedEnabled = existsSync(policyPath);
  const violations: KnowledgeWriteBoundaryViolation[] = [];
  const warnings: string[] = [];
  let manifestArtifacts = 0;
  let localArtifactFiles = 0;

  if (!protectedEnabled) {
    const message = `Write boundary is not enabled. Run knowledge storage protect --scope ${storage.scope}.`;
    if (strict) {
      violations.push({
        code: 'write_boundary_not_enabled',
        severity: 'error',
        path: policyPath,
        key: null,
        artifact_uri: null,
        message,
      });
    } else {
      warnings.push('write_boundary_not_enabled');
    }
  }

  migrateKnowledgeDb(dbPath);
  const db = openKnowledgeDb(dbPath);
  try {
    const rows = db.query<{
      artifact_uri: string;
      hash: string | null;
      metadata_json: string;
    }, []>(
      'SELECT artifact_uri, hash, metadata_json FROM storage_objects ORDER BY artifact_uri ASC',
    ).all();
    manifestArtifacts = rows.length;
    const manifestByKey = new Map<string, { artifact_uri: string; hash: string | null }>();
    for (const row of rows) {
      const metadata = parseMetadataJson(row.metadata_json);
      let key: string | null = null;
      if (typeof metadata.key === 'string') {
        try {
          key = normalizeArtifactKey(metadata.key);
        } catch (error) {
          violations.push({
            code: 'invalid_artifact_manifest_key',
            severity: 'error',
            path: null,
            key: metadata.key,
            artifact_uri: row.artifact_uri,
            message: error instanceof Error ? error.message : 'storage_objects metadata contains an invalid artifact key.',
          });
        }
      }
      if (key) manifestByKey.set(key, { artifact_uri: row.artifact_uri, hash: row.hash });
    }

    const artifactScan = listFilesRecursive(workspace.artifactsDir);
    for (const unsafe of artifactScan.unsafe_paths) {
      violations.push({
        code: unsafe.code,
        severity: 'error',
        path: unsafe.path,
        key: portableRelativePath(workspace.artifactsDir, unsafe.path),
        artifact_uri: null,
        message: unsafe.message,
      });
    }
    const artifactFiles = artifactScan.files;
    localArtifactFiles = artifactFiles.length;
    const seenKeys = new Set<string>();
    for (const file of artifactFiles) {
      const key = portableRelativePath(workspace.artifactsDir, file);
      seenKeys.add(key);
      if (storage.storage_type !== 'local') {
        violations.push({
          code: 'direct_workspace_artifact_file',
          severity: 'error',
          path: file,
          key,
          artifact_uri: null,
          message: 'Local generated artifact file exists while generated artifact storage is configured for S3.',
        });
        continue;
      }
      const manifest = manifestByKey.get(key);
      if (!manifest) {
        violations.push({
          code: 'untracked_artifact_file',
          severity: 'error',
          path: file,
          key,
          artifact_uri: null,
          message: 'Generated artifact file is not recorded in storage_objects; write it through knowledge CLI/MCP/SDK.',
        });
        continue;
      }
      if (manifest.hash?.startsWith('sha256:')) {
        const actualHash = sha256File(file);
        if (actualHash !== manifest.hash) {
          violations.push({
            code: 'artifact_hash_mismatch',
            severity: 'error',
            path: file,
            key,
            artifact_uri: manifest.artifact_uri,
            message: 'Generated artifact file hash differs from storage_objects; this indicates a direct file edit or stale manifest.',
          });
        }
      }
    }

    if (storage.storage_type === 'local') {
      for (const [key, manifest] of manifestByKey.entries()) {
        const path = join(workspace.artifactsDir, ...key.split('/'));
        if (!seenKeys.has(key) && !existsSync(path)) {
          violations.push({
            code: 'missing_artifact_file',
            severity: 'error',
            path,
            key,
            artifact_uri: manifest.artifact_uri,
            message: 'storage_objects references a local artifact file that is missing from the artifact root.',
          });
        }
      }
    } else {
      warnings.push('write_boundary_local_artifact_hash_check_skipped_for_s3_storage');
    }
  } finally {
    db.close();
  }

  for (const unsafe of scanWorkspaceRoot(workspace)) {
    violations.push({
      code: unsafe.code,
      severity: 'error',
      path: unsafe.path,
      key: portableRelativePath(workspace.home, unsafe.path),
      artifact_uri: null,
      message: unsafe.message,
    });
  }

  const guardedWorkspaceDirs = [
    workspace.cacheDir,
    workspace.exportsDir,
    workspace.indexesDir,
    workspace.logsDir,
    workspace.runsDir,
    workspace.schemasDir,
    workspace.wikiDir,
  ];
  for (const dir of guardedWorkspaceDirs) {
    const scan = listFilesRecursive(dir);
    for (const unsafe of scan.unsafe_paths) {
      violations.push({
        code: unsafe.code,
        severity: 'error',
        path: unsafe.path,
        key: portableRelativePath(workspace.home, unsafe.path),
        artifact_uri: null,
        message: unsafe.message,
      });
    }
    for (const file of scan.files) {
      violations.push({
        code: 'direct_workspace_artifact_file',
        severity: 'error',
        path: file,
        key: portableRelativePath(workspace.home, file),
        artifact_uri: null,
        message: 'Durable generated knowledge files belong under artifacts/ and must be written through the artifact store.',
      });
    }
  }

  const ok = violations.length === 0;
  return {
    ok,
    strict,
    protected: protectedEnabled,
    read_only: true,
    workspace_home: workspace.home,
    policy_path: policyPath,
    instructions_path: instructionsPath,
    artifact_root: workspace.artifactsDir,
    storage_type: storage.storage_type,
    counts: {
      manifest_artifacts: manifestArtifacts,
      local_artifact_files: localArtifactFiles,
      checked_workspace_dirs: guardedWorkspaceDirs.length,
      violations: violations.length,
    },
    violations,
    warnings,
    message: ok
      ? protectedEnabled
        ? 'Knowledge write boundary is enabled and no direct artifact writes were found.'
        : 'Knowledge write boundary is not enabled; run knowledge storage protect.'
      : `Knowledge write boundary found ${violations.length} violation(s).`,
  };
}

export function protectKnowledgeStorageBoundary(input: {
  dbPath: string;
  workspace: KnowledgeWorkspace;
  storage: StorageContract;
  scope: string;
}): KnowledgeStorageProtectionResult {
  const { dbPath, workspace, storage, scope } = input;
  const now = new Date().toISOString();
  const policyPath = writeBoundaryPolicyPath(workspace);
  const instructionsPath = writeBoundaryInstructionsPath(workspace);
  const policy = {
    schema_version: 1,
    protected: true,
    protected_at: now,
    workspace_home: workspace.home,
    policy: 'Agents must use knowledge CLI, knowledge-mcp, or @hasna/knowledge SDK for durable writes.',
    rules: WRITE_BOUNDARY_RULES,
    validation_command: `knowledge storage validate --strict --scope ${scope}`,
    allowed_writers: ['knowledge CLI', 'knowledge-mcp', '@hasna/knowledge SDK'],
    forbidden_paths: ['.hasna/apps/knowledge/** direct file writes'],
  };
  mkdirSync(workspace.home, { recursive: true });
  writeFileSync(policyPath, `${JSON.stringify(policy, null, 2)}\n`);
  writeFileSync(instructionsPath, writeBoundaryMarkdown(workspace));

  migrateKnowledgeDb(dbPath);
  const db = openKnowledgeDb(dbPath);
  try {
    recordAuditEvent(db, {
      event_type: 'storage_write_boundary',
      action: 'storage.write_boundary.protect',
      target_uri: workspace.home,
      decision: 'allow',
      metadata: {
        policy_path: policyPath,
        instructions_path: instructionsPath,
        rules: WRITE_BOUNDARY_RULES,
      },
      created_at: now,
    });
  } finally {
    db.close();
  }

  const status = writeBoundaryStatusFor(dbPath, workspace, storage, { strict: true });
  return {
    ...status,
    rules: WRITE_BOUNDARY_RULES,
    files_written: [policyPath, instructionsPath],
    message: status.ok
      ? `Protected knowledge workspace at ${workspace.home}`
      : `Protected knowledge workspace but found ${status.violations.length} existing violation(s)`,
  };
}
