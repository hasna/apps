import { describe, expect, test } from 'bun:test';
import { chmodSync, existsSync, mkdirSync, mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { delimiter, join } from 'node:path';
import {
  HASNA_KNOWLEDGE_APP_PATH,
  EXAMPLE_KNOWLEDGE_CANONICAL,
  createKnowledgeClient,
  createKnowledgeSdk,
  parseSourceRef,
  recordKnowledgeSyncConflict,
  type KnowledgeClient,
} from '../src/index';

function writeWindowsCmdShim(bin: string, name: string): void {
  writeFileSync(join(bin, `${name}.cmd`), [
    '@echo off',
    `bun "%~dp0${name}.js" %*`,
    'exit /b %ERRORLEVEL%',
    '',
  ].join('\r\n'));
}

function writeFakeSshJs(bin: string): void {
  writeFileSync(join(bin, 'ssh.js'), [
    '#!/usr/bin/env bun',
    "const [target = '', ...commandParts] = process.argv.slice(2);",
    "const command = commandParts.join(' ');",
    'if (process.env.KNOWLEDGE_FAKE_SSH_TARGET_PATH) {',
    '  await Bun.write(process.env.KNOWLEDGE_FAKE_SSH_TARGET_PATH, target);',
    '}',
    "if (/sync.*export/.test(command)) {",
    "  process.stdout.write(process.env.KNOWLEDGE_FAKE_SSH_EXPORT_JSON ?? '');",
    '  process.exit(0);',
    '}',
    "if (/sync.*import/.test(command)) {",
    '  const input = await Bun.stdin.text();',
    '  if (process.env.KNOWLEDGE_FAKE_SSH_STDIN_PATH) {',
    '    await Bun.write(process.env.KNOWLEDGE_FAKE_SSH_STDIN_PATH, input);',
    '  }',
    "  process.stdout.write(process.env.KNOWLEDGE_FAKE_SSH_IMPORT_JSON ?? '');",
    '  process.exit(0);',
    '}',
    "console.error(`unexpected fake ssh command: ${process.argv.slice(2).join(' ')}`);",
    'process.exit(9);',
    '',
  ].join('\n'));
  chmodSync(join(bin, 'ssh.js'), 0o755);
  writeWindowsCmdShim(bin, 'ssh');
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
  writeFakeSshJs(bin);
  return bin;
}

function applyFakeSshCommandEnv(bin: string): void {
  process.env.KNOWLEDGE_SSH_COMMAND = process.execPath;
  process.env.KNOWLEDGE_SSH_COMMAND_ARGS_JSON = JSON.stringify([join(bin, 'ssh.js')]);
}

function restoreEnvValue(key: string, value: string | undefined): void {
  if (value === undefined) delete process.env[key];
  else process.env[key] = value;
}

function writeFakeMachinesRouteBin(
  bin: string,
  target: string,
  projectRoot = '/remote/open-knowledge',
  observedAt = '2026-06-09T00:00:00.000Z',
  expiresAt = '2099-06-10T00:05:00.000Z',
): void {
  const machines = join(bin, 'machines');
  const routePayload = {
    ok: true,
    target,
    route: 'tailscale',
    source: 'tailscale',
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
    cacheability: {
      observed_at: observedAt,
      verified_at: observedAt,
      expires_at: expiresAt,
      ttl_ms: 300000,
      source_authority: 'open-machines',
      confidence: 'high',
      cacheable: true,
      stale: false,
      reasons: ['route_verified'],
    },
    warnings: [],
  };
  const workspacePayload = {
    ok: true,
    requested_machine_id: 'linux-node-a',
    machine_id: 'linux-node-a',
    project: { project_id: 'open-knowledge', repo_name: 'open-knowledge' },
    machine: { current: false, primary: false, trust_status: 'trusted', auth_status: 'authenticated' },
    paths: {
      workspace_root: { path: '/remote', source: 'manifest' },
      project_root: { path: projectRoot, source: 'manifest_metadata' },
      open_files_root: { path: '/remote/open-files', source: 'manifest_metadata' },
    },
    diagnostics: [{
      id: 'project_root',
      status: 'ok',
      severity: 'ok',
      message: 'project root mapped',
      path: projectRoot,
      source: 'manifest_metadata',
      path_exists: null,
    }],
    repair_hints: [],
    evidence: { topology: true, matched_by: 'machine_id', metadata_keys: [] },
    cacheability: {
      observed_at: observedAt,
      verified_at: null,
      expires_at: expiresAt,
      ttl_ms: 300000,
      source_authority: 'open-machines',
      confidence: 'high',
      cacheable: true,
      stale: false,
      reasons: ['workspace_manifest'],
    },
    warnings: [],
  };
  writeFileSync(machines, [
    '#!/bin/sh',
    'if [ "$1" = "route" ]; then',
    `  printf '%s\\n' '${JSON.stringify(routePayload)}'`,
    '  exit 0',
    'fi',
    'if [ "$1" = "workspace" ] && [ "$2" = "resolve" ]; then',
    `  printf '%s\\n' '${JSON.stringify(workspacePayload)}'`,
    '  exit 0',
    'fi',
    'exit 9',
    '',
  ].join('\n'));
  chmodSync(machines, 0o755);
  writeFileSync(join(bin, 'machines.js'), [
    '#!/usr/bin/env bun',
    `const routePayload = ${JSON.stringify(routePayload)};`,
    `const workspacePayload = ${JSON.stringify(workspacePayload)};`,
    'const args = process.argv.slice(2);',
    "if (args[0] === 'route') {",
    '  console.log(JSON.stringify(routePayload));',
    '  process.exit(0);',
    '}',
    "if (args[0] === 'workspace' && args[1] === 'resolve') {",
    '  console.log(JSON.stringify(workspacePayload));',
    '  process.exit(0);',
    '}',
    "console.error(`unexpected fake machines command: ${args.join(' ')}`);",
    'process.exit(9);',
    '',
  ].join('\n'));
  chmodSync(join(bin, 'machines.js'), 0o755);
  writeWindowsCmdShim(bin, 'machines');
}

function writeBrokenMachinesBin(bin: string): void {
  const machines = join(bin, 'machines');
  writeFileSync(machines, [
    '#!/bin/sh',
    'echo "machines unavailable" >&2',
    'exit 9',
    '',
  ].join('\n'));
  chmodSync(machines, 0o755);
  writeFileSync(join(bin, 'machines.js'), [
    '#!/usr/bin/env bun',
    'console.error("machines unavailable");',
    'process.exit(9);',
    '',
  ].join('\n'));
  chmodSync(join(bin, 'machines.js'), 0o755);
  writeWindowsCmdShim(bin, 'machines');
}

function emptySyncBundle() {
  return {
    ok: true,
    format: 'knowledge-sync-bundle',
    version: 1,
    protocol_version: 1,
    min_protocol_version: 1,
    generated_at: '2026-06-09T00:00:00.000Z',
    source: {
      scope: 'project',
      workspace_home: '/remote/.hasna/knowledge',
      sqlite_schema_version: 6,
      machine_id: 'linux-node-a',
      artifact_root_uri: 'file:///remote/.hasna/knowledge/artifacts/',
    },
    tables: [],
    artifacts: [],
    warnings: [],
    message: 'valid empty bundle',
  };
}

function emptyImportResult(dryRun = true) {
  return {
    ok: true,
    protocol_version: 1,
    min_protocol_version: 1,
    dry_run: dryRun,
    direction: 'import',
    source: emptySyncBundle().source,
    target: {
      scope: 'project',
      workspace_home: '/remote/.hasna/knowledge',
      sqlite_schema_version: 6,
      artifact_root_uri: 'file:///remote/.hasna/knowledge/artifacts/',
    },
    tables: [],
    artifacts: {
      source_artifacts: 0,
      target_artifacts: 0,
      copied: 0,
      skipped: 0,
      conflicts: 0,
      missing_content: 0,
    },
    conflicts_created: 0,
    warnings: [],
    message: dryRun
      ? 'Would import 0 row(s), copied 0 artifact(s), 0 conflict(s)'
      : 'Imported 0 row(s), copied 0 artifact(s), 0 conflict(s)',
  };
}

describe('public knowledge sdk', () => {
  test('project-scoped SDK reads stay no-create when workspace is absent', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'ok-sdk-readonly-'));
    const client = createKnowledgeClient({ scope: 'project', cwd: dir });

    const paths = client.paths();
    expect(paths.home).toBe(join(dir, '.hasna', 'knowledge'));
    expect(paths.exists).toBe(false);
    expect(paths.knowledge_db_exists).toBe(false);
    expect(existsSync(join(dir, '.hasna', 'knowledge'))).toBe(false);

    expect(client.inventory().paths.knowledge_db_exists).toBe(false);
    expect(existsSync(join(dir, '.hasna', 'knowledge'))).toBe(false);

    const search = await client.search({ query: 'missing sdk scope' });
    expect(search.results).toEqual([]);
    expect(search.warnings).toContain('knowledge_db_missing');
    expect(existsSync(join(dir, '.hasna', 'knowledge'))).toBe(false);

    const context = await client.retrieveContext({ query: 'missing sdk scope' });
    expect(context.excerpts).toEqual([]);
    expect(context.warnings).toContain('knowledge_db_missing');
    expect(existsSync(join(dir, '.hasna', 'knowledge'))).toBe(false);

    expect(client.sync.machines()).toEqual([]);
    expect(client.sync.conflicts()).toEqual([]);
    expect(client.sync.status().sqlite_schema_version).toBe(0);
    expect(existsSync(join(dir, '.hasna', 'knowledge'))).toBe(false);
  });

  test('exposes a stable client facade for installed apps', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'ok-sdk-'));
    const client: KnowledgeClient = createKnowledgeClient({ scope: 'project', cwd: dir });
    const source = join(dir, 'sdk-source.md');
    writeFileSync(source, 'The SDK facade lets apps index company wiki source context without shelling out.');

    expect(createKnowledgeSdk).toBe(createKnowledgeClient);
    expect(HASNA_KNOWLEDGE_APP_PATH).toBe(join('.hasna', 'knowledge'));
    expect(EXAMPLE_KNOWLEDGE_CANONICAL.source_owner).toBe('open-files');

    const paths = client.paths();
    expect(paths.home).toBe(join(dir, '.hasna', 'knowledge'));
    expect(paths.config.storage.type).toBe('local');

    const setup = client.setup({ mode: 'hosted', canonicalExample: true });
    expect(setup.mode).toBe('hosted');
    expect(setup.storage_type).toBe('s3');
    expect(setup.canonical_example.active).toBe(true);

    const storage = client.storage.status();
    expect(storage.source_ownership.owner).toBe('open-files');
    expect(storage.source_ownership.raw_source_bytes_stored_in_open_knowledge).toBe(false);
    expect(storage.private_fleet_boundary.manifest_authority).toBe('open-machines');
    expect(storage.private_fleet_boundary.raw_private_manifest_bytes_stored_in_open_knowledge).toBe(false);
    expect(storage.private_fleet_boundary.does_not_store).toContain('GitHub App private keys');
    expect(client.storage.validate().ok).toBe(true);

    const parsed = parseSourceRef(`file://${source}`);
    expect(parsed.kind).toBe('file');

    const migration = client.db.init();
    expect(migration.schema_version).toBe(8);

    const ingest = await client.ingest.source(`file://${source}`, 'knowledge_index');
    expect(ingest.sources_upserted).toBe(1);
    expect(ingest.chunks_inserted).toBe(1);

    const search = await client.search({ query: 'SDK facade source context', limit: 3 });
    expect(search.results[0].text).toContain('SDK facade');

    const contextPack = await client.context.pack({
      query: 'SDK facade source context',
      maxTokens: 1200,
      maxItems: 1,
    });
    expect(contextPack.format).toBe('knowledge-agent-context-pack');
    expect(contextPack.budgets.items_included).toBeLessThanOrEqual(1);
    expect(contextPack.evidence[0].citation_ids.length).toBeGreaterThan(0);
    expect(await client.contextPack({ query: 'SDK facade source context', maxItems: 1 })).toMatchObject({
      format: 'knowledge-agent-context-pack',
      source: 'search',
    });

    const answer = await client.ask('What does the SDK facade let apps do?', { limit: 3 });
    expect(answer.generated).toBe(false);
    expect(answer.answer).toContain('SDK facade');
    expect(answer.context.citations.length).toBeGreaterThan(0);

    const stats = client.db.stats();
    expect(stats.sources).toBe(1);
    expect(stats.chunks).toBe(1);
    expect(stats.runs).toBe(1);

    const syncStatus = client.sync.status();
    expect(syncStatus.machines.total).toBe(0);
    const syncSnapshot = await client.sync.snapshot({ includeTailscale: false });
    expect(syncSnapshot.snapshot.content_hash).toStartWith('sha256:');
    expect(client.sync.machines().length).toBeGreaterThanOrEqual(1);
    expect(client.sync.conflicts()).toEqual([]);

    const conflict = recordKnowledgeSyncConflict(client.paths().knowledge_db_path, {
      entityKind: 'sources',
      entityId: 'id="source_sdk"',
      localMachineId: 'linux-node-b',
      remoteMachineId: 'linux-node-a',
      localHash: 'sha256:sdk-local',
      remoteHash: 'sha256:sdk-remote',
      baseHash: 'sha256:sdk-base',
      metadata: {
        reason: 'sdk conflict proposal',
        remote_row: {
          id: 'source_sdk',
          uri: 'open-files://file/sdk_conflict',
          kind: 'document',
          title: 'Remote SDK source',
        },
      },
    });
    const aiProposal = await client.sync.proposeConflictResolutionAi({
      id: conflict.id,
      modelRef: 'openai:gpt-5-mini',
      fake: true,
    });
    expect(aiProposal.mode).toBe('ai');
    expect(aiProposal.agent?.provider).toBe('openai');
    expect(aiProposal.proposed_patch?.summary).toContain('Fake AI proposal');
    expect(aiProposal.citations.some((citation) => citation.ref === 'open-files://file/sdk_conflict')).toBe(true);
  });

  test('exposes route-aware remote sync through the sdk facade', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'ok-sdk-remote-sync-'));
    const targetPath = join(dir, 'ssh-target.txt');
    const bin = writeFakeSshBin(dir);
    writeFakeMachinesRouteBin(bin, 'sdk-linux-node-a.tailnet.test');
    const oldEnv = {
      PATH: process.env.PATH,
      KNOWLEDGE_FAKE_SSH_EXPORT_JSON: process.env.KNOWLEDGE_FAKE_SSH_EXPORT_JSON,
      KNOWLEDGE_FAKE_SSH_IMPORT_JSON: process.env.KNOWLEDGE_FAKE_SSH_IMPORT_JSON,
      KNOWLEDGE_FAKE_SSH_TARGET_PATH: process.env.KNOWLEDGE_FAKE_SSH_TARGET_PATH,
      KNOWLEDGE_SSH_COMMAND: process.env.KNOWLEDGE_SSH_COMMAND,
      KNOWLEDGE_SSH_COMMAND_ARGS_JSON: process.env.KNOWLEDGE_SSH_COMMAND_ARGS_JSON,
    };
    try {
      process.env.PATH = `${bin}${delimiter}${process.env.PATH ?? ''}`;
      applyFakeSshCommandEnv(bin);
      process.env.KNOWLEDGE_FAKE_SSH_EXPORT_JSON = JSON.stringify(emptySyncBundle());
      process.env.KNOWLEDGE_FAKE_SSH_IMPORT_JSON = JSON.stringify(emptyImportResult());
      process.env.KNOWLEDGE_FAKE_SSH_TARGET_PATH = targetPath;
      const client = createKnowledgeClient({ scope: 'project', cwd: dir });
      const doctor = await client.sync.doctor({ machine: 'linux-node-a' });
      expect(doctor.ok).toBe(true);
      expect(doctor.resolved_workspace?.diagnostics[0]).toMatchObject({
        id: 'project_root',
        status: 'ok',
      });

      const result = await client.sync.remotePeer({
        machine: 'linux-node-a',
        direction: 'both',
        dryRun: true,
      });

      expect(result.ok).toBe(true);
      expect(result.transport).toBe('ssh');
      expect(result.resolved_machine).toBe('sdk-linux-node-a.tailnet.test');
      expect(result.resolved_route).toMatchObject({
        source: 'open-machines',
        adapter: {
          implementation: 'cli',
          available: true,
        },
        target: 'sdk-linux-node-a.tailnet.test',
        route: 'tailscale',
        target_kind: 'tailscale',
        confidence: 'high',
      });
      expect(result.peer_workspace).toBe('/remote/open-knowledge');
      expect(result.resolved_workspace).toMatchObject({
        source: 'open-machines',
        adapter: {
          implementation: 'cli',
          available: true,
        },
        project_root: '/remote/open-knowledge',
        project_root_source: 'manifest_metadata',
        open_files_root: '/remote/open-files',
        trust_status: 'trusted',
        diagnostics: [{
          id: 'project_root',
          status: 'ok',
        }],
      });
      expect(readFileSync(targetPath, 'utf8')).toBe('sdk-linux-node-a.tailnet.test');
    } finally {
      if (oldEnv.PATH === undefined) delete process.env.PATH;
      else process.env.PATH = oldEnv.PATH;
      if (oldEnv.KNOWLEDGE_FAKE_SSH_EXPORT_JSON === undefined) delete process.env.KNOWLEDGE_FAKE_SSH_EXPORT_JSON;
      else process.env.KNOWLEDGE_FAKE_SSH_EXPORT_JSON = oldEnv.KNOWLEDGE_FAKE_SSH_EXPORT_JSON;
      if (oldEnv.KNOWLEDGE_FAKE_SSH_IMPORT_JSON === undefined) delete process.env.KNOWLEDGE_FAKE_SSH_IMPORT_JSON;
      else process.env.KNOWLEDGE_FAKE_SSH_IMPORT_JSON = oldEnv.KNOWLEDGE_FAKE_SSH_IMPORT_JSON;
      if (oldEnv.KNOWLEDGE_FAKE_SSH_TARGET_PATH === undefined) delete process.env.KNOWLEDGE_FAKE_SSH_TARGET_PATH;
      else process.env.KNOWLEDGE_FAKE_SSH_TARGET_PATH = oldEnv.KNOWLEDGE_FAKE_SSH_TARGET_PATH;
      restoreEnvValue('KNOWLEDGE_SSH_COMMAND', oldEnv.KNOWLEDGE_SSH_COMMAND);
      restoreEnvValue('KNOWLEDGE_SSH_COMMAND_ARGS_JSON', oldEnv.KNOWLEDGE_SSH_COMMAND_ARGS_JSON);
    }
  });

  test('persists machine resolver evidence for registry fallback', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'ok-sdk-registry-fallback-'));
    const targetPath = join(dir, 'ssh-target.txt');
    const stdinPath = join(dir, 'ssh-stdin.json');
    const bin = writeFakeSshBin(dir);
    writeFakeMachinesRouteBin(bin, 'sdk-linux-node-a.tailnet.test');
    const oldEnv = {
      PATH: process.env.PATH,
      KNOWLEDGE_FAKE_SSH_EXPORT_JSON: process.env.KNOWLEDGE_FAKE_SSH_EXPORT_JSON,
      KNOWLEDGE_FAKE_SSH_IMPORT_JSON: process.env.KNOWLEDGE_FAKE_SSH_IMPORT_JSON,
      KNOWLEDGE_FAKE_SSH_TARGET_PATH: process.env.KNOWLEDGE_FAKE_SSH_TARGET_PATH,
      KNOWLEDGE_FAKE_SSH_STDIN_PATH: process.env.KNOWLEDGE_FAKE_SSH_STDIN_PATH,
      KNOWLEDGE_SSH_COMMAND: process.env.KNOWLEDGE_SSH_COMMAND,
      KNOWLEDGE_SSH_COMMAND_ARGS_JSON: process.env.KNOWLEDGE_SSH_COMMAND_ARGS_JSON,
    };
    try {
      process.env.PATH = `${bin}${delimiter}${process.env.PATH ?? ''}`;
      applyFakeSshCommandEnv(bin);
      process.env.KNOWLEDGE_FAKE_SSH_EXPORT_JSON = JSON.stringify(emptySyncBundle());
      process.env.KNOWLEDGE_FAKE_SSH_IMPORT_JSON = JSON.stringify(emptyImportResult(false));
      process.env.KNOWLEDGE_FAKE_SSH_TARGET_PATH = targetPath;
      process.env.KNOWLEDGE_FAKE_SSH_STDIN_PATH = stdinPath;
      const client = createKnowledgeClient({ scope: 'project', cwd: dir });

      const first = await client.sync.remotePeer({
        machine: 'linux-node-a',
        direction: 'push',
        dryRun: false,
      });

      expect(first.ok).toBe(true);
      expect(first.resolved_route.source).toBe('open-machines');
      expect(first.resolved_route.cacheability).toMatchObject({
        cacheable: true,
        stale: false,
        source_authority: 'open-machines',
      });
      expect(first.resolved_workspace.cacheability).toMatchObject({
        cacheable: true,
        stale: false,
        reasons: ['workspace_manifest'],
      });
      const pushedBundle = JSON.parse(readFileSync(stdinPath, 'utf8'));
      const pushedMachines = pushedBundle.tables.find((table: { table: string }) => table.table === 'knowledge_machines');
      expect(pushedMachines.rows.some((row: { machine_id: string }) => row.machine_id === 'linux-node-a')).toBe(true);
      const registryRow = client.sync.machines().find((row) => row.machine_id === 'linux-node-a');
      expect(registryRow).toBeDefined();
      expect(registryRow?.ssh_target).toBe('sdk-linux-node-a.tailnet.test');
      expect(registryRow?.workspace_home).toBe('/remote/open-knowledge');
      expect(JSON.parse(registryRow?.metadata_json ?? '{}').resolver_evidence.route.source).toBe('open-machines');
      expect(JSON.parse(registryRow?.metadata_json ?? '{}').resolver_evidence.route.cacheability.cacheable).toBe(true);
      expect(JSON.parse(registryRow?.metadata_json ?? '{}').resolver_evidence.workspace.cacheability.source_authority).toBe('open-machines');
      expect(JSON.parse(registryRow?.capabilities_json ?? '{}').resolver.route_cacheable).toBe(true);
      expect(JSON.parse(registryRow?.capabilities_json ?? '{}').resolver.workspace_source_authority).toBe('open-machines');

      writeFakeMachinesRouteBin(
        bin,
        'sdk-linux-node-a.tailnet.test',
        '/remote/open-knowledge',
        '2026-06-09T00:01:00.000Z',
        '2099-06-10T00:06:00.000Z',
      );
      const repeated = await client.sync.remotePeer({
        machine: 'linux-node-a',
        direction: 'push',
        dryRun: false,
      });
      expect(repeated.ok).toBe(true);
      const repeatedRegistryRow = client.sync.machines().find((row) => row.machine_id === 'linux-node-a');
      expect(repeatedRegistryRow?.updated_at).toBe(registryRow?.updated_at);
      expect(repeatedRegistryRow?.metadata_json).toBe(registryRow?.metadata_json);

      writeBrokenMachinesBin(bin);
      writeFileSync(targetPath, '');
      process.env.KNOWLEDGE_FAKE_SSH_IMPORT_JSON = JSON.stringify(emptyImportResult());
      const doctor = await client.sync.doctor({ machine: 'linux-node-a' });
      expect(doctor.ok).toBe(true);
      expect(doctor.resolved_route?.source).toBe('registry');
      expect(doctor.resolved_workspace?.source).toBe('registry');
      expect(doctor.resolved_workspace?.trust_status).toBe('trusted');
      expect(doctor.resolved_route?.cacheability?.cacheable).toBe(true);
      expect(doctor.resolved_workspace?.cacheability?.reasons).toEqual(['workspace_manifest']);

      writeFileSync(targetPath, '');
      const explicit = await client.sync.remotePeer({
        machine: 'linux-node-a',
        peerWorkspace: '/remote/open-knowledge',
        direction: 'push',
        dryRun: true,
      });
      expect(explicit.ok).toBe(true);
      expect(explicit.resolved_machine).toBe('linux-node-a');
      expect(explicit.resolved_route.source).toBe('raw');
      expect(explicit.resolved_workspace.source).toBe('argument');
      expect(readFileSync(targetPath, 'utf8')).toBe('linux-node-a');

      writeFileSync(targetPath, '');
      const second = await client.sync.remotePeer({
        machine: 'linux-node-a',
        direction: 'push',
        dryRun: true,
      });

      expect(second.ok).toBe(true);
      expect(second.resolved_machine).toBe('sdk-linux-node-a.tailnet.test');
      expect(second.resolved_route.source).toBe('registry');
      expect(second.resolved_workspace.source).toBe('registry');
      expect(second.resolved_route.cacheability?.source_authority).toBe('open-machines');
      expect(second.resolved_workspace.cacheability?.cacheable).toBe(true);
      expect(second.peer_workspace).toBe('/remote/open-knowledge');
      expect(readFileSync(targetPath, 'utf8')).toBe('sdk-linux-node-a.tailnet.test');
    } finally {
      if (oldEnv.PATH === undefined) delete process.env.PATH;
      else process.env.PATH = oldEnv.PATH;
      if (oldEnv.KNOWLEDGE_FAKE_SSH_EXPORT_JSON === undefined) delete process.env.KNOWLEDGE_FAKE_SSH_EXPORT_JSON;
      else process.env.KNOWLEDGE_FAKE_SSH_EXPORT_JSON = oldEnv.KNOWLEDGE_FAKE_SSH_EXPORT_JSON;
      if (oldEnv.KNOWLEDGE_FAKE_SSH_IMPORT_JSON === undefined) delete process.env.KNOWLEDGE_FAKE_SSH_IMPORT_JSON;
      else process.env.KNOWLEDGE_FAKE_SSH_IMPORT_JSON = oldEnv.KNOWLEDGE_FAKE_SSH_IMPORT_JSON;
      if (oldEnv.KNOWLEDGE_FAKE_SSH_TARGET_PATH === undefined) delete process.env.KNOWLEDGE_FAKE_SSH_TARGET_PATH;
      else process.env.KNOWLEDGE_FAKE_SSH_TARGET_PATH = oldEnv.KNOWLEDGE_FAKE_SSH_TARGET_PATH;
      if (oldEnv.KNOWLEDGE_FAKE_SSH_STDIN_PATH === undefined) delete process.env.KNOWLEDGE_FAKE_SSH_STDIN_PATH;
      else process.env.KNOWLEDGE_FAKE_SSH_STDIN_PATH = oldEnv.KNOWLEDGE_FAKE_SSH_STDIN_PATH;
      restoreEnvValue('KNOWLEDGE_SSH_COMMAND', oldEnv.KNOWLEDGE_SSH_COMMAND);
      restoreEnvValue('KNOWLEDGE_SSH_COMMAND_ARGS_JSON', oldEnv.KNOWLEDGE_SSH_COMMAND_ARGS_JSON);
    }
  });
});
