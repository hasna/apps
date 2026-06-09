/**
 * @hasna/knowledge
 * Copyright 2026 Hasna Inc.
 * Licensed under the Apache License, Version 2.0
 */
import { describe, expect, test } from 'bun:test';
import { chmodSync, existsSync, mkdirSync, mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import { tmpdir } from 'node:os';
import { join, dirname, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { openKnowledgeDb } from '../src/knowledge-db';
import { createKnowledgeService } from '../src/service';
import { parseSourceRef } from '../src/source-ref';
import { recordStorageObjects } from '../src/storage-contract';
import { recordKnowledgeSyncConflict } from '../src/sync';
import { defaultKnowledgeConfig, writeKnowledgeConfig } from '../src/workspace';

const __dirname = dirname(fileURLToPath(import.meta.url));
const CLI = join(__dirname, '..', 'src', 'cli.ts');
const packageJson = JSON.parse(readFileSync(join(__dirname, '..', 'package.json'), 'utf8')) as {
  name: string;
  version: string;
  bin: Record<string, string>;
};

function runCli(args: string[], cwd?: string, env?: Record<string, string>) {
  return Bun.spawnSync(['bun', CLI, ...args], {
    cwd,
    env: env ? { ...process.env, ...env } : undefined,
    stdout: 'pipe',
    stderr: 'pipe'
  });
}

function runCliWithInput(args: string[], input: string, cwd?: string, env?: Record<string, string>) {
  const result = spawnSync('bun', [CLI, ...args], {
    cwd,
    env: env ? { ...process.env, ...env } : undefined,
    input,
    maxBuffer: 64 * 1024 * 1024,
  });
  return {
    exitCode: result.status ?? 1,
    stdout: result.stdout,
    stderr: result.stderr,
  };
}

function runKnowledgeBin(args: string[], cwd?: string, env?: Record<string, string>) {
  const dir = mkdtempSync(join(tmpdir(), 'knowledge-bin-'));
  const wrapper = join(dir, 'knowledge');
  writeFileSync(wrapper, [
    '#!/usr/bin/env bun',
    `import { run } from ${JSON.stringify(pathToFileURL(CLI).href)};`,
    'run(process.argv.slice(2)).catch((error) => {',
    '  console.error(`Error: ${error instanceof Error ? error.message : String(error)}`);',
    '  process.exitCode = 1;',
    '});',
    '',
  ].join('\n'));
  return Bun.spawnSync(['bun', wrapper, ...args], {
    cwd,
    env: env ? { ...process.env, ...env } : undefined,
    stdout: 'pipe',
    stderr: 'pipe',
  });
}

function writeFakeSshBin(dir: string): string {
  const bin = join(dir, 'bin');
  mkdirSync(bin, { recursive: true });
  const ssh = join(bin, 'ssh');
  writeFileSync(ssh, [
    '#!/bin/sh',
    'if [ -n "$KNOWLEDGE_FAKE_SSH_TARGET_PATH" ]; then printf "%s" "$1" > "$KNOWLEDGE_FAKE_SSH_TARGET_PATH"; fi',
    'command="$2"',
    'if printf "%s" "$command" | grep -q "sync.*export"; then',
    '    printf "%s" "$KNOWLEDGE_FAKE_SSH_EXPORT_JSON"',
    'elif printf "%s" "$command" | grep -q "sync.*import"; then',
    '    if [ -n "$KNOWLEDGE_FAKE_SSH_STDIN_PATH" ]; then cat > "$KNOWLEDGE_FAKE_SSH_STDIN_PATH"; else cat >/dev/null; fi',
    '    printf "%s" "$KNOWLEDGE_FAKE_SSH_IMPORT_JSON"',
    'else',
    '    echo "unexpected fake ssh command: $*" >&2',
    '    exit 9',
    'fi',
    '',
  ].join('\n'));
  chmodSync(ssh, 0o755);
  return bin;
}

function writeFakeMachinesRouteBin(bin: string, target: string, projectRoot = '/remote/open-knowledge', includeRepairHint = false): void {
  const machines = join(bin, 'machines');
  const workspaceDiagnostics = [{
    id: 'project_root',
    status: includeRepairHint ? 'inferred' : 'ok',
    severity: includeRepairHint ? 'warn' : 'ok',
    message: includeRepairHint ? 'project root inferred from workspace path' : 'project root mapped',
    path: projectRoot,
    source: 'manifest_metadata',
    path_exists: null,
  }];
  const workspaceRepairHints = includeRepairHint ? [{
    id: 'machines_workspace_repair',
    reason: 'Confirm workspace path mapping before sync.',
    command: ['machines', 'workspace', 'repair', '--machine', 'spark01', '--project', 'open-knowledge', '--repo', 'open-knowledge', '--open-files-repo', 'open-files', '--json'],
    shell_command: "machines workspace repair --machine spark01 --project open-knowledge --repo open-knowledge --open-files-repo open-files --json",
    apply_command: ['machines', 'workspace', 'repair', '--machine', 'spark01', '--project', 'open-knowledge', '--repo', 'open-knowledge', '--open-files-repo', 'open-files', '--json', '--apply'],
    apply_shell_command: "machines workspace repair --machine spark01 --project open-knowledge --repo open-knowledge --open-files-repo open-files --json --apply",
  }] : [];
  writeFileSync(machines, [
    '#!/bin/sh',
    'if [ "$1" = "route" ]; then',
    `  printf '%s\\n' '${JSON.stringify({
      schema_version: 1,
      ok: true,
      machine_id: 'spark01',
      requested_machine_id: 'spark01',
      route: 'tailscale',
      source: 'tailscale',
      target,
      command_target: target,
      confidence: 'high',
      evidence: {
        topology: true,
        matched_by: 'machine_id',
        selected_hint: {
          kind: 'tailscale',
          target,
          reachable: true,
        },
      },
      warnings: [],
    })}'`,
    '  exit 0',
    'fi',
    'if [ "$1" = "workspace" ] && [ "$2" = "resolve" ]; then',
    `  printf '%s\\n' '${JSON.stringify({
      ok: true,
      requested_machine_id: 'spark01',
      machine_id: 'spark01',
      project: { project_id: 'open-knowledge', repo_name: 'open-knowledge' },
      machine: { current: false, primary: false, trust_status: 'trusted', auth_status: 'authenticated' },
      paths: {
        workspace_root: { path: '/remote', source: 'manifest' },
        project_root: { path: projectRoot, source: 'manifest_metadata' },
        open_files_root: { path: '/remote/open-files', source: 'manifest_metadata' },
      },
      diagnostics: workspaceDiagnostics,
      repair_hints: workspaceRepairHints,
      evidence: { topology: true, matched_by: 'machine_id', metadata_keys: [] },
      warnings: includeRepairHint ? ['project_root_inferred:open-knowledge'] : [],
    })}'`,
    '  exit 0',
    'fi',
    'echo "unexpected fake machines command: $*" >&2',
    'exit 9',
    '',
  ].join('\n'));
  chmodSync(machines, 0o755);
}

function writeFailingMachinesBin(bin: string, marker: string): void {
  mkdirSync(bin, { recursive: true });
  const machines = join(bin, 'machines');
  writeFileSync(machines, [
    '#!/bin/sh',
    `printf "%s\\n" "$*" >> ${JSON.stringify(marker)}`,
    'echo "unexpected fake machines command: $*" >&2',
    'exit 9',
    '',
  ].join('\n'));
  chmodSync(machines, 0o755);
}

describe('knowledge cli', () => {
  test('help and subcommand help work', () => {
    const result = runCli(['--help']);
    expect(result.exitCode).toBe(0);
    const out = new TextDecoder().decode(result.stdout);
    expect(out).toContain('knowledge - local agent knowledge store');
    expect(out).toContain('Commands:');

    const sub = runCli(['help', 'list']);
    expect(sub.exitCode).toBe(0);
    const subOut = new TextDecoder().decode(sub.stdout);
    expect(subOut).toContain('--sort created|title');
  });

  test('version flag works', () => {
    const result = runCli(['--version']);
    expect(result.exitCode).toBe(0);
    const out = new TextDecoder().decode(result.stdout);
    expect(out).toContain(packageJson.name);
    expect(out).toContain(packageJson.version);
  });

  test('package exposes only knowledge CLI bins', () => {
    expect(packageJson.bin).toEqual({
      knowledge: 'bin/knowledge.js',
      'knowledge-mcp': 'bin/knowledge-mcp.js',
    });
    expect(packageJson.bin['open-knowledge']).toBeUndefined();
    expect(packageJson.bin['open-knowledge-mcp']).toBeUndefined();
  });

  test('unknown command includes suggestion', () => {
    const result = runCli(['lits']);
    expect(result.exitCode).toBe(1);
    const err = new TextDecoder().decode(result.stderr);
    expect(err).toContain("Did you mean 'list'");
  });

  test('add/list/get/update/archive/restore/untag/delete flow with json and confirmation', () => {
    const dir = mkdtempSync(join(tmpdir(), 'ok-cli-'));
    const store = join(dir, 'db.json');

    const addA = runCli(['add', 'TitleB', 'BodyA', '--store', store, '--json']);
    expect(addA.exitCode).toBe(0);
    const addAOut = JSON.parse(new TextDecoder().decode(addA.stdout));

    const addB = runCli(['add', 'TitleA', 'BodyB', '--store', store, '--json']);
    expect(addB.exitCode).toBe(0);
    const addBOut = JSON.parse(new TextDecoder().decode(addB.stdout));

    const list = runCli(['ls', '--store', store, '--json', '-p', '1', '-l', '10', '--sort', 'title']);
    expect(list.exitCode).toBe(0);
    const listOut = JSON.parse(new TextDecoder().decode(list.stdout));
    expect(listOut.total).toBe(2);
    expect(listOut.total_pages).toBe(1);
    expect(listOut.items[0].title).toBe('TitleA');

    const get = runCli(['get', '--id', addAOut.item.id, '--store', store, '--json']);
    expect(get.exitCode).toBe(0);
    const getOut = JSON.parse(new TextDecoder().decode(get.stdout));
    expect(getOut.item.content).toBe('BodyA');

    const update = runCli(['update', '--id', getOut.item.id, '--store', store, '--tag', 'rust', '--json']);
    expect(update.exitCode).toBe(0);
    const updateOut = JSON.parse(new TextDecoder().decode(update.stdout));
    expect(updateOut.item.tags).toContain('rust');

    const untag = runCli(['untag', '--id', getOut.item.id, '--store', store, '--tag', 'rust', '--json']);
    expect(untag.exitCode).toBe(0);
    const untagOut = JSON.parse(new TextDecoder().decode(untag.stdout));
    expect(untagOut.item.tags).not.toContain('rust');

    const archive = runCli(['archive', '--id', getOut.item.id, '--store', store, '--json']);
    expect(archive.exitCode).toBe(0);
    const archivedList = runCli(['list', '--store', store, '--json']);
    expect(JSON.parse(new TextDecoder().decode(archivedList.stdout)).total).toBe(1);
    const onlyArchived = runCli(['list', '--store', store, '--archived', '--json']);
    expect(JSON.parse(new TextDecoder().decode(onlyArchived.stdout)).total).toBe(1);

    const restore = runCli(['restore', '--id', getOut.item.id, '--store', store, '--json']);
    expect(restore.exitCode).toBe(0);

    const delNoYes = runCli(['rm', '--id', addAOut.item.id, '--store', store, '--json']);
    expect(delNoYes.exitCode).toBe(1);
    const delErr = new TextDecoder().decode(delNoYes.stderr);
    expect(delErr).toContain('Refusing delete without --yes');

    const del = runCli(['delete', '--id', addAOut.item.id, '--store', store, '--json', '--yes']);
    expect(del.exitCode).toBe(0);
    const delOut = JSON.parse(new TextDecoder().decode(del.stdout));
    expect(delOut.ok).toBe(true);

    const del2 = runCli(['delete', '--id', addBOut.item.id, '--store', store, '--json', '--yes']);
    expect(del2.exitCode).toBe(0);

    const db = JSON.parse(readFileSync(store, 'utf8'));
    expect(db.items.length).toBe(0);
  });

  test('upsert creates and updates items', () => {
    const dir = mkdtempSync(join(tmpdir(), 'ok-upsert-'));
    const store = join(dir, 'db.json');

    const create = runCli(['upsert', 'Stable ID', 'Initial body', '--id', 'k_custom', '--store', store, '--json']);
    expect(create.exitCode).toBe(0);
    const createOut = JSON.parse(new TextDecoder().decode(create.stdout));
    expect(createOut.created).toBe(true);
    expect(createOut.item.short_id).toBe('custom');

    const update = runCli(['upsert', '--id', 'k_custom', '--content', 'Updated body', '--store', store, '--json']);
    expect(update.exitCode).toBe(0);
    const updateOut = JSON.parse(new TextDecoder().decode(update.stdout));
    expect(updateOut.created).toBe(false);
    expect(updateOut.item.content).toBe('Updated body');
  });

  test('project scope uses .hasna/apps/knowledge workspace', () => {
    const dir = mkdtempSync(join(tmpdir(), 'ok-workspace-'));

    const paths = runCli(['paths', '--scope', 'project', '--json'], dir);
    expect(paths.exitCode).toBe(0);
    const pathsOut = JSON.parse(new TextDecoder().decode(paths.stdout));
    expect(pathsOut.home).toBe(join(dir, '.hasna', 'apps', 'knowledge'));
    expect(existsSync(join(dir, '.hasna', 'apps', 'knowledge', 'config.json'))).toBe(true);
    expect(existsSync(join(dir, '.hasna', 'apps', 'knowledge', 'runs'))).toBe(true);
    expect(existsSync(join(dir, '.hasna', 'apps', 'knowledge', 'wiki'))).toBe(true);

    const storage = runCli(['storage', 'status', '--scope', 'project', '--json'], dir);
    expect(storage.exitCode).toBe(0);
    const storageOut = JSON.parse(new TextDecoder().decode(storage.stdout));
    expect(storageOut.local_layout.app_path).toBe(join('.hasna', 'apps', 'knowledge'));
    expect(storageOut.artifact_store.type).toBe('local');
    expect(storageOut.source_ownership.owner).toBe('open-files');
    expect(storageOut.source_ownership.raw_source_bytes_stored_in_open_knowledge).toBe(false);

    const validate = runCli(['storage', 'validate', '--scope', 'project', '--json'], dir);
    expect(validate.exitCode).toBe(0);
    expect(JSON.parse(new TextDecoder().decode(validate.stdout)).ok).toBe(true);

    const add = runCli(['add', 'Project scoped', 'Stored in the Hasna app workspace', '--scope', 'project', '--json'], dir);
    expect(add.exitCode).toBe(0);
    expect(existsSync(join(dir, '.hasna', 'apps', 'knowledge', 'db.json'))).toBe(true);
    expect(existsSync(join(dir, '.open-knowledge', 'db.json'))).toBe(false);
  });

  test('machines topology command exposes adapter-aware topology shape', () => {
    const dir = mkdtempSync(join(tmpdir(), 'ok-machines-cli-'));

    const result = runCli(['machines', 'topology', '--scope', 'project', '--no-tailscale', '--json'], dir);
    expect(result.exitCode).toBe(0);
    const out = JSON.parse(new TextDecoder().decode(result.stdout));
    expect(out.ok).toBe(true);
    expect(['local', 'open-machines']).toContain(out.source);
    expect(out.adapter.package).toBe('@hasna/machines');
    expect(typeof out.adapter.available).toBe('boolean');
    expect(out.knowledge.app_path).toBe(join('.hasna', 'apps', 'knowledge'));
    expect(out.knowledge.workspace_home).toBe(join(dir, '.hasna', 'apps', 'knowledge'));
    expect(out.machines.length).toBeGreaterThanOrEqual(1);
    expect(out.machines.some((machine: any) => machine.local)).toBe(true);
  });

  test('machines preflight checks package and workspace readiness', () => {
    const dir = mkdtempSync(join(tmpdir(), 'ok-machines-preflight-'));
    const bin = join(dir, 'bin');
    mkdirSync(bin, { recursive: true });
    const wrapper = join(bin, 'knowledge');
    writeFileSync(wrapper, `#!/bin/sh\necho "@hasna/knowledge ${packageJson.version}"\n`);
    chmodSync(wrapper, 0o755);

    const result = runCli(
      ['machines', 'preflight', '--scope', 'project', '--workspace', join(__dirname, '..'), '--json'],
      dir,
      { PATH: `${bin}:${process.env.PATH ?? ''}` },
    );
    expect(result.exitCode).toBe(0);
    const out = JSON.parse(new TextDecoder().decode(result.stdout));
    expect(out.ok).toBe(true);
    expect(out.machine_id).toBe('local');
    expect(out.checks.some((check: any) => check.id === 'package:@hasna/knowledge:version' && check.status === 'ok')).toBe(true);
    expect(out.checks.some((check: any) => check.id === 'workspace:open-knowledge:path' && check.status === 'ok')).toBe(true);
    const workspacePackageName = out.checks.find((check: any) => check.id === 'workspace:open-knowledge:package-name');
    if (workspacePackageName) expect(workspacePackageName.status).toBe('ok');
  });

  test('sync doctor exposes machine workspace diagnostics and repair hints', () => {
    const dir = mkdtempSync(join(tmpdir(), 'ok-sync-doctor-'));
    const bin = join(dir, 'bin');
    mkdirSync(bin, { recursive: true });
    writeFakeMachinesRouteBin(bin, 'doctor-spark01.tailnet.test', '/remote/open-knowledge', true);

    const result = runCli(['sync', 'doctor', '--machine', 'spark01', '--scope', 'project', '--json'], dir, {
      PATH: `${bin}:${process.env.PATH ?? ''}`,
    });

    expect(result.exitCode).toBe(0);
    const out = JSON.parse(new TextDecoder().decode(result.stdout));
    expect(out.package.name).toBe('@hasna/knowledge');
    expect(out.read_only).toBe(true);
    expect(out.resolved_route).toMatchObject({
      target: 'doctor-spark01.tailnet.test',
      route: 'tailscale',
      confidence: 'high',
    });
    expect(out.resolved_workspace).toMatchObject({
      project_root: '/remote/open-knowledge',
      open_files_root: '/remote/open-files',
      diagnostics: [{
        id: 'project_root',
        status: 'inferred',
        severity: 'warn',
      }],
    });
    expect(out.resolved_workspace.repair_hints[0].shell_command).toContain('machines workspace repair');
    expect(out.recommended_commands.some((command: any) => command.id === 'machines_workspace_repair')).toBe(true);
    expect(out.open_files.raw_source_bytes_owned_by).toBe('open-files');
  });

  test('sync doctor reports S3 generated artifact manifest readiness without raw source bytes', () => {
    const dir = mkdtempSync(join(tmpdir(), 'ok-sync-doctor-s3-'));
    const service = createKnowledgeService({ scope: 'project', cwd: dir });
    const workspace = service.ensureWorkspace();
    const config = defaultKnowledgeConfig();
    config.mode = 'hosted';
    config.storage = {
      type: 's3',
      artifacts_root: 'artifacts',
      s3: {
        bucket: 'knowledge-bucket',
        prefix: 'org/project/knowledge',
        region: 'us-east-1',
        server_side_encryption: 'AES256',
      },
    };
    writeKnowledgeConfig(workspace.configPath, config);
    service.initDb();

    const opened = openKnowledgeDb(workspace.knowledgeDbPath);
    try {
      recordStorageObjects(opened, [{
        uri: 's3://knowledge-bucket/org/project/knowledge/wiki/README.md',
        key: 'wiki/README.md',
        kind: 'wiki_page',
        content_type: 'text/markdown',
        hash: 'sha256:readme',
        size_bytes: 128,
        metadata: { provenance: { generated_from: 'test' } },
      }], new Date('2026-06-09T00:00:00.000Z'));
    } finally {
      opened.close();
    }

    const result = runCli(['sync', 'doctor', '--scope', 'project', '--json'], dir);

    expect(result.exitCode).toBe(0);
    const out = JSON.parse(new TextDecoder().decode(result.stdout));
    expect(out.storage.artifact_manifest).toMatchObject({
      ok: true,
      read_only: true,
      storage_type: 's3',
      artifact_uri_prefix: 's3://knowledge-bucket/org/project/knowledge/',
      artifacts: {
        total: 1,
        with_hash: 1,
        missing_hash: 0,
        with_size: 1,
        missing_size: 0,
        total_size_bytes: 128,
      },
      uri_prefix: {
        matching: 1,
        mismatched: 0,
      },
      keys: {
        with_key: 1,
        missing_key: 0,
        prefixed_with_storage_prefix: 0,
      },
      sync_manifest: {
        copied_by_sync: true,
        generated_artifacts_only: true,
        includes_raw_source_bytes: false,
        hash_algorithm: 'sha256',
        portable_keys: true,
      },
      raw_payload_sentinel_hits: 0,
    });
    expect(out.storage.artifact_manifest.s3).toMatchObject({
      bucket: 'knowledge-bucket',
      prefix: 'org/project/knowledge',
      region: 'us-east-1',
      server_side_encryption: 'AES256',
    });
    expect(out.warnings).not.toContain('artifact_manifest_raw_payload_sentinels:1');
  });

  test('sync doctor flags legacy S3 artifact keys and raw payload sentinels', () => {
    const dir = mkdtempSync(join(tmpdir(), 'ok-sync-doctor-s3-legacy-'));
    const service = createKnowledgeService({ scope: 'project', cwd: dir });
    const workspace = service.ensureWorkspace();
    const config = defaultKnowledgeConfig();
    config.mode = 'hosted';
    config.storage = {
      type: 's3',
      artifacts_root: 'artifacts',
      s3: {
        bucket: 'knowledge-bucket',
        prefix: 'org/project/knowledge',
        region: 'us-east-1',
      },
    };
    writeKnowledgeConfig(workspace.configPath, config);
    service.initDb();

    const opened = openKnowledgeDb(workspace.knowledgeDbPath);
    try {
      recordStorageObjects(opened, [{
        uri: 's3://knowledge-bucket/org/project/knowledge/wiki/legacy.md',
        key: 'org/project/knowledge/wiki/legacy.md',
        kind: 'wiki_page',
        content_type: 'text/markdown',
        hash: 'sha256:legacy',
        size_bytes: 256,
        metadata: {
          raw_content: 'legacy raw payload should not be in storage object metadata',
        },
      }], new Date('2026-06-09T00:00:00.000Z'));
    } finally {
      opened.close();
    }

    const result = runCli(['sync', 'doctor', '--scope', 'project', '--json'], dir);

    expect(result.exitCode).toBe(0);
    const out = JSON.parse(new TextDecoder().decode(result.stdout));
    expect(out.ok).toBe(false);
    expect(out.storage.artifact_manifest).toMatchObject({
      ok: false,
      raw_payload_sentinel_hits: 1,
      keys: {
        prefixed_with_storage_prefix: 1,
        prefixed_examples: ['org/project/knowledge/wiki/legacy.md'],
      },
      sync_manifest: {
        includes_raw_source_bytes: false,
        portable_keys: false,
      },
    });
    expect(out.storage.artifact_manifest.warnings).toContain('artifact_manifest_s3_key_contains_storage_prefix:1');
    expect(out.storage.artifact_manifest.warnings).toContain('artifact_manifest_raw_payload_sentinels:1');
    expect(out.warnings).toContain('artifact_manifest_s3_key_contains_storage_prefix:1');
    expect(out.warnings).toContain('artifact_manifest_raw_payload_sentinels:1');
  });

  test('storage repair-artifact-keys previews and repairs legacy S3 keys with approval', () => {
    const dir = mkdtempSync(join(tmpdir(), 'ok-storage-repair-s3-'));
    const service = createKnowledgeService({ scope: 'project', cwd: dir });
    const workspace = service.ensureWorkspace();
    const config = defaultKnowledgeConfig();
    config.mode = 'hosted';
    config.storage = {
      type: 's3',
      artifacts_root: 'artifacts',
      s3: {
        bucket: 'knowledge-bucket',
        prefix: 'org/project/knowledge',
        region: 'us-east-1',
      },
    };
    writeKnowledgeConfig(workspace.configPath, config);
    service.initDb();

    const opened = openKnowledgeDb(workspace.knowledgeDbPath);
    try {
      recordStorageObjects(opened, [{
        uri: 's3://knowledge-bucket/org/project/knowledge/wiki/legacy.md',
        key: 'org/project/knowledge/wiki/legacy.md',
        kind: 'wiki_page',
        content_type: 'text/markdown',
        hash: 'sha256:legacy',
        size_bytes: 256,
        metadata: { provenance: { generated_from: 'legacy-s3' } },
      }], new Date('2026-06-09T00:00:00.000Z'));
    } finally {
      opened.close();
    }

    const preview = runCli(['storage', 'repair-artifact-keys', '--scope', 'project', '--json'], dir);
    expect(preview.exitCode).toBe(0);
    const previewOut = JSON.parse(new TextDecoder().decode(preview.stdout));
    expect(previewOut).toMatchObject({
      ok: false,
      dry_run: true,
      approval_required: true,
      repaired: 0,
      storage_prefix: 'org/project/knowledge/',
      candidates: [{
        current_key: 'org/project/knowledge/wiki/legacy.md',
        repaired_key: 'wiki/legacy.md',
      }],
    });

    const explicitDryRun = runCli([
      'storage',
      'repair-artifact-keys',
      '--scope',
      'project',
      '--dry-run',
      '--approve-write',
      '--approved-by',
      'test-reviewer',
      '--json',
    ], dir);
    const explicitDryRunOut = JSON.parse(new TextDecoder().decode(explicitDryRun.stdout));
    expect(explicitDryRunOut).toMatchObject({
      ok: true,
      dry_run: true,
      approval_required: false,
      repaired: 0,
    });

    const approved = runCli([
      'storage',
      'repair-artifact-keys',
      '--scope',
      'project',
      '--approve-write',
      '--approved-by',
      'test-reviewer',
      '--json',
    ], dir);
    expect(approved.exitCode).toBe(0);
    const approvedOut = JSON.parse(new TextDecoder().decode(approved.stdout));
    expect(approvedOut).toMatchObject({
      ok: true,
      dry_run: false,
      approval_required: false,
      repaired: 1,
    });
    expect(approvedOut.audit_event_id).toStartWith('audit_');

    const repairedDb = openKnowledgeDb(workspace.knowledgeDbPath);
    try {
      const row = repairedDb.query<{ metadata_json: string }, []>('SELECT metadata_json FROM storage_objects').get();
      expect(JSON.parse(row?.metadata_json ?? '{}').key).toBe('wiki/legacy.md');
      const audit = repairedDb.query<{ n: number }, []>("SELECT COUNT(*) AS n FROM audit_events WHERE action = 'storage.artifact_manifest.repair_keys'").get();
      expect(audit?.n).toBe(1);
    } finally {
      repairedDb.close();
    }

    const doctor = runCli(['sync', 'doctor', '--scope', 'project', '--json'], dir);
    const doctorOut = JSON.parse(new TextDecoder().decode(doctor.stdout));
    expect(doctorOut.ok).toBe(true);
    expect(doctorOut.storage.artifact_manifest.keys.prefixed_with_storage_prefix).toBe(0);
    expect(doctorOut.storage.artifact_manifest.warnings).not.toContain('artifact_manifest_s3_key_contains_storage_prefix:1');
  });

  test('global store migrates legacy .open-knowledge data into the Hasna app path', () => {
    const home = mkdtempSync(join(tmpdir(), 'ok-legacy-home-'));
    const legacyDir = join(home, '.open-knowledge');
    mkdirSync(legacyDir, { recursive: true });
    writeFileSync(join(legacyDir, 'db.json'), `${JSON.stringify({
      items: [{
        id: 'k_legacy_contract',
        short_id: 'legacy_contr',
        title: 'Legacy global item',
        content: 'Migrated into the Hasna app workspace.',
        tags: ['legacy'],
        metadata: {},
        archived: false,
        created_at: '2026-06-08T00:00:00.000Z',
        updated_at: '2026-06-08T00:00:00.000Z',
      }],
    }, null, 2)}\n`);

    const list = runCli(['list', '--json'], undefined, { HOME: home });
    expect(list.exitCode).toBe(0);
    const listOut = JSON.parse(new TextDecoder().decode(list.stdout));
    expect(listOut.total).toBe(1);
    expect(listOut.items[0].title).toBe('Legacy global item');
    expect(existsSync(join(home, '.hasna', 'apps', 'knowledge', 'db.json'))).toBe(true);
  });

  test('setup, auth, and remote commands expose hosted-aware JSON contracts', () => {
    const dir = mkdtempSync(join(tmpdir(), 'ok-hosted-cli-'));
    const authDir = join(dir, 'auth');
    const env = { HASNA_KNOWLEDGE_AUTH_DIR: authDir };

    const setup = runCli(['setup', '--mode', 'hosted', '--api-url', 'https://knowledge.example.com/api/v1', '--scope', 'project', '--json'], dir, env);
    expect(setup.exitCode).toBe(0);
    const setupOut = JSON.parse(new TextDecoder().decode(setup.stdout));
    expect(setupOut.mode).toBe('hosted');
    expect(setupOut.api_url).toBe('https://knowledge.example.com');
    expect(setupOut.storage_type).toBe('local');

    const storage = runCli(['storage', 'status', '--scope', 'project', '--json'], dir, env);
    expect(storage.exitCode).toBe(0);
    const storageOut = JSON.parse(new TextDecoder().decode(storage.stdout));
    expect(storageOut.hosted.enabled).toBe(true);
    expect(storageOut.hosted.api_url).toBe('https://knowledge.example.com');
    expect(storageOut.canonical_hasna_xyz.active).toBe(false);

    const before = runCli(['auth', 'whoami', '--scope', 'project', '--json'], dir, env);
    expect(before.exitCode).toBe(0);
    expect(JSON.parse(new TextDecoder().decode(before.stdout)).authenticated).toBe(false);

    const login = runCli(['auth', 'login', '--api-key', 'kh_cli', '--email', 'agent@example.com', '--org', 'hasna', '--scope', 'project', '--json'], dir, env);
    expect(login.exitCode).toBe(0);
    const loginOut = JSON.parse(new TextDecoder().decode(login.stdout));
    expect(loginOut.authenticated).toBe(true);
    expect(loginOut.email).toBe('agent@example.com');
    expect(existsSync(join(authDir, 'auth.json'))).toBe(true);

    const remote = runCli(['remote', 'status', '--scope', 'project', '--json'], dir, env);
    expect(remote.exitCode).toBe(0);
    const remoteOut = JSON.parse(new TextDecoder().decode(remote.stdout));
    expect(remoteOut.client_ready).toBe(true);
    expect(remoteOut.capabilities).toContain('s3-generated-artifacts');

    const contracts = runCli(['remote', 'contracts', '--scope', 'project', '--json'], dir, env);
    expect(contracts.exitCode).toBe(0);
    const contractsOut = JSON.parse(new TextDecoder().decode(contracts.stdout));
    expect(contractsOut.contract.source_contract.owner).toBe('open-files');
    expect(contractsOut.contract.endpoints.ask).toBe('/api/v1/knowledge/ask');

    const logout = runCli(['auth', 'logout', '--scope', 'project', '--json'], dir, env);
    expect(logout.exitCode).toBe(0);
    expect(JSON.parse(new TextDecoder().decode(logout.stdout)).removed).toBe(true);
  });

  test('setup can opt into canonical Hasna XYZ S3 artifact storage', () => {
    const dir = mkdtempSync(join(tmpdir(), 'ok-canonical-storage-cli-'));

    const setup = runCli(['setup', '--mode', 'hosted', '--canonical-hasna-xyz', '--scope', 'project', '--json'], dir);
    expect(setup.exitCode).toBe(0);
    const setupOut = JSON.parse(new TextDecoder().decode(setup.stdout));
    expect(setupOut.storage_type).toBe('s3');
    expect(setupOut.artifact_uri_prefix).toBe('s3://hasna-xyz-opensource-knowledge-prod/.hasna/apps/knowledge/');
    expect(setupOut.canonical_hasna_xyz.active).toBe(true);

    const storage = runCli(['storage', 'status', '--scope', 'project', '--json'], dir);
    expect(storage.exitCode).toBe(0);
    const storageOut = JSON.parse(new TextDecoder().decode(storage.stdout));
    expect(storageOut.artifact_store.s3).toMatchObject({
      bucket: 'hasna-xyz-opensource-knowledge-prod',
      prefix: '.hasna/apps/knowledge',
      region: 'us-east-1',
      profile: 'hasna-xyz-infra',
    });
    expect(storageOut.canonical_hasna_xyz.secrets).toMatchObject({
      env: 'hasna/xyz/opensource/knowledge/prod/env',
      aws: 'hasna/xyz/opensource/knowledge/prod/aws',
      s3: 'hasna/xyz/opensource/knowledge/prod/s3',
      future_rds: 'hasna/xyz/opensource/knowledge/prod/rds',
    });
  });

  test('db init and stats create project knowledge.db', () => {
    const dir = mkdtempSync(join(tmpdir(), 'ok-db-cli-'));

    const init = runCli(['db', 'init', '--scope', 'project', '--json'], dir);
    expect(init.exitCode).toBe(0);
    const initOut = JSON.parse(new TextDecoder().decode(init.stdout));
    expect(initOut.schema_version).toBe(7);
    expect(existsSync(join(dir, '.hasna', 'apps', 'knowledge', 'knowledge.db'))).toBe(true);

    const stats = runCli(['db', 'stats', '--scope', 'project', '--json'], dir);
    expect(stats.exitCode).toBe(0);
    const statsOut = JSON.parse(new TextDecoder().decode(stats.stdout));
    expect(statsOut.schema_version).toBe(7);
    expect(statsOut.sources).toBe(0);
    expect(statsOut.runs).toBe(0);

    const storage = runCli(['db', 'storage', 'status', '--scope', 'project', '--json'], dir);
    expect(storage.exitCode).toBe(0);
    const storageOut = JSON.parse(new TextDecoder().decode(storage.stdout));
    expect(storageOut.service).toBe('knowledge');
    expect(storageOut.mode).toBe('local');
    expect(storageOut.tables).toContain('sources');
    expect(storageOut.tables).not.toContain('chunks_fts');
  });

  test('sync status, snapshot, machines, and conflicts use the project catalog', () => {
    const dir = mkdtempSync(join(tmpdir(), 'ok-sync-cli-'));

    const status = runCli(['sync', 'status', '--scope', 'project', '--json'], dir);
    expect(status.exitCode).toBe(0);
    const statusOut = JSON.parse(new TextDecoder().decode(status.stdout));
    expect(statusOut.sqlite_schema_version).toBe(7);
    expect(statusOut.machines.total).toBe(0);
    expect(statusOut.conflicts.open).toBe(0);

    const snapshot = runCli(['sync', 'snapshot', '--scope', 'project', '--no-tailscale', '--json'], dir);
    expect(snapshot.exitCode).toBe(0);
    const snapshotOut = JSON.parse(new TextDecoder().decode(snapshot.stdout));
    expect(snapshotOut.ok).toBe(true);
    expect(snapshotOut.snapshot.content_hash).toStartWith('sha256:');
    expect(snapshotOut.machines_upserted).toBeGreaterThanOrEqual(1);

    const machines = runCli(['sync', 'machines', '--scope', 'project', '--json'], dir);
    expect(machines.exitCode).toBe(0);
    const machinesOut = JSON.parse(new TextDecoder().decode(machines.stdout));
    expect(machinesOut.machines.length).toBeGreaterThanOrEqual(1);

    const conflicts = runCli(['sync', 'conflicts', '--scope', 'project', '--json'], dir);
    expect(conflicts.exitCode).toBe(0);
    const conflictsOut = JSON.parse(new TextDecoder().decode(conflicts.stdout));
    expect(conflictsOut.conflicts).toEqual([]);

    const service = createKnowledgeService({ scope: 'project', cwd: dir });
    const conflict = recordKnowledgeSyncConflict(service.ensureWorkspace().knowledgeDbPath, {
      entityKind: 'wiki_pages',
      entityId: 'wiki/handbook.md',
      localMachineId: 'spark02',
      remoteMachineId: 'spark01',
      localHash: 'sha256:local',
      remoteHash: 'sha256:remote',
      baseHash: 'sha256:base',
      metadata: {
        reason: 'cli conflict workflow',
        remote_row: {
          id: 'wiki/handbook.md',
          path: 'wiki/handbook.md',
          title: 'Remote handbook draft',
          source_ref: 'open-files://file/cli_conflict',
        },
      },
    });

    const show = runCli(['sync', 'conflicts', 'show', conflict.id, '--scope', 'project', '--json'], dir);
    expect(show.exitCode).toBe(0);
    const showOut = JSON.parse(new TextDecoder().decode(show.stdout));
    expect(showOut.conflict.id).toBe(conflict.id);
    expect(showOut.conflict.metadata.reason).toBe('cli conflict workflow');

    const propose = runCli(['sync', 'conflicts', 'propose', conflict.id, '--scope', 'project', '--json'], dir);
    expect(propose.exitCode).toBe(0);
    const proposeOut = JSON.parse(new TextDecoder().decode(propose.stdout));
    expect(proposeOut.requires_approval).toBe(true);
    expect(proposeOut.mode).toBe('deterministic');
    expect(proposeOut.merge_prompt).toContain('Do not write changes without approval');

    const aiPropose = runCli(['sync', 'conflicts', 'propose', conflict.id, '--mode', 'ai', '--model', 'openai:gpt-5-mini', '--fake', '--scope', 'project', '--json'], dir);
    expect(aiPropose.exitCode).toBe(0);
    const aiProposeOut = JSON.parse(new TextDecoder().decode(aiPropose.stdout));
    expect(aiProposeOut.mode).toBe('ai');
    expect(aiProposeOut.requires_approval).toBe(true);
    expect(aiProposeOut.proposed_patch.summary).toContain('Fake AI proposal');
    expect(aiProposeOut.confidence).toBeGreaterThanOrEqual(0);
    expect(aiProposeOut.agent.provider).toBe('openai');
    expect(aiProposeOut.agent.read_only_tools.some((tool: any) => tool.name === 'knowledge_sync_conflict_get')).toBe(true);
    expect(aiProposeOut.citations.some((citation: any) => citation.ref === 'open-files://file/cli_conflict')).toBe(true);

    const blockedResolve = runCli(['sync', 'conflicts', 'resolve', conflict.id, '--scope', 'project', '--strategy', 'manual-merge', '--json'], dir);
    expect(blockedResolve.exitCode).toBe(0);
    const blockedOut = JSON.parse(new TextDecoder().decode(blockedResolve.stdout));
    expect(blockedOut.ok).toBe(false);
    expect(blockedOut.approval_required).toBe(true);

    const resolved = runCli([
      'sync', 'conflicts', 'resolve', conflict.id,
      '--scope', 'project',
      '--strategy', 'manual-merge',
      '--approve-write',
      '--approved-by', 'cli-reviewer',
      '--patch-uri', 'file:///tmp/cli.patch',
      '--json',
    ], dir);
    expect(resolved.exitCode).toBe(0);
    const resolvedOut = JSON.parse(new TextDecoder().decode(resolved.stdout));
    expect(resolvedOut.ok).toBe(true);
    expect(resolvedOut.conflict.status).toBe('resolved');
    expect(resolvedOut.conflict.approved_by).toBe('cli-reviewer');
    expect(resolvedOut.audit_event_id).toStartWith('audit_');
  });

  test('sync dry-run and push copy a project catalog into a peer workspace', () => {
    const sourceDir = mkdtempSync(join(tmpdir(), 'ok-sync-cli-source-'));
    const peerDir = mkdtempSync(join(tmpdir(), 'ok-sync-cli-peer-'));
    const source = join(sourceDir, 'sync-source.md');
    writeFileSync(source, 'CLI peer sync should move derived rows and generated artifacts.');

    expect(runCli(['ingest', 'source', `file://${source}`, '--scope', 'project', '--json'], sourceDir).exitCode).toBe(0);
    expect(runCli(['wiki', 'init', '--scope', 'project', '--json'], sourceDir).exitCode).toBe(0);

    const dryRun = runCli(['sync', 'dry-run', '--peer-workspace', peerDir, '--scope', 'project', '--json'], sourceDir);
    expect(dryRun.exitCode).toBe(0);
    const dryRunOut = JSON.parse(new TextDecoder().decode(dryRun.stdout));
    expect(dryRunOut.dry_run).toBe(true);
    expect(dryRunOut.push.tables.find((table: any) => table.table === 'sources').inserted).toBe(1);
    expect(existsSync(join(peerDir, '.hasna', 'apps', 'knowledge', 'artifacts', 'wiki', 'README.md'))).toBe(false);

    const push = runCli(['sync', 'push', '--peer-workspace', peerDir, '--scope', 'project', '--json'], sourceDir);
    expect(push.exitCode).toBe(0);
    const pushOut = JSON.parse(new TextDecoder().decode(push.stdout));
    expect(pushOut.ok).toBe(true);
    expect(pushOut.push.artifacts.copied).toBeGreaterThanOrEqual(1);
    expect(existsSync(join(peerDir, '.hasna', 'apps', 'knowledge', 'artifacts', 'wiki', 'README.md'))).toBe(true);

    const peerStats = runCli(['db', 'stats', '--scope', 'project', '--json'], peerDir);
    expect(peerStats.exitCode).toBe(0);
    const peerStatsOut = JSON.parse(new TextDecoder().decode(peerStats.stdout));
    expect(peerStatsOut.sources).toBe(1);
    expect(peerStatsOut.storage_objects).toBe(4);
  });

  test('sync peer-workspace works without machines adapter calls', () => {
    const sourceDir = mkdtempSync(join(tmpdir(), 'ok-sync-no-machines-source-'));
    const peerDir = mkdtempSync(join(tmpdir(), 'ok-sync-no-machines-peer-'));
    const bin = join(sourceDir, 'bin');
    const machinesMarker = join(sourceDir, 'machines-called.txt');
    const source = join(sourceDir, 'sync-source.md');
    writeFailingMachinesBin(bin, machinesMarker);
    writeFileSync(source, 'Explicit peer workspace sync must not require open-machines.');

    const env = { PATH: `${bin}:${process.env.PATH ?? ''}` };
    expect(runCli(['ingest', 'source', `file://${source}`, '--scope', 'project', '--json'], sourceDir, env).exitCode).toBe(0);
    expect(runCli(['wiki', 'init', '--scope', 'project', '--json'], sourceDir, env).exitCode).toBe(0);

    const dryRun = runCli(['sync', 'dry-run', '--peer-workspace', peerDir, '--scope', 'project', '--json'], sourceDir, env);
    expect(dryRun.exitCode).toBe(0);
    const dryRunOut = JSON.parse(new TextDecoder().decode(dryRun.stdout));
    expect(dryRunOut.dry_run).toBe(true);
    expect(dryRunOut.resolved_workspace).toMatchObject({
      source: 'argument',
      project_root: resolve(peerDir),
      project_root_source: 'argument',
      adapter: {
        implementation: 'disabled',
        available: false,
        error: 'argument_override',
      },
    });
    expect(existsSync(machinesMarker)).toBe(false);

    const push = runCli(['sync', 'push', '--peer-workspace', peerDir, '--scope', 'project', '--json'], sourceDir, env);
    expect(push.exitCode).toBe(0);
    const pushOut = JSON.parse(new TextDecoder().decode(push.stdout));
    expect(pushOut.ok).toBe(true);
    expect(pushOut.push.artifacts.copied).toBeGreaterThanOrEqual(1);
    expect(pushOut.resolved_workspace.adapter.error).toBe('argument_override');
    expect(existsSync(machinesMarker)).toBe(false);
  });

  test('sync export and import move a bundle through stdin/stdout', () => {
    const sourceDir = mkdtempSync(join(tmpdir(), 'ok-sync-export-source-'));
    const peerDir = mkdtempSync(join(tmpdir(), 'ok-sync-export-peer-'));
    const source = join(sourceDir, 'sync-export-source.md');
    writeFileSync(source, 'CLI export import should support SSH bundle transport.');

    expect(runCli(['ingest', 'source', `file://${source}`, '--scope', 'project', '--json'], sourceDir).exitCode).toBe(0);
    expect(runCli(['wiki', 'init', '--scope', 'project', '--json'], sourceDir).exitCode).toBe(0);

    const exported = runCli(['sync', 'export', '--scope', 'project', '--json'], sourceDir);
    expect(exported.exitCode).toBe(0);
    const bundle = JSON.parse(new TextDecoder().decode(exported.stdout));
    expect(bundle.format).toBe('knowledge-sync-bundle');
    expect(bundle.protocol_version).toBe(2);
    expect(bundle.min_protocol_version).toBe(1);
    expect(bundle.artifacts.length).toBe(4);

    const imported = runCliWithInput(['sync', 'import', '--scope', 'project', '--json'], JSON.stringify(bundle), peerDir);
    expect(imported.exitCode).toBe(0);
    const importedOut = JSON.parse(new TextDecoder().decode(imported.stdout));
    expect(importedOut.ok).toBe(true);
    expect(importedOut.protocol_version).toBe(2);
    expect(importedOut.min_protocol_version).toBe(1);
    expect(importedOut.artifacts.copied).toBe(4);
    expect(existsSync(join(peerDir, '.hasna', 'apps', 'knowledge', 'artifacts', 'wiki', 'README.md'))).toBe(true);
  });

  test('ssh sync rejects remote export without protocol handshake', () => {
    const dir = mkdtempSync(join(tmpdir(), 'ok-sync-ssh-old-export-'));
    const bin = writeFakeSshBin(dir);
    const oldBundle = {
      ok: true,
      format: 'knowledge-sync-bundle',
      version: 1,
      generated_at: '2026-06-09T00:00:00.000Z',
      source: {
        scope: 'project',
        workspace_home: '/remote/.hasna/apps/knowledge',
        sqlite_schema_version: 6,
        machine_id: 'spark01',
        artifact_root_uri: 'file:///remote/.hasna/apps/knowledge/artifacts/',
      },
      tables: [],
      artifacts: [],
      warnings: [],
      message: 'old bundle without protocol fields',
    };

    const result = runCli(['sync', 'pull', '--machine', 'spark01', '--peer-workspace', '/remote/open-knowledge', '--scope', 'project', '--json'], dir, {
      PATH: `${bin}:${process.env.PATH ?? ''}`,
      KNOWLEDGE_FAKE_SSH_EXPORT_JSON: JSON.stringify(oldBundle),
    });

    expect(result.exitCode).toBe(1);
    expect(new TextDecoder().decode(result.stderr)).toContain('unsupported sync protocol');
  });

  test('ssh sync resolves machine target through machines route when available', () => {
    const dir = mkdtempSync(join(tmpdir(), 'ok-sync-ssh-route-'));
    const targetPath = join(dir, 'ssh-target.txt');
    const bin = writeFakeSshBin(dir);
    writeFakeMachinesRouteBin(bin, 'routed-spark01.tailnet.test');
    const bundle = {
      ok: true,
      format: 'knowledge-sync-bundle',
      version: 1,
      protocol_version: 1,
      min_protocol_version: 1,
      generated_at: '2026-06-09T00:00:00.000Z',
      source: {
        scope: 'project',
        workspace_home: '/remote/.hasna/apps/knowledge',
        sqlite_schema_version: 6,
        machine_id: 'spark01',
        artifact_root_uri: 'file:///remote/.hasna/apps/knowledge/artifacts/',
      },
      tables: [],
      artifacts: [],
      warnings: [],
      message: 'valid empty bundle',
    };

    const result = runCli(['sync', 'pull', '--machine', 'spark01', '--peer-workspace', '/remote/open-knowledge', '--scope', 'project', '--json'], dir, {
      PATH: `${bin}:${process.env.PATH ?? ''}`,
      KNOWLEDGE_FAKE_SSH_EXPORT_JSON: JSON.stringify(bundle),
      KNOWLEDGE_FAKE_SSH_TARGET_PATH: targetPath,
    });

    expect(result.exitCode).toBe(0);
    expect(readFileSync(targetPath, 'utf8')).toBe('routed-spark01.tailnet.test');
    const out = JSON.parse(new TextDecoder().decode(result.stdout));
    expect(out.resolved_machine).toBe('routed-spark01.tailnet.test');
    expect(out.resolved_route).toMatchObject({
      source: 'open-machines',
      adapter: {
        implementation: 'cli',
        available: true,
      },
      target: 'routed-spark01.tailnet.test',
      route: 'tailscale',
      target_kind: 'tailscale',
      confidence: 'high',
      evidence: {
        topology: true,
        matched_by: 'machine_id',
        selected_hint: {
          kind: 'tailscale',
          target: 'routed-spark01.tailnet.test',
          reachable: true,
        },
      },
    });
  });

  test('ssh sync resolves peer workspace through machines path mapping when omitted', () => {
    const dir = mkdtempSync(join(tmpdir(), 'ok-sync-ssh-workspace-'));
    const targetPath = join(dir, 'ssh-target.txt');
    const bin = writeFakeSshBin(dir);
    writeFakeMachinesRouteBin(bin, 'routed-spark01.tailnet.test', '/mapped/open-knowledge');
    const bundle = {
      ok: true,
      format: 'knowledge-sync-bundle',
      version: 1,
      protocol_version: 1,
      min_protocol_version: 1,
      generated_at: '2026-06-09T00:00:00.000Z',
      source: {
        scope: 'project',
        workspace_home: '/mapped/open-knowledge/.hasna/apps/knowledge',
        sqlite_schema_version: 6,
        machine_id: 'spark01',
        artifact_root_uri: 'file:///mapped/open-knowledge/.hasna/apps/knowledge/artifacts/',
      },
      tables: [],
      artifacts: [],
      warnings: [],
      message: 'valid empty bundle',
    };

    const result = runCli(['sync', 'pull', '--machine', 'spark01', '--scope', 'project', '--json'], dir, {
      PATH: `${bin}:${process.env.PATH ?? ''}`,
      KNOWLEDGE_FAKE_SSH_EXPORT_JSON: JSON.stringify(bundle),
      KNOWLEDGE_FAKE_SSH_TARGET_PATH: targetPath,
    });

    expect(result.exitCode).toBe(0);
    expect(readFileSync(targetPath, 'utf8')).toBe('routed-spark01.tailnet.test');
    const out = JSON.parse(new TextDecoder().decode(result.stdout));
    expect(out.peer_workspace).toBe('/mapped/open-knowledge');
    expect(out.resolved_workspace).toMatchObject({
      source: 'open-machines',
      adapter: {
        implementation: 'cli',
        available: true,
      },
      project_root: '/mapped/open-knowledge',
      project_root_source: 'manifest_metadata',
      open_files_root: '/remote/open-files',
      trust_status: 'trusted',
    });
  });

  test('ssh sync rejects remote import result without protocol handshake before accepting push', () => {
    const dir = mkdtempSync(join(tmpdir(), 'ok-sync-ssh-old-import-'));
    const stdinPath = join(dir, 'remote-import-stdin.json');
    const bin = writeFakeSshBin(dir);
    const oldImportResult = {
      ok: true,
      dry_run: true,
      direction: 'import',
      source: {
        scope: 'project',
        workspace_home: `${dir}/.hasna/apps/knowledge`,
        sqlite_schema_version: 6,
        machine_id: 'spark02',
        artifact_root_uri: `file://${dir}/.hasna/apps/knowledge/artifacts/`,
      },
      target: {
        scope: 'project',
        workspace_home: '/remote/.hasna/apps/knowledge',
        sqlite_schema_version: 6,
        artifact_root_uri: 'file:///remote/.hasna/apps/knowledge/artifacts/',
      },
      tables: [],
      artifacts: { source_artifacts: 0, target_artifacts: 0, copied: 0, skipped: 0, conflicts: 0, missing_content: 0 },
      conflicts_created: 0,
      warnings: [],
      message: 'old import result without protocol fields',
    };

    const result = runCli(['sync', 'push', '--machine', 'spark01', '--peer-workspace', '/remote/open-knowledge', '--scope', 'project', '--json', '--dry-run'], dir, {
      PATH: `${bin}:${process.env.PATH ?? ''}`,
      KNOWLEDGE_FAKE_SSH_IMPORT_JSON: JSON.stringify(oldImportResult),
      KNOWLEDGE_FAKE_SSH_STDIN_PATH: stdinPath,
    });

    expect(result.exitCode).toBe(1);
    expect(new TextDecoder().decode(result.stderr)).toContain('unsupported sync protocol');
    const pushedBundle = JSON.parse(readFileSync(stdinPath, 'utf8'));
    expect(pushedBundle.protocol_version).toBe(2);
    expect(pushedBundle.min_protocol_version).toBe(1);
  });

  test('ingest manifest imports open-files refs into project knowledge.db', () => {
    const dir = mkdtempSync(join(tmpdir(), 'ok-ingest-cli-'));
    const manifest = join(dir, 'manifest.jsonl');
    const outbox = join(dir, 'outbox.jsonl');
    writeFileSync(manifest, `${JSON.stringify({
      source_ref: 'open-files://file/file_123/revision/rev_cli',
      file_id: 'file_123',
      source_id: 'src_local',
      path: 'docs/handbook.md',
      name: 'handbook.md',
      mime: 'text/markdown',
      size: 64,
      hash: 'sha256:cli',
      status: 'active',
      updated_at: '2026-06-08T00:00:00.000Z',
      permissions: { mode: 'read_only' },
      extracted_text: 'This handbook was ingested from open-files.',
    })}\n`);

    const ingest = runCli(['ingest', 'manifest', manifest, '--scope', 'project', '--json'], dir);
    expect(ingest.exitCode).toBe(0);
    const ingestOut = JSON.parse(new TextDecoder().decode(ingest.stdout));
    expect(ingestOut.items_seen).toBe(1);
    expect(ingestOut.sources_upserted).toBe(1);
    expect(ingestOut.revisions_upserted).toBe(1);
    expect(ingestOut.chunks_inserted).toBe(1);
    expect(ingestOut.audit_events).toBeUndefined();

    const stats = runCli(['db', 'stats', '--scope', 'project', '--json'], dir);
    expect(stats.exitCode).toBe(0);
    const statsOut = JSON.parse(new TextDecoder().decode(stats.stdout));
    expect(statsOut.sources).toBe(1);
    expect(statsOut.source_revisions).toBe(1);
    expect(statsOut.chunks).toBe(1);

    const resolve = runCli(['source', 'resolve', 'open-files://file/file_123/revision/rev_cli', '--scope', 'project', '--json'], dir);
    expect(resolve.exitCode).toBe(0);
    const resolveOut = JSON.parse(new TextDecoder().decode(resolve.stdout));
    expect(resolveOut.resolved).toBe(true);
    expect(resolveOut.read_only).toBe(true);
    expect(resolveOut.content.bytes_exposed).toBe(false);
    expect(resolveOut.content.chunks_returned).toBe(1);
    expect(resolveOut.chunks[0].text).toContain('open-files');
    expect(resolveOut.chunks[0].evidence).toMatchObject({
      resolver: 'open-files-read-only',
      mode: 'local_catalog',
      purpose: 'knowledge_answer',
      read_only: true,
      source_uri: 'open-files://file/file_123',
      revision: 'rev_cli',
    });

    writeFileSync(outbox, `${JSON.stringify({
      event: 'deleted',
      source_ref: 'open-files://file/file_123/revision/rev_cli',
      status: 'deleted',
      hash: 'sha256:cli',
      updated_at: '2026-06-08T00:01:00.000Z',
    })}\n`);

    const reindex = runCli(['reindex', 'outbox', outbox, '--scope', 'project', '--json'], dir);
    expect(reindex.exitCode).toBe(0);
    const reindexOut = JSON.parse(new TextDecoder().decode(reindex.stdout));
    expect(reindexOut.events_seen).toBe(1);
    expect(reindexOut.chunks_deleted).toBe(1);
    expect(reindexOut.deleted_sources).toBe(1);

    const statsAfter = runCli(['db', 'stats', '--scope', 'project', '--json'], dir);
    expect(statsAfter.exitCode).toBe(0);
    const statsAfterOut = JSON.parse(new TextDecoder().decode(statsAfter.stdout));
    expect(statsAfterOut.chunks).toBe(0);
    expect(statsAfterOut.runs).toBe(1);
    expect(statsAfterOut.run_events).toBe(1);
    expect(statsAfterOut.audit_events).toBeGreaterThanOrEqual(4);
  });

  test('ingest source imports a read-only file ref into project knowledge.db', () => {
    const dir = mkdtempSync(join(tmpdir(), 'ok-ingest-source-cli-'));
    const source = join(dir, 'source.md');
    writeFileSync(source, 'CLI source ingestion reads file refs without copying raw files.');
    const sourceRef = `file://${source}`;

    const ingest = runCli(['ingest', 'source', sourceRef, '--purpose', 'knowledge_index', '--scope', 'project', '--json'], dir);
    expect(ingest.exitCode).toBe(0);
    const ingestOut = JSON.parse(new TextDecoder().decode(ingest.stdout));
    expect(ingestOut.content_source).toBe('file');
    expect(ingestOut.source_ref).toBe(sourceRef);
    expect(ingestOut.chunks_inserted).toBe(1);
    expect(ingestOut.read_only).toBe(true);

    const resolve = runCli(['source', 'resolve', sourceRef, '--purpose', 'knowledge_index', '--scope', 'project', '--json'], dir);
    expect(resolve.exitCode).toBe(0);
    const resolveOut = JSON.parse(new TextDecoder().decode(resolve.stdout));
    expect(resolveOut.resolved).toBe(true);
    expect(resolveOut.source.kind).toBe('file');
    expect(resolveOut.content.bytes_exposed).toBe(false);
    expect(resolveOut.chunks[0].text).toContain('CLI source ingestion');
  });

  test('embeddings commands index and search chunks with deterministic vectors', () => {
    const dir = mkdtempSync(join(tmpdir(), 'ok-embeddings-cli-'));
    const source = join(dir, 'source.md');
    writeFileSync(source, 'CLI semantic embeddings should find this company wiki source.');
    const sourceRef = `file://${source}`;

    const ingest = runCli(['ingest', 'source', sourceRef, '--purpose', 'knowledge_index', '--scope', 'project', '--json'], dir);
    expect(ingest.exitCode).toBe(0);

    const index = runCli(['embeddings', 'index', '--scope', 'project', '--fake', '--dimensions', '8', '--json'], dir);
    expect(index.exitCode).toBe(0);
    const indexOut = JSON.parse(new TextDecoder().decode(index.stdout));
    expect(indexOut.chunks_embedded).toBe(1);
    expect(indexOut.vector_entries_upserted).toBe(1);

    const status = runCli(['embeddings', 'status', '--scope', 'project', '--json'], dir);
    expect(status.exitCode).toBe(0);
    const statusOut = JSON.parse(new TextDecoder().decode(status.stdout));
    expect(statusOut.total_vector_entries).toBe(1);

    const search = runCli(['embeddings', 'search', 'company', 'wiki', 'source', '--scope', 'project', '--fake', '--dimensions', '8', '--json'], dir);
    expect(search.exitCode).toBe(0);
    const searchOut = JSON.parse(new TextDecoder().decode(search.stdout));
    expect(searchOut.results).toHaveLength(1);
    expect(searchOut.results[0].provenance.source_uri).toBe(sourceRef);
  });

  test('reindex commands inspect queue and refresh embeddings', () => {
    const dir = mkdtempSync(join(tmpdir(), 'ok-reindex-cli-'));
    const source = join(dir, 'source.md');
    writeFileSync(source, 'CLI reindex command should queue and refresh embeddings.');
    const sourceRef = `file://${source}`;

    const ingest = runCli(['ingest', 'source', sourceRef, '--purpose', 'knowledge_index', '--scope', 'project', '--json'], dir);
    expect(ingest.exitCode).toBe(0);

    const status = runCli(['reindex', 'status', '--scope', 'project', '--fake', '--dimensions', '8', '--json'], dir);
    expect(status.exitCode).toBe(0);
    const statusOut = JSON.parse(new TextDecoder().decode(status.stdout));
    expect(statusOut.missing_embeddings).toBe(1);
    expect(statusOut.queued.pending ?? 0).toBe(0);

    const enqueue = runCli(['reindex', 'enqueue', '--scope', 'project', '--fake', '--dimensions', '8', '--json'], dir);
    expect(enqueue.exitCode).toBe(0);
    const enqueueOut = JSON.parse(new TextDecoder().decode(enqueue.stdout));
    expect(enqueueOut.enqueued).toBe(1);

    const refresh = runCli(['reindex', 'embeddings', '--scope', 'project', '--fake', '--dimensions', '8', '--json'], dir);
    expect(refresh.exitCode).toBe(0);
    const refreshOut = JSON.parse(new TextDecoder().decode(refresh.stdout));
    expect(refreshOut.indexed.vector_entries_upserted).toBe(1);
    expect(refreshOut.completed_queue_items).toBe(1);

    const after = runCli(['reindex', 'status', '--scope', 'project', '--fake', '--dimensions', '8', '--json'], dir);
    expect(after.exitCode).toBe(0);
    const afterOut = JSON.parse(new TextDecoder().decode(after.stdout));
    expect(afterOut.missing_embeddings).toBe(0);
    expect(afterOut.queued.completed).toBe(1);

    const full = runCli(['reindex', 'embeddings', '--full', '--scope', 'project', '--fake', '--dimensions', '8', '--json'], dir);
    expect(full.exitCode).toBe(0);
    const fullOut = JSON.parse(new TextDecoder().decode(full.stdout));
    expect(fullOut.full).toBe(true);
    expect(fullOut.deleted_vector_entries).toBe(1);
    expect(fullOut.indexed.vector_entries_upserted).toBe(1);
  });

  test('search command returns hybrid source, wiki, and semantic results', () => {
    const dir = mkdtempSync(join(tmpdir(), 'ok-search-cli-'));
    const source = join(dir, 'source.md');
    writeFileSync(source, 'CLI hybrid search should find source-governed company wiki content.');
    const sourceRef = `file://${source}`;

    const ingest = runCli(['ingest', 'source', sourceRef, '--purpose', 'knowledge_index', '--scope', 'project', '--json'], dir);
    expect(ingest.exitCode).toBe(0);

    const wiki = runCli(['wiki', 'init', '--scope', 'project', '--json'], dir);
    expect(wiki.exitCode).toBe(0);

    const sourceSearch = runCli(['search', 'source', 'company', 'wiki', '--scope', 'project', '--json'], dir);
    expect(sourceSearch.exitCode).toBe(0);
    const sourceSearchOut = JSON.parse(new TextDecoder().decode(sourceSearch.stdout));
    expect(sourceSearchOut.mode.semantic).toBe(false);
    expect(sourceSearchOut.results.some((entry: any) => entry.kind === 'source_chunk' && entry.source.uri === sourceRef)).toBe(true);

    const wikiSearch = runCli(['search', 'durable', 'knowledge', 'pages', '--scope', 'project', '--json'], dir);
    expect(wikiSearch.exitCode).toBe(0);
    const wikiSearchOut = JSON.parse(new TextDecoder().decode(wikiSearch.stdout));
    expect(wikiSearchOut.results.some((entry: any) => entry.kind === 'wiki_chunk' && entry.artifact.path === 'wiki/README.md')).toBe(true);

    const index = runCli(['embeddings', 'index', '--scope', 'project', '--fake', '--dimensions', '8', '--json'], dir);
    expect(index.exitCode).toBe(0);

    const semantic = runCli(['search', 'company', 'wiki', 'content', '--scope', 'project', '--semantic', '--fake', '--dimensions', '8', '--json'], dir);
    expect(semantic.exitCode).toBe(0);
    const semanticOut = JSON.parse(new TextDecoder().decode(semantic.stdout));
    expect(semanticOut.mode.semantic).toBe(true);
    expect(semanticOut.counts.semantic_results).toBeGreaterThan(0);

    const context = runCli(['search', 'company', 'wiki', 'content', '--context', '--scope', 'project', '--semantic', '--fake', '--dimensions', '8', '--json'], dir);
    expect(context.exitCode).toBe(0);
    const contextOut = JSON.parse(new TextDecoder().decode(context.stdout));
    expect(contextOut.excerpts.length).toBeGreaterThan(0);
    expect(contextOut.citations[0].provenance.source_owner).toBe('open-files');
  });

  test('ask command and direct knowledge prompt build citation drafts with run ledger', () => {
    const dir = mkdtempSync(join(tmpdir(), 'ok-ask-cli-'));
    const source = join(dir, 'source.md');
    writeFileSync(source, 'CLI ask command should cite company handbook source context.');
    const sourceRef = `file://${source}`;

    const ingest = runCli(['ingest', 'source', sourceRef, '--purpose', 'knowledge_index', '--scope', 'project', '--json'], dir);
    expect(ingest.exitCode).toBe(0);

    const ask = runCli(['ask', 'How', 'should', 'we', 'cite', 'the', 'handbook?', '--scope', 'project', '--json'], dir);
    expect(ask.exitCode).toBe(0);
    const askOut = JSON.parse(new TextDecoder().decode(ask.stdout));
    expect(askOut.generated).toBe(false);
    expect(askOut.citations[0].source_uri).toBe(sourceRef);
    expect(askOut.write_policy.durable_writes_performed).toBe(false);

    const knowledge = runKnowledgeBin(['Generate', 'fake', 'answer', '--scope', 'project', '--generate', '--fake', '--model', 'openai:gpt-5-mini', '--json'], dir);
    expect(knowledge.exitCode).toBe(0);
    const knowledgeOut = JSON.parse(new TextDecoder().decode(knowledge.stdout));
    expect(knowledgeOut.generated).toBe(true);
    expect(knowledgeOut.answer).toContain('Fake generated answer');

    const stats = runCli(['db', 'stats', '--scope', 'project', '--json'], dir);
    expect(stats.exitCode).toBe(0);
    const statsOut = JSON.parse(new TextDecoder().decode(stats.stdout));
    expect(statsOut.runs).toBe(2);
  });

  test('build command JSON contract records fake provider runs without durable writes', () => {
    const dir = mkdtempSync(join(tmpdir(), 'ok-build-contract-cli-'));
    const source = join(dir, 'source.md');
    writeFileSync(source, 'CLI build contract should cite source context and keep wiki writes explicit.');
    const sourceRef = `file://${source}`;

    const ingest = runCli(['ingest', 'source', sourceRef, '--purpose', 'knowledge_index', '--scope', 'project', '--json'], dir);
    expect(ingest.exitCode).toBe(0);

    const build = runCli(['build', 'Summarize', 'the', 'build', 'contract', '--scope', 'project', '--generate', '--fake', '--model', 'openai:gpt-5-mini', '--approve-write', '--json'], dir);
    expect(build.exitCode).toBe(0);
    const buildOut = JSON.parse(new TextDecoder().decode(build.stdout));
    expect(Object.keys(buildOut)).toEqual(expect.arrayContaining([
      'ok',
      'run_id',
      'prompt',
      'generated',
      'provider',
      'model',
      'answer',
      'context',
      'citations',
      'proposed_wiki_updates',
      'write_policy',
      'usage',
      'warnings',
      'message',
    ]));
    expect(buildOut.generated).toBe(true);
    expect(buildOut.provider).toBe('openai');
    expect(buildOut.model).toBe('gpt-5-mini');
    expect(buildOut.answer).toContain('Fake generated answer');
    expect(buildOut.citations[0].source_uri).toBe(sourceRef);
    expect(buildOut.proposed_wiki_updates[0]).toMatchObject({
      kind: 'answer_note',
      requires_approval: true,
    });
    expect(buildOut.write_policy).toMatchObject({
      approved: true,
      durable_writes_performed: false,
    });
    expect(buildOut.usage.input_tokens).toBeGreaterThan(0);
    expect(buildOut.usage.output_tokens).toBeGreaterThan(0);

    const stats = runCli(['db', 'stats', '--scope', 'project', '--json'], dir);
    expect(stats.exitCode).toBe(0);
    const statsOut = JSON.parse(new TextDecoder().decode(stats.stdout));
    expect(statsOut.runs).toBe(1);
    expect(statsOut.run_events).toBeGreaterThanOrEqual(2);
    expect(statsOut.wiki_pages).toBe(0);
  });

  test('wiki compile, file-answer, and lint commands manage durable cited pages', () => {
    const dir = mkdtempSync(join(tmpdir(), 'ok-wiki-commands-cli-'));
    const source = join(dir, 'source.md');
    writeFileSync(source, 'CLI wiki compile should cite source chunks for durable wiki pages.');
    const sourceRef = `file://${source}`;

    const ingest = runCli(['ingest', 'source', sourceRef, '--purpose', 'knowledge_index', '--scope', 'project', '--json'], dir);
    expect(ingest.exitCode).toBe(0);

    const compile = runCli(['wiki', 'compile', 'source', 'chunks', '--title', 'CLI Wiki Compile', '--scope', 'project', '--json'], dir);
    expect(compile.exitCode).toBe(0);
    const compileOut = JSON.parse(new TextDecoder().decode(compile.stdout));
    expect(compileOut.path).toBe('wiki/generated/cli-wiki-compile.md');
    expect(compileOut.citations_written).toBe(1);

    const filed = runCli(['wiki', 'file-answer', 'How', 'should', 'wiki', 'compile', 'cite?', '--content', 'Use cited source chunks.', '--approve-write', '--scope', 'project', '--json'], dir);
    expect(filed.exitCode).toBe(0);
    const filedOut = JSON.parse(new TextDecoder().decode(filed.stdout));
    expect(filedOut.durable_writes_performed).toBe(true);
    expect(filedOut.path).toBe('wiki/answers/how-should-wiki-compile-cite.md');

    const lint = runCli(['wiki', 'lint', '--scope', 'project', '--json'], dir);
    expect(lint.exitCode).toBe(0);
    const lintOut = JSON.parse(new TextDecoder().decode(lint.stdout));
    expect(lintOut.ok).toBe(true);
    expect(lintOut.issues.some((issue: any) => issue.type === 'missing_citation')).toBe(false);
  });

  test('web search command returns and files provider sources in fake mode', () => {
    const dir = mkdtempSync(join(tmpdir(), 'ok-web-cli-'));

    const web = runCli(['web', 'search', 'company', 'wiki', 'policy', '--scope', 'project', '--provider', 'openai', '--model', 'openai:gpt-5-mini', '--fake', '--file-results', '--limit', '2', '--json'], dir);
    expect(web.exitCode).toBe(0);
    const webOut = JSON.parse(new TextDecoder().decode(web.stdout));
    expect(webOut.sources).toHaveLength(2);
    expect(webOut.filed_sources).toBe(2);

    const search = runCli(['search', 'provider', 'web', 'search', 'fixture', '--scope', 'project', '--json'], dir);
    expect(search.exitCode).toBe(0);
    const searchOut = JSON.parse(new TextDecoder().decode(search.stdout));
    expect(searchOut.results.some((entry: any) => entry.source?.kind === 'web')).toBe(true);
  });

  test('safety commands expose policy, approvals, redaction, audit, and S3 denial', () => {
    const dir = mkdtempSync(join(tmpdir(), 'ok-safety-cli-'));

    const status = runCli(['safety', 'status', '--scope', 'project', '--json'], dir);
    expect(status.exitCode).toBe(0);
    const statusOut = JSON.parse(new TextDecoder().decode(status.stdout));
    expect(statusOut.network.webSearchEnabled).toBe(false);
    expect(statusOut.network.s3ReadsEnabled).toBe(false);
    expect(statusOut.redaction.enabled).toBe(true);

    const check = runCli(['safety', 'check', 'generated_write', 'wiki://answer', '--scope', 'project', '--json'], dir);
    expect(check.exitCode).toBe(0);
    const checkOut = JSON.parse(new TextDecoder().decode(check.stdout));
    expect(checkOut.approval_required).toBe(true);
    expect(checkOut.decision).toBe('requires_approval');

    const approve = runCli(['safety', 'approve', 'generated_write', 'wiki://answer', '--scope', 'project', '--json'], dir);
    expect(approve.exitCode).toBe(0);
    const approveOut = JSON.parse(new TextDecoder().decode(approve.stdout));
    expect(approveOut.status).toBe('approved');

    const checkAfter = runCli(['safety', 'check', 'generated_write', 'wiki://answer', '--scope', 'project', '--json'], dir);
    expect(checkAfter.exitCode).toBe(0);
    const checkAfterOut = JSON.parse(new TextDecoder().decode(checkAfter.stdout));
    expect(checkAfterOut.decision).toBe('allow');

    const redact = runCli(['safety', 'redact', 'token=sk-testsecretkeyvalue1234567890', '--scope', 'project', '--json'], dir);
    expect(redact.exitCode).toBe(0);
    const redactOut = JSON.parse(new TextDecoder().decode(redact.stdout));
    expect(redactOut.text).toBe('[REDACTED:secret_assignment]');
    expect(redactOut.findings).toHaveLength(1);

    const audit = runCli(['safety', 'audit', '--scope', 'project', '--json'], dir);
    expect(audit.exitCode).toBe(0);
    const auditOut = JSON.parse(new TextDecoder().decode(audit.stdout));
    expect(auditOut.events.length).toBeGreaterThanOrEqual(4);

    const denied = runCli(['ingest', 'manifest', 's3://not-allowed/manifest.jsonl', '--scope', 'project', '--json'], dir);
    expect(denied.exitCode).toBe(1);
    expect(new TextDecoder().decode(denied.stderr)).toContain('Safety policy denied S3 read');
  });

  test('providers commands expose model aliases and credential checks', () => {
    const dir = mkdtempSync(join(tmpdir(), 'ok-providers-cli-'));
    const env = { OPENAI_API_KEY: '', ANTHROPIC_API_KEY: '', DEEPSEEK_API_KEY: '' };

    const status = runCli(['providers', 'status', '--scope', 'project', '--json'], dir, env);
    expect(status.exitCode).toBe(0);
    const statusOut = JSON.parse(new TextDecoder().decode(status.stdout));
    expect(statusOut.default_model).toBe('openai:gpt-5.2');
    expect(statusOut.providers).toHaveLength(3);
    expect(statusOut.providers.find((entry: any) => entry.provider === 'openai').configured).toBe(false);

    const models = runCli(['providers', 'models', '--scope', 'project', '--json'], dir, env);
    expect(models.exitCode).toBe(0);
    const modelsOut = JSON.parse(new TextDecoder().decode(models.stdout));
    expect(modelsOut.models.find((entry: any) => entry.alias === 'deepseek-reasoning')).toMatchObject({
      model_ref: 'deepseek:deepseek-reasoner',
      provider: 'deepseek',
    });

    const missing = runCli(['providers', 'check', 'default', '--scope', 'project', '--json'], dir, env);
    expect(missing.exitCode).toBe(1);
    expect(new TextDecoder().decode(missing.stderr)).toContain('Missing OPENAI_API_KEY');
  });

  test('wiki init creates scalable wiki artifacts', () => {
    const dir = mkdtempSync(join(tmpdir(), 'ok-wiki-cli-'));

    const init = runCli(['wiki', 'init', '--scope', 'project', '--json'], dir);
    expect(init.exitCode).toBe(0);
    const initOut = JSON.parse(new TextDecoder().decode(init.stdout));
    expect(initOut.written).toContain('schemas/v1.md');
    expect(initOut.written).toContain('indexes/root.md');
    expect(initOut.written).toContain('wiki/README.md');
    expect(initOut.artifacts).toHaveLength(4);
    expect(initOut.artifacts.every((entry: any) => entry.hash.startsWith('sha256:'))).toBe(true);
    expect(existsSync(join(dir, '.hasna', 'apps', 'knowledge', 'artifacts', 'schemas', 'v1.md'))).toBe(true);
    expect(existsSync(join(dir, '.hasna', 'apps', 'knowledge', 'artifacts', 'indexes', 'root.md'))).toBe(true);
    expect(existsSync(join(dir, '.hasna', 'apps', 'knowledge', 'artifacts', 'wiki', 'README.md'))).toBe(true);

    const stats = runCli(['db', 'stats', '--scope', 'project', '--json'], dir);
    expect(stats.exitCode).toBe(0);
    const statsOut = JSON.parse(new TextDecoder().decode(stats.stdout));
    expect(statsOut.storage_objects).toBe(4);
    expect(statsOut.wiki_pages).toBe(1);
    expect(statsOut.indexes).toBe(1);
  });

  test('source refs cover open-files, s3, local files, and web URLs', () => {
    expect(parseSourceRef('open-files://file/file_123')).toMatchObject({
      kind: 'open-files',
      entity: 'file',
      id: 'file_123',
    });
    expect(parseSourceRef('open-files://file/file_123/revision/rev_456')).toMatchObject({
      kind: 'open-files',
      entity: 'file',
      id: 'file_123',
      revision_id: 'rev_456',
    });
    expect(parseSourceRef('open-files://source/src_123/path/docs/readme.md')).toMatchObject({
      kind: 'open-files',
      entity: 'source',
      id: 'src_123',
      path: 'docs/readme.md',
    });
    expect(parseSourceRef('s3://company-bucket/docs/handbook.pdf')).toMatchObject({
      kind: 's3',
      bucket: 'company-bucket',
      key: 'docs/handbook.pdf',
    });
    expect(parseSourceRef('file:///tmp/readme.md')).toMatchObject({ kind: 'file', path: '/tmp/readme.md' });
    expect(parseSourceRef('https://example.com/docs')).toMatchObject({ kind: 'web', url: 'https://example.com/docs' });
  });
});
