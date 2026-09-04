/**
 * @hasna/knowledge
 * Copyright 2026 Hasna Inc.
 * Licensed under the Apache License, Version 2.0
 */
import { describe, expect, test } from 'bun:test';
import { chmodSync, closeSync, existsSync, mkdirSync, mkdtempSync, openSync, readFileSync, realpathSync, writeFileSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import { homedir, tmpdir } from 'node:os';
import { delimiter, join, dirname, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { CURRENT_SCHEMA_VERSION, migrateKnowledgeDb, openKnowledgeDb } from '../src/knowledge-db';
import { KNOWLEDGE_API_KEY_ENV_KEYS, KNOWLEDGE_API_URL_ENV_KEYS, RETIRED_KNOWLEDGE_SELECTOR_ENV_KEYS } from '../src/client-transport';
import { createKnowledgeService } from '../src/service';
import { parseSourceRef } from '../src/source-ref';
import { recordStorageObjects } from '../src/storage-contract';
import { recordKnowledgeSyncConflict } from '../src/sync';
import { defaultKnowledgeConfig, projectKnowledgeHome, writeKnowledgeConfig } from '../src/workspace';
import { budget } from './support/budget';
import { KNOWLEDGE_TEST_ROUTE_ENV_KEYS } from './preload';

const __dirname = dirname(fileURLToPath(import.meta.url));
const CLI = join(__dirname, '..', 'src', 'cli.ts');
const packageJson = JSON.parse(readFileSync(join(__dirname, '..', 'package.json'), 'utf8')) as {
  name: string;
  version: string;
  bin: Record<string, string>;
};

/**
 * The env every spawned CLI gets: the parent's, minus Knowledge routing vars,
 * plus the caller's overrides.
 *
 * Those two variables are exported in a login shell on developer machines and
 * inherited by every pane from the tmux server, so a child that gets the parent
 * environment verbatim is configured differently from one run in CI. That is not
 * hypothetical: `auth whoami` reports `authenticated: true` purely from the
 * presence of an API key, and a retired selector is intentionally rejected.
 * Without this stripping, the suite measures the developer's shell rather than
 * the temp auth dir it just created.
 *
 * This is DEFENCE IN DEPTH, not the control. The control is the outbound request
 * guard in src/net-guard.ts, which refuses non-loopback traffic under
 * NODE_ENV=test no matter how the variables got set or when. Stripping here only
 * removes the noise; it cannot be relied on, because a test that assigns the
 * vars at module scope runs after any clearing step. A caller that genuinely
 * wants them passes them explicitly and wins, since the overrides land last.
 */
function childEnv(env?: Record<string, string>): Record<string, string> {
  const inherited = { ...process.env } as Record<string, string>;
  for (const key of [...KNOWLEDGE_API_URL_ENV_KEYS, ...KNOWLEDGE_API_KEY_ENV_KEYS, ...RETIRED_KNOWLEDGE_SELECTOR_ENV_KEYS]) delete inherited[key];
  return { ...inherited, ...(env ?? {}) };
}

function runCli(args: string[], cwd?: string, env?: Record<string, string>) {
  return Bun.spawnSync(['bun', CLI, ...args], {
    cwd,
    env: childEnv(env),
    stdout: 'pipe',
    stderr: 'pipe'
  });
}

function homeEnv(home: string): Record<string, string> {
  return { HOME: home, USERPROFILE: home };
}

function runCliWithInput(args: string[], input: string, cwd?: string, env?: Record<string, string>) {
  const result = spawnSync('bun', [CLI, ...args], {
    cwd,
    env: childEnv(env),
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
    `import { run, emitCliError } from ${JSON.stringify(pathToFileURL(CLI).href)};`,
    'const argv = process.argv.slice(2);',
    'run(argv).catch((error) => emitCliError(error, argv));',
    '',
  ].join('\n'));
  return Bun.spawnSync(['bun', wrapper, ...args], {
    cwd,
    env: childEnv(env),
    stdout: 'pipe',
    stderr: 'pipe',
  });
}

function runBuiltKnowledgeBin(args: string[], cwd?: string, env?: Record<string, string>) {
  const builtCli = join(__dirname, '..', packageJson.bin.knowledge);
  return Bun.spawnSync(['bun', builtCli, ...args], {
    cwd,
    env: childEnv(env),
    stdout: 'pipe',
    stderr: 'pipe',
  });
}

function expectSameExistingPath(actual: string, expected: string): void {
  expect(realpathSync(actual)).toBe(realpathSync(expected));
}

function normalizeDarwinPath(path: string): string {
  return path.replace(/^\/private(?=\/var\/)/, '');
}

function expectedProjectKnowledgeHome(projectDir: string, home = process.env.HOME || homedir()): string {
  return normalizeDarwinPath(projectKnowledgeHome(realpathSync(projectDir), home));
}

function createSchema7KnowledgeDb(dbPath: string): void {
  migrateKnowledgeDb(dbPath);
  const db = openKnowledgeDb(dbPath);
  try {
    db.exec(`
      PRAGMA foreign_keys = OFF;
      DROP TABLE IF EXISTS wiki_pages_v7;
      CREATE TABLE wiki_pages_v7 (
        id TEXT PRIMARY KEY,
        path TEXT NOT NULL UNIQUE,
        title TEXT NOT NULL,
        artifact_uri TEXT,
        content_hash TEXT,
        status TEXT NOT NULL DEFAULT 'active',
        metadata_json TEXT NOT NULL DEFAULT '{}',
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL
      );
      INSERT INTO wiki_pages_v7 (
        id, path, title, artifact_uri, content_hash, status, metadata_json, created_at, updated_at
      )
      SELECT id, path, title, artifact_uri, content_hash, status, metadata_json, created_at, updated_at
      FROM wiki_pages;
      DROP TABLE wiki_pages;
      ALTER TABLE wiki_pages_v7 RENAME TO wiki_pages;
      DELETE FROM schema_versions WHERE version >= 8;
      PRAGMA foreign_keys = ON;
    `);
  } finally {
    db.close();
  }
}

function pathWithBin(bin: string): string {
  return `${bin}${delimiter}${process.env.PATH ?? ''}`;
}

function isolatedHomeEnv(home: string): Record<string, string> {
  return { HOME: home, USERPROFILE: home };
}

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

function fakeSshCommandEnv(bin: string): Record<string, string> {
  return {
    KNOWLEDGE_SSH_COMMAND: process.execPath,
    KNOWLEDGE_SSH_COMMAND_ARGS_JSON: JSON.stringify([join(bin, 'ssh.js')]),
  };
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
    command: ['machines', 'workspace', 'repair', '--machine', 'linux-node-a', '--project', 'open-knowledge', '--repo', 'open-knowledge', '--open-files-repo', 'open-files', '--json'],
    shell_command: "machines workspace repair --machine linux-node-a --project open-knowledge --repo open-knowledge --open-files-repo open-files --json",
    apply_command: ['machines', 'workspace', 'repair', '--machine', 'linux-node-a', '--project', 'open-knowledge', '--repo', 'open-knowledge', '--open-files-repo', 'open-files', '--json', '--apply'],
    apply_shell_command: "machines workspace repair --machine linux-node-a --project open-knowledge --repo open-knowledge --open-files-repo open-files --json --apply",
  }] : [];
  const routePayload = {
    schema_version: 1,
    ok: true,
    machine_id: 'linux-node-a',
    requested_machine_id: 'linux-node-a',
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
    diagnostics: workspaceDiagnostics,
    repair_hints: workspaceRepairHints,
    evidence: { topology: true, matched_by: 'machine_id', metadata_keys: [] },
    warnings: includeRepairHint ? ['project_root_inferred:open-knowledge'] : [],
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
    'echo "unexpected fake machines command: $*" >&2',
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
  writeFileSync(join(bin, 'machines.js'), [
    '#!/usr/bin/env bun',
    "import { appendFileSync } from 'node:fs';",
    `appendFileSync(${JSON.stringify(marker)}, \`\${process.argv.slice(2).join(' ')}\\n\`);`,
    "console.error(`unexpected fake machines command: ${process.argv.slice(2).join(' ')}`);",
    'process.exit(9);',
    '',
  ].join('\n'));
  chmodSync(join(bin, 'machines.js'), 0o755);
  writeWindowsCmdShim(bin, 'machines');
}

describe('knowledge cli', () => {
  test('the parent test process is hermetic for direct SQLite helpers', () => {
    for (const key of KNOWLEDGE_TEST_ROUTE_ENV_KEYS) expect(process.env[key], key).toBeUndefined();
  });

  test('help and subcommand help work', () => {
    const result = runCli(['--help']);
    expect(result.exitCode).toBe(0);
    const out = new TextDecoder().decode(result.stdout);
    expect(out).toContain('knowledge - local agent knowledge store');
    expect(out).toContain('Commands:');
    expect(out).toContain('events emit|list|replay');
    expect(out).toContain('webhooks add|list|remove|test');
    expect(out).toContain('inventory');
    expect(out).toContain('context pack <query>');
    expect(out).toContain('proposals context');
    expect(out).toContain('guarded capabilities');
    expect(out).toContain('guarded execute-descriptor');

    const sub = runCli(['help', 'list']);
    expect(sub.exitCode).toBe(0);
    const subOut = new TextDecoder().decode(sub.stdout);
    expect(subOut).toContain('--sort created|title');

    const inventory = runCli(['help', 'inventory']);
    expect(inventory.exitCode).toBe(0);
    expect(new TextDecoder().decode(inventory.stdout)).toContain('knowledge inventory');

    const context = runCli(['help', 'context']);
    expect(context.exitCode).toBe(0);
    expect(new TextDecoder().decode(context.stdout)).toContain('knowledge context pack');

    const guarded = runCli(['guarded', 'capabilities', '--json']);
    expect(guarded.exitCode).toBe(0);
    const guardedResult = JSON.parse(new TextDecoder().decode(guarded.stdout)) as Record<string, unknown>;
    expect(guardedResult).toMatchObject({
      ok: true,
      contract: 'FCAME-1',
      private_input: true,
      private_result: true,
      exact_title_lookup: true,
      private_transport_body_output: false,
      private_cli_transport: 'process_ipc',
    });

    const directIpc = runCli(['guarded', 'execute-descriptor', '--ipc']);
    expect(directIpc.exitCode).toBe(1);
    expect(new TextDecoder().decode(directIpc.stdout)).toBe('');
    expect(new TextDecoder().decode(directIpc.stderr)).toContain('guarded_descriptor_private_ipc_required');
  });

  test('guarded descriptor worker refuses argv, stdin, and ordinary file descriptors without leaking private input', () => {
    const privateBody = 'private guarded CLI body must not cross public process surfaces';
    const privateFlag = 'private-guarded-cli-title-sentinel-7f8e1b';

    for (const args of [
      ['guarded', 'execute-descriptor', privateBody],
      ['guarded', 'execute-descriptor', '--content', privateBody],
      ['guarded', 'execute-descriptor', '--title', privateBody],
      ['guarded', 'execute-descriptor', `--${privateFlag}`],
      ['guarded', `--${privateFlag}`, 'execute-descriptor'],
      [`--${privateFlag}`, 'guarded', 'execute-descriptor'],
    ]) {
      const result = runCli(args);
      expect(result.exitCode).toBe(1);
      expect(new TextDecoder().decode(result.stdout)).not.toContain(privateBody);
      expect(new TextDecoder().decode(result.stderr)).not.toContain(privateBody);
      expect(new TextDecoder().decode(result.stderr)).not.toContain(privateFlag);
    }

    const stdin = runCliWithInput(
      ['guarded', 'execute-descriptor', '--request-fd', '0', '--result-fd', '4'],
      privateBody,
    );
    expect(stdin.exitCode).toBe(1);
    expect(stdin.stdout.toString()).not.toContain(privateBody);
    expect(stdin.stderr.toString()).not.toContain(privateBody);

    const dir = mkdtempSync(join(tmpdir(), 'knowledge-private-cli-regular-file-'));
    const request = join(dir, 'request.json');
    const result = join(dir, 'result.json');
    writeFileSync(request, privateBody);
    writeFileSync(result, '');
    const requestFd = openSync(request, 'r');
    const resultFd = openSync(result, 'w');
    const regular = spawnSync('bun', [
      CLI,
      'guarded',
      'execute-descriptor',
      '--request-fd',
      '3',
      '--result-fd',
      '4',
    ], {
      env: childEnv(),
      stdio: ['ignore', 'pipe', 'pipe', requestFd, resultFd],
    });
    closeSync(requestFd);
    closeSync(resultFd);
    expect(regular.status).toBe(1);
    expect(regular.stdout.toString()).not.toContain(privateBody);
    expect(regular.stderr.toString()).not.toContain(privateBody);
    expect(readFileSync(result, 'utf8')).not.toContain(privateBody);

    if (process.platform !== 'win32') {
      const fifo = join(dir, 'request.fifo');
      const fifoResult = join(dir, 'fifo-result.json');
      const createdFifo = spawnSync('mkfifo', [fifo]);
      expect(createdFifo.status).toBe(0);
      writeFileSync(fifoResult, '');
      const fifoFd = openSync(fifo, 'r+');
      const fifoResultFd = openSync(fifoResult, 'w');
      const namedFifo = spawnSync('bun', [
        CLI,
        'guarded',
        'execute-descriptor',
        '--request-fd',
        '3',
        '--result-fd',
        '4',
      ], {
        env: childEnv(),
        stdio: ['ignore', 'pipe', 'pipe', fifoFd, fifoResultFd],
      });
      closeSync(fifoFd);
      closeSync(fifoResultFd);
      expect(namedFifo.status).toBe(1);
      expect(namedFifo.stderr.toString()).toContain('request_fd_must_be_anonymous_pipe_or_socket');
      expect(namedFifo.stderr.toString()).not.toContain('anonymous_pipe_identity_unverified');
      expect(namedFifo.stderr.toString()).not.toContain('private_request_schema_invalid');
    }
  });

  test('guarded descriptor IPC establishes from a Node parent before request delivery', () => {
    const builtCli = join(__dirname, '..', packageJson.bin.knowledge);
    const probe = [
      'const { spawn } = require("node:child_process");',
      'const child = spawn(process.argv[1], [process.argv[2], "guarded", "execute-descriptor", "--ipc", "--json"], { stdio: ["ignore", "ignore", "ignore", "ipc"] });',
      'let privateFailure = false;',
      'const timer = setTimeout(() => { child.kill(); process.exit(3); }, 10000);',
      'child.on("message", (raw) => {',
      '  const result = JSON.parse(String(raw));',
      '  privateFailure = result.ok === false && result.transport === "process_ipc" && result.code === "private_request_schema_invalid";',
      '});',
      'child.on("error", () => process.exit(4));',
      'child.on("close", (code) => {',
      '  clearTimeout(timer);',
      '  process.stdout.write(JSON.stringify({ private_failure: privateFailure, exit_code: code }));',
      '});',
      'child.send("{}");',
    ].join('\n');
    const result = spawnSync('node', ['-e', probe, process.execPath, builtCli], {
      env: childEnv(),
      maxBuffer: 64 * 1024,
    });
    expect(result.status).toBe(0);
    expect(result.stderr.toString()).toBe('');
    expect(JSON.parse(result.stdout.toString())).toEqual({
      private_failure: true,
      exit_code: 1,
    });
  });

  test("'<sub> --help' prints that subcommand's usage, not root help", () => {
    // Regression: `knowledge add --help` used to print the generic ROOT help
    // (full command tree) instead of the per-command usage line.
    const addHelp = runCli(['add', '--help']);
    expect(addHelp.exitCode).toBe(0);
    const addOut = new TextDecoder().decode(addHelp.stdout);
    expect(addOut).toContain('Usage: knowledge add <title> <content> [--url <url>] [-t <tag>]... [--json]');
    // The repeatable/comma-separated -t contract is documented where agents will see it.
    expect(addOut).toContain('-t/--tag is repeatable and accepts comma-separated values');
    // Must NOT fall through to the root help command tree.
    expect(addOut).not.toContain('knowledge - local agent knowledge store');

    // `-h` short flag behaves the same.
    const addHelpShort = runCli(['add', '-h']);
    expect(addHelpShort.exitCode).toBe(0);
    const addShortOut = new TextDecoder().decode(addHelpShort.stdout);
    expect(addShortOut).toContain('Usage: knowledge add <title> <content>');
    expect(addShortOut).not.toContain('knowledge - local agent knowledge store');

    // `<sub> --help` and `help <sub>` agree.
    const listFlag = new TextDecoder().decode(runCli(['list', '--help']).stdout);
    const listHelp = new TextDecoder().decode(runCli(['help', 'list']).stdout);
    expect(listFlag).toContain('--sort created|title');
    expect(listFlag).toBe(listHelp);

    // An aliased subcommand resolves to its canonical usage.
    const lsFlag = new TextDecoder().decode(runCli(['ls', '--help']).stdout);
    expect(lsFlag).toContain('knowledge list|ls');

    // Bare `--help` still shows the root help.
    const rootHelp = new TextDecoder().decode(runCli(['--help']).stdout);
    expect(rootHelp).toContain('knowledge - local agent knowledge store');
  });

  test('events command uses shared help surface', () => {
    const dir = mkdtempSync(join(tmpdir(), 'knowledge-events-cli-'));
    const result = runCli(['events', '--help'], undefined, { HASNA_EVENTS_DIR: dir });
    expect(result.exitCode).toBe(0);
    expect(new TextDecoder().decode(result.stdout)).toContain('Emit, list, and replay Hasna events');
  });

  test('version flag works', () => {
    const result = runCli(['--version']);
    expect(result.exitCode).toBe(0);
    const out = new TextDecoder().decode(result.stdout);
    expect(out).toContain(packageJson.name);
    expect(out).toContain(packageJson.version);
  });

  test('metadata commands are not blocked by a retired storage selector', () => {
    // A stale provisioning fragment such as HASNA_KNOWLEDGE_STORAGE_MODE must
    // not make the CLI unreadable: --version, --completions and help never
    // touch storage, so an operator with a retired selector in the
    // environment must still be able to read them.
    const stale = { HASNA_KNOWLEDGE_STORAGE_MODE: 'cloud' };
    for (const args of [['--version'], ['--completions', 'bash'], ['help']]) {
      const result = runCli(args, undefined, stale);
      expect(result.exitCode, `${args.join(' ')} must exit 0 with a retired selector present`).toBe(0);
    }

    // A command that resolves storage or transport still fails loud and names
    // the retired variable, so the fail-loud ratchet is preserved where it
    // protects data selection.
    const list = runCli(['list', '--limit', '1'], undefined, stale);
    expect(list.exitCode).not.toBe(0);
    expect(new TextDecoder().decode(list.stderr)).toMatch(/HASNA_KNOWLEDGE_STORAGE_MODE/);
  });

  test('package exposes only knowledge CLI bins', () => {
    expect(packageJson.bin).toEqual({
      knowledge: 'bin/knowledge.js',
      'knowledge-mcp': 'bin/knowledge-mcp.js',
      'knowledge-serve': 'bin/knowledge-serve.js',
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

  test('knowledge bin rejects unknown single-token command instead of running ask', () => {
    // Regression: when invoked as the `knowledge` bin, an unknown top-level command
    // (`knowledge boguscmd`, `knowledge lst`) was silently remapped to an ask/build
    // search prompt and exited 0, returning false success to scripts. It must now fail.
    for (const bogus of ['boguscmd', 'lst']) {
      const result = runKnowledgeBin([bogus]);
      expect(result.exitCode).toBe(1);
      const out = new TextDecoder().decode(result.stdout);
      const err = new TextDecoder().decode(result.stderr);
      expect(out).not.toContain('Prepared citation context draft');
      expect(err).toContain(`Unknown command: ${bogus}`);
    }
    // The `lst` typo should also surface the levenshtein suggestion.
    const typo = runKnowledgeBin(['lst']);
    expect(new TextDecoder().decode(typo.stderr)).toContain("Did you mean 'list'");
  }, budget(20000));

  test('knowledge bin rejects unsupported show command for every supported item identifier', () => {
    // Regression: the dispatcher originally recognized only generated `k_...` ids.
    // ItemStore.get accepts an item's full `id` or its `short_id`, and upsert permits
    // caller-supplied ids, so dispatch must use that same identity contract. Otherwise
    // a valid short/custom identifier is silently treated as prompt text and
    // `--fake --generate` proves the generation path is reachable at exit 0.
    const dir = mkdtempSync(join(tmpdir(), 'reject-unknown-show-'));
    const home = mkdtempSync(join(tmpdir(), 'reject-unknown-show-home-'));
    const env = isolatedHomeEnv(home);
    const store = join(dir, 'items.json');
    const generatedId = 'k_review_get_control';
    const customId = 'review-custom-id';

    const generated = runKnowledgeBin(
      ['upsert', 'Generated id item', 'Generated id body', '--id', generatedId, '--store', store, '--json'],
      dir,
      env,
    );
    expect(generated.exitCode).toBe(0);
    const generatedItem = JSON.parse(new TextDecoder().decode(generated.stdout)).item as {
      id: string;
      short_id: string;
    };
    expect(generatedItem).toMatchObject({ id: generatedId, short_id: 'review_get_c' });

    const custom = runKnowledgeBin(
      ['upsert', 'Custom id item', 'Custom id body', '--id', customId, '--store', store, '--json'],
      dir,
      env,
    );
    expect(custom.exitCode).toBe(0);
    const customItem = JSON.parse(new TextDecoder().decode(custom.stdout)).item as {
      id: string;
      short_id: string;
    };
    expect(customItem.id).toBe(customId);

    const references = [generatedItem.id, generatedItem.short_id, customItem.id];
    for (const reference of references) {
      for (const generationFlags of [[], ['--fake', '--generate']]) {
        const result = runKnowledgeBin(
          ['show', reference, ...generationFlags, '--store', store, '--json'],
          dir,
          env,
        );

        expect(result.exitCode).toBe(1);
        const stdout = new TextDecoder().decode(result.stdout).trim();
        const stderr = new TextDecoder().decode(result.stderr);
        const out = JSON.parse(stdout) as Record<string, unknown>;
        expect(out.ok).toBe(false);
        expect(out.error).toContain('Unknown command: show');
        for (const promptField of ['prompt', 'generated', 'answer', 'citations', 'provider', 'model', 'usage']) {
          expect(out).not.toHaveProperty(promptField);
        }
        expect(stderr).toContain('Unknown command: show');
      }

      // The supported lookup command must keep accepting every identity form
      // that the fail-closed dispatcher recognizes.
      const get = runKnowledgeBin(['get', '--id', reference, '--store', store, '--json'], dir, env);
      expect(get.exitCode).toBe(0);
      expect(JSON.parse(new TextDecoder().decode(get.stdout)).item.id).toBe(
        reference === customItem.id ? customItem.id : generatedItem.id,
      );
    }

    // The same text is still valid when the caller selects the ask path
    // explicitly, and both documented free-form shorthand forms still route to ask.
    const explicitAsk = runKnowledgeBin(
      ['ask', 'show', generatedItem.short_id, '--store', store, '--json'],
      dir,
      env,
    );
    expect(explicitAsk.exitCode).toBe(0);
    expect(JSON.parse(new TextDecoder().decode(explicitAsk.stdout)).prompt).toBe(`show ${generatedItem.short_id}`);

    const explicitFakeGeneration = runKnowledgeBin(
      ['ask', 'show', customItem.id, '--fake', '--generate', '--store', store, '--json'],
      dir,
      env,
    );
    expect(explicitFakeGeneration.exitCode).toBe(0);
    const explicitFakeOut = JSON.parse(new TextDecoder().decode(explicitFakeGeneration.stdout));
    expect(explicitFakeOut).toMatchObject({
      prompt: `show ${customItem.id}`,
      generated: true,
      usage: { cost_usd: 0 },
    });
    expect(explicitFakeOut.answer).toContain('Fake generated answer');

    const freeForm = runKnowledgeBin(
      ['show', 'me', 'the', 'handbook', '--store', store, '--json'],
      dir,
      env,
    );
    expect(freeForm.exitCode).toBe(0);
    expect(JSON.parse(new TextDecoder().decode(freeForm.stdout)).prompt).toBe('show me the handbook');

    const quotedFreeForm = runKnowledgeBin(
      ['show me the handbook', '--store', store, '--json'],
      dir,
      env,
    );
    expect(quotedFreeForm.exitCode).toBe(0);
    expect(JSON.parse(new TextDecoder().decode(quotedFreeForm.stdout)).prompt).toBe('show me the handbook');
  }, budget(20000));

  test('knowledge bin keeps multi-word natural-language ask shorthand', () => {
    // The documented `knowledge <prompt>` shorthand for multi-word prompts must still
    // route to ask/build so genuine natural-language queries keep working. Use an
    // isolated HOME so the ask searches an empty store (fast, deterministic) rather
    // than the operator's real global knowledge DB.
    const dir = mkdtempSync(join(tmpdir(), 'ok-nl-ask-'));
    const home = mkdtempSync(join(tmpdir(), 'ok-nl-ask-home-'));
    const result = runKnowledgeBin(['how', 'do', 'I', 'cite', 'sources', '--scope', 'project', '--json'], dir, isolatedHomeEnv(home));
    expect(result.exitCode).toBe(0);
    const out = JSON.parse(new TextDecoder().decode(result.stdout));
    expect(out.ok).toBe(true);
    expect(out.prompt).toBe('how do I cite sources');
  }, budget(20000));

  test('knowledge bin keeps quoted single-token natural-language ask shorthand', () => {
    // Regression guard: the canonical documented form passes the whole prompt as one
    // quoted argument (`knowledge "How do we cite handbook policy?"`), so it arrives as a
    // single positional token that CONTAINS whitespace. It must still route to ask/build
    // (not be rejected as an unknown single-token command).
    const dir = mkdtempSync(join(tmpdir(), 'ok-nl-ask-quoted-'));
    const home = mkdtempSync(join(tmpdir(), 'ok-nl-ask-quoted-home-'));
    const result = runKnowledgeBin(['How do we cite handbook policy?', '--scope', 'project', '--json'], dir, isolatedHomeEnv(home));
    expect(result.exitCode).toBe(0);
    const out = JSON.parse(new TextDecoder().decode(result.stdout));
    expect(out.ok).toBe(true);
    expect(out.prompt).toBe('How do we cite handbook policy?');
  }, budget(20000));

  test('usage/validation errors do not leak an internal stack trace', () => {
    // Regression: usage/validation errors previously logged the full Error stack
    // (bundled bin path + minified function names) to stderr. They must show only
    // a plain message on the default (non-debug) path.
    const result = runCli(['add'], undefined, { DEBUG: '', LOG_LEVEL: 'info' });
    expect(result.exitCode).toBe(1);
    const err = new TextDecoder().decode(result.stderr);
    expect(err).toContain('Usage: knowledge add <title> <content>');
    expect(err).not.toContain('CLI error');
    expect(err).not.toContain('"stack"');
    expect(err).not.toMatch(/\n\s+at\s/);
    expect(err).not.toContain('cli.ts');

    // Debug logging may still surface the diagnostic (with stack) for troubleshooting.
    const debug = runCli(['add'], undefined, { DEBUG: '1' });
    expect(debug.exitCode).toBe(1);
    const debugErr = new TextDecoder().decode(debug.stderr);
    expect(debugErr).toContain('CLI error');
    expect(debugErr).toContain('"stack"');
  });

  test('--json error paths emit a machine-parseable object on stdout', () => {
    // Each of these commands fails; with --json the failure must be readable
    // on stdout as { ok: false, error }, not only as plaintext on stderr.
    const cases: string[][] = [
      ['add', '--json'], // missing required title/content
      ['providers', 'check', 'nonexistent', '--json'], // unsupported provider
      ['lits', '--json'], // unknown command
      ['get', '--json'], // missing required --id
    ];
    for (const args of cases) {
      const result = runCli(args);
      expect(result.exitCode).toBe(1);
      const stdout = new TextDecoder().decode(result.stdout).trim();
      expect(stdout.length).toBeGreaterThan(0);
      const parsed = JSON.parse(stdout);
      expect(parsed.ok).toBe(false);
      expect(typeof parsed.error).toBe('string');
      expect(parsed.error.length).toBeGreaterThan(0);
    }
  });

  test('non-json error paths keep plaintext stderr and empty stdout', () => {
    const result = runCli(['add']);
    expect(result.exitCode).toBe(1);
    expect(new TextDecoder().decode(result.stdout).trim()).toBe('');
    expect(new TextDecoder().decode(result.stderr)).toContain('Error:');
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

    const verboseList = runCli(['list', '--store', store, '--verbose', '-l', '10', '--sort', 'title']);
    expect(verboseList.exitCode).toBe(0);
    const verboseListOut = JSON.parse(new TextDecoder().decode(verboseList.stdout));
    expect(verboseListOut.items[0].title).toBe('TitleA');
    expect(verboseListOut.items[0].content).toBe('BodyB');

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

  test('add accepts frontmatter content directly and after the end-of-options marker', () => {
    const dir = mkdtempSync(join(tmpdir(), 'ok-cli-frontmatter-'));
    const store = join(dir, 'db.json');
    const decode = (buf: Uint8Array) => new TextDecoder().decode(buf);
    const frontmatter = '---\ntags:\n  - strategy\n---\nBody';

    const direct = runCli(['add', 'Direct frontmatter', frontmatter, '--store', store, '--json']);
    expect(direct.exitCode).toBe(0);
    const directOut = JSON.parse(decode(direct.stdout));
    expect(directOut.item.content).toBe(frontmatter);

    const terminated = runCli(['add', '--store', store, '--json', '--', 'Terminated frontmatter', frontmatter]);
    expect(terminated.exitCode).toBe(0);
    const terminatedOut = JSON.parse(decode(terminated.stdout));
    expect(terminatedOut.item.content).toBe(frontmatter);

    const listed = runCli(['list', '--store', store, '--json', '--sort', 'title']);
    expect(listed.exitCode).toBe(0);
    expect(JSON.parse(decode(listed.stdout)).items.map((item: { content: string }) => item.content)).toEqual([
      frontmatter,
      frontmatter,
    ]);
  });

  // Regression guard for the slug-resolution defect in `list --search`.
  //
  // `--search` is a case-insensitive literal substring filter, and it matched ONLY
  // `title` and `content` — never the item's `id`. The dominant instructed use of the
  // flag across the skill corpus is SLUG RESOLUTION ("resolve knowledge slugs via
  // `knowledge list --search <slug>`"), and that use failed silently: an existing item
  // queried by its own id returned `total: 0` at exit 0, with nothing to distinguish it
  // from a genuinely absent item. Because this is the dedupe path, that false zero reads
  // as "no existing item, safe to create" and manufactures duplicate knowledge items.
  //
  // What made it survive: an item whose CONTENT happens to quote its own slug matched
  // anyway, so a spot check could pass for the wrong reason. `id-not-in-body` below is
  // the case that cannot pass by coincidence — its slug appears in neither field — and
  // `id-quoted-in-body` pins the coincidence so a future reader cannot mistake it for
  // evidence that ids were being searched all along.
  test('list --search resolves an item by its id, not only title and content', () => {
    const dir = mkdtempSync(join(tmpdir(), 'ok-list-search-id-'));
    const store = join(dir, 'db.json');
    const decode = (buf: Uint8Array) => new TextDecoder().decode(buf);
    const total = (args: string[]): number => {
      const res = runCli(['list', '--store', store, '--json', '-l', '50', ...args]);
      expect(res.exitCode).toBe(0);
      return JSON.parse(decode(res.stdout)).total;
    };
    const ids = (args: string[]): string[] => {
      const res = runCli(['list', '--store', store, '--json', '-l', '50', ...args]);
      expect(res.exitCode).toBe(0);
      return JSON.parse(decode(res.stdout)).items.map((item: { id: string }) => item.id);
    };

    // The defect case: the slug is in NEITHER the title nor the content, so nothing but
    // an id-aware filter can return it.
    const seeded = runCli([
      'upsert', 'Loop labelling taxonomy', 'Body about labelling and classification.',
      '--id', 'id-not-in-body', '--store', store, '--json',
    ]);
    expect(seeded.exitCode).toBe(0);

    // The coincidence case, pinned so it is never read as evidence about ids.
    const quoted = runCli([
      'upsert', 'Quoted slug', 'This body mentions id-quoted-in-body verbatim.',
      '--id', 'id-quoted-in-body', '--store', store, '--json',
    ]);
    expect(quoted.exitCode).toBe(0);

    // Positive control on the STORE, not just the query: both items really are present,
    // so a zero below is a statement about the filter and not about an empty fixture.
    expect(total([])).toBe(2);

    // The regression itself.
    expect(ids(['--search', 'id-not-in-body'])).toEqual(['id-not-in-body']);

    // Case-insensitive on the id, matching how the flag already treats title and content.
    expect(ids(['--search', 'ID-NOT-IN-BODY'])).toEqual(['id-not-in-body']);

    // Substring of an id must match, since this is a substring filter and not a token search.
    expect(ids(['--search', 'not-in-body'])).toEqual(['id-not-in-body']);

    // No regression: title and content matching still work and still return only their match.
    expect(ids(['--search', 'labelling taxonomy'])).toEqual(['id-not-in-body']);
    expect(ids(['--search', 'mentions'])).toEqual(['id-quoted-in-body']);

    // NEGATIVE CONTROL — the check must be able to report zero. Without this the
    // assertions above would also pass against a filter that returned everything.
    expect(total(['--search', 'no-item-carries-this-string'])).toBe(0);
    // Ten CLI spawns at roughly half a second each sit right on the 5s default, so the
    // budget is explicit rather than left to chance. It was measured under a full-suite
    // run, not in isolation — see the 20000 used by the other multi-spawn tests here.
  }, budget(20000));

  // Regression guard for the silent multi-tag data-loss defect: `add -t a -t b -t c`
  // exited 0, logged "Item added", and persisted ONLY the last tag; `-t "a,b,c"`
  // stored one literal comma string. Every assertion below reads the PERSISTED item
  // back and counts tags — asserting on exitCode alone reproduces the original bug,
  // because exit 0 could not distinguish "3 tags stored" from "1 tag stored".
  test('repeated and comma-separated -t accumulate into the stored item', () => {
    const dir = mkdtempSync(join(tmpdir(), 'ok-tags-'));
    const store = join(dir, 'db.json');
    const decode = (buf: Uint8Array) => new TextDecoder().decode(buf);
    const storedTags = (id: string): string[] => {
      const got = runCli(['get', '--id', id, '--store', store, '--json']);
      expect(got.exitCode).toBe(0);
      return JSON.parse(decode(got.stdout)).item.tags;
    };

    // add: five repeated -t must all persist, in order.
    const add = runCli(['add', 'Five tags', 'Body', '--store', store, '-t', 'convention', '-t', 'naming', '-t', 'channels', '-t', 'repro', '-t', 'five', '--json']);
    expect(add.exitCode).toBe(0);
    const addId = JSON.parse(decode(add.stdout)).item.id;
    expect(storedTags(addId)).toEqual(['convention', 'naming', 'channels', 'repro', 'five']);
    // The success signal itself must carry the count, so "added" can no longer hide a drop.
    expect(decode(add.stderr)).toContain('"tags":5');

    // add: a comma-separated value splits; it must never persist as one literal tag.
    const comma = runCli(['add', 'Comma tags', 'Body', '--store', store, '-t', 'alpha,beta, gamma', '--json']);
    expect(comma.exitCode).toBe(0);
    const commaId = JSON.parse(decode(comma.stdout)).item.id;
    expect(storedTags(commaId)).toEqual(['alpha', 'beta', 'gamma']);
    expect(storedTags(commaId)).not.toContain('alpha,beta, gamma');

    // add: comma list plus repeats, deduped case-insensitively.
    const mixed = runCli(['add', 'Mixed tags', 'Body', '--store', store, '-t', 'x, y', '-t', 'z', '-t', 'X', '--json']);
    expect(mixed.exitCode).toBe(0);
    expect(storedTags(JSON.parse(decode(mixed.stdout)).item.id)).toEqual(['x', 'y', 'z']);

    // update: repeated -t must append every tag, not just the last one.
    const seed = runCli(['add', 'Update target', 'Body', '--store', store, '-t', 'one', '--json']);
    expect(seed.exitCode).toBe(0);
    const seedId = JSON.parse(decode(seed.stdout)).item.id;
    const update = runCli(['update', '--id', seedId, '--store', store, '-t', 'two', '-t', 'three', '-t', 'four', '--json']);
    expect(update.exitCode).toBe(0);
    expect(storedTags(seedId)).toEqual(['one', 'two', 'three', 'four']);

    // untag: repeated -t removes every named tag in one pass.
    const untag = runCli(['untag', '--id', seedId, '--store', store, '-t', 'two', '-t', 'four', '--json']);
    expect(untag.exitCode).toBe(0);
    expect(JSON.parse(decode(untag.stdout)).removed).toBe(2);
    expect(storedTags(seedId)).toEqual(['one', 'three']);

    // upsert: create path must persist every tag too.
    const upsert = runCli(['upsert', 'Upsert tags', 'Body', '--id', 'k_tagupsert', '--store', store, '-t', 'p', '-t', 'q', '-t', 'r', '--json']);
    expect(upsert.exitCode).toBe(0);
    expect(JSON.parse(decode(upsert.stdout)).created).toBe(true);
    expect(storedTags('k_tagupsert')).toEqual(['p', 'q', 'r']);

    // upsert: update path appends all requested tags.
    const upsertAgain = runCli(['upsert', '--id', 'k_tagupsert', '--content', 'Body 2', '--store', store, '-t', 's', '-t', 't', '--json']);
    expect(upsertAgain.exitCode).toBe(0);
    expect(storedTags('k_tagupsert')).toEqual(['p', 'q', 'r', 's', 't']);

    // list: repeated -t narrows (item must carry every tag), matching the ok_list MCP tool.
    const both = runCli(['list', '--store', store, '-t', 'convention', '-t', 'naming', '--json']);
    expect(both.exitCode).toBe(0);
    const bothOut = JSON.parse(decode(both.stdout));
    expect(bothOut.total).toBe(1);
    expect(bothOut.items[0].title).toBe('Five tags');

    const impossible = runCli(['list', '--store', store, '-t', 'convention', '-t', 'alpha', '--json']);
    expect(impossible.exitCode).toBe(0);
    expect(JSON.parse(decode(impossible.stdout)).total).toBe(0);

    // Positive control: the same store really does hold the items the filters ran over.
    const all = runCli(['list', '--store', store, '--json', '-l', '50']);
    expect(all.exitCode).toBe(0);
    expect(JSON.parse(decode(all.stdout)).total).toBe(5);

    // A -t with no usable value must fail loudly instead of silently dropping the tag.
    const missing = runCli(['add', 'No tag value', 'Body', '--store', store, '-t']);
    expect(missing.exitCode).toBe(1);
    expect(decode(missing.stderr)).toContain('Missing value for --tag');

    const blank = runCli(['add', 'Blank tag value', 'Body', '--store', store, '-t', ' , ']);
    expect(blank.exitCode).toBe(1);
    expect(decode(blank.stderr)).toContain('no tag name found');
  });

  // Once `-t` splits on commas, a split-only `untag` can no longer touch the items the
  // multi-tag defect actually damaged: they carry ONE literal "a,b,c" tag, and none of
  // the split names equals it, so the removal silently no-ops at exit 0. These items
  // cannot be produced by the fixed CLI, so the fixture is written straight to the store
  // exactly as the pre-fix CLI would have persisted it.
  test('untag matches a tag value whole before splitting, and fails when nothing is removed', () => {
    const dir = mkdtempSync(join(tmpdir(), 'ok-untag-'));
    const store = join(dir, 'db.json');
    const decode = (buf: Uint8Array) => new TextDecoder().decode(buf);
    const glued = 'convention,canonical,policy,deployment';
    const seed = (id: string, tags: string[]) => {
      const now = '2026-07-06T14:31:34.606Z';
      writeFileSync(store, JSON.stringify({
        items: [{ id, title: `Item ${id}`, content: 'Body', url: null, tags, metadata: {}, archived: false, created_at: now, updated_at: now }]
      }));
    };
    const storedTags = (id: string): string[] => {
      const got = runCli(['get', '--id', id, '--store', store, '--json']);
      expect(got.exitCode).toBe(0);
      return JSON.parse(decode(got.stdout)).item.tags;
    };

    // Positive control: the fixture really does hold one glued tag, not four.
    seed('k_glued', [glued]);
    expect(storedTags('k_glued')).toEqual([glued]);

    // The whole value matches the stored tag, so it is removed. Split-only logic scores
    // removed: 0 here while still exiting 0 — the regression this guards.
    const whole = runCli(['untag', '--id', 'k_glued', '--store', store, '-t', glued, '--json']);
    expect(whole.exitCode).toBe(0);
    expect(JSON.parse(decode(whole.stdout)).removed).toBe(1);
    expect(storedTags('k_glued')).toEqual([]);

    // Same argument against separately-stored tags must still split and remove all four.
    seed('k_split', ['convention', 'canonical', 'policy', 'deployment', 'keep']);
    const split = runCli(['untag', '--id', 'k_split', '--store', store, '-t', glued, '--json']);
    expect(split.exitCode).toBe(0);
    expect(JSON.parse(decode(split.stdout)).removed).toBe(4);
    expect(storedTags('k_split')).toEqual(['keep']);

    // Removing nothing must fail loudly and leave the item untouched, instead of
    // printing "Removed tag from <id>" at exit 0 on removed: 0.
    seed('k_absent', ['alpha', 'beta']);
    const absent = runCli(['untag', '--id', 'k_absent', '--store', store, '-t', 'gamma', '--json']);
    expect(absent.exitCode).toBe(1);
    expect(decode(absent.stderr)).toContain('No matching tag on k_absent');
    expect(decode(absent.stdout)).not.toContain('Removed');
    expect(storedTags('k_absent')).toEqual(['alpha', 'beta']);

    // A partial miss succeeds but must name the tags it could not find.
    seed('k_partial', ['alpha', 'beta']);
    const partial = runCli(['untag', '--id', 'k_partial', '--store', store, '-t', 'alpha', '-t', 'nope', '--json']);
    expect(partial.exitCode).toBe(0);
    const partialOut = JSON.parse(decode(partial.stdout));
    expect(partialOut.removed).toBe(1);
    expect(partialOut.not_found).toEqual(['nope']);
    expect(storedTags('k_partial')).toEqual(['beta']);

    // ...and it must say so in `message` too, because non-JSON output prints nothing else.
    seed('k_partial_human', ['alpha', 'beta']);
    const partialHuman = runCli(['untag', '--id', 'k_partial_human', '--store', store, '-t', 'alpha', '-t', 'nope']);
    expect(partialHuman.exitCode).toBe(0);
    expect(decode(partialHuman.stdout)).toContain('not found: "nope"');

    // This pins the QUOTING of the unmatched names, not a comma collision. There is no
    // comma collision to fix: a comma-bearing value only enters the removal set via the
    // whole-value branch, which requires the tag to be stored, so it is found by definition
    // and never reaches `not_found`. One missing tag literally named `p, q` is unreachable,
    // and since every entry is comma-free the raw `', '` join is injective — `["p","q"]`
    // prints `p, q` and `["p q"]` prints `p q`, which are different strings.
    //
    // The quoting is still load-bearing, for names carrying whitespace the parser does not
    // strip: `trim()` only removes the ends, so `-t $'p\nq'` stores nothing but yields
    // `not_found: ["p\nq"]`, and joined raw that would split the single-line message across
    // two lines. Tab behaves the same. `JSON.stringify` escapes both, which is why the
    // assertion below is on the quoted form. See the separate whitespace case at the end of
    // this test; here the pair is what pins the delimiter itself.
    seed('k_partial_two', ['alpha']);
    const partialTwo = runCli(['untag', '--id', 'k_partial_two', '--store', store, '-t', 'alpha', '-t', 'p,q']);
    expect(partialTwo.exitCode).toBe(0);
    const twoOut = decode(partialTwo.stdout);
    expect(twoOut).toContain('(not found: "p", "q")');
    expect(twoOut).not.toContain('(not found: p, q)');

    // The reachable reason the quoting exists: `trim()` strips only the ends, so a control
    // character inside a name survives into `not_found`. Joined raw, that newline would
    // break this single-line message in two and the tail would read as separate output.
    // Quoted, the whole name stays on one line as `"p\nq"`.
    seed('k_partial_ws', ['alpha']);
    const partialWs = runCli(['untag', '--id', 'k_partial_ws', '--store', store, '-t', 'alpha', '-t', 'p\nq', '--json']);
    expect(partialWs.exitCode).toBe(0);
    const wsOut = JSON.parse(decode(partialWs.stdout));
    expect(wsOut.not_found).toEqual(['p\nq']);
    expect(wsOut.message).toBe('Removed 1 tag from k_partial_ws (not found: "p\\nq")');
    expect(wsOut.message.split('\n')).toHaveLength(1);
    expect(storedTags('k_partial_ws')).toEqual([]);

    // The human success line must carry the count, so it cannot read the same for 1 and 0.
    seed('k_human', ['alpha', 'beta', 'gamma']);
    const human = runCli(['untag', '--id', 'k_human', '--store', store, '-t', 'alpha', '-t', 'beta']);
    expect(human.exitCode).toBe(0);
    expect(decode(human.stdout)).toContain('Removed 2 tags from k_human');
    expect(storedTags('k_human')).toEqual(['gamma']);
  });

  // The documented precedence — "the whole-value match wins and the literal tag is
  // removed first; re-run to clear the split names" — had no test. Dropping the
  // `continue` after a whole-value match leaves the whole suite green while changing
  // this item from removed: 1 to removed: 4, collapsing the contract into "remove
  // every shape at once" and destroying the re-run behaviour README promises.
  test('untag removes the glued tag first when an item carries both shapes, and only then the split names', () => {
    const dir = mkdtempSync(join(tmpdir(), 'ok-untag-both-'));
    const store = join(dir, 'db.json');
    const decode = (buf: Uint8Array) => new TextDecoder().decode(buf);
    const glued = 'a,b,c';
    const now = '2026-07-06T14:31:34.606Z';
    writeFileSync(store, JSON.stringify({
      items: [{ id: 'k_both', title: 'Both shapes', content: 'Body', url: null, tags: [glued, 'a', 'b', 'c', 'keep'], metadata: {}, archived: false, created_at: now, updated_at: now }]
    }));
    const storedTags = (): string[] => {
      const got = runCli(['get', '--id', 'k_both', '--store', store, '--json']);
      expect(got.exitCode).toBe(0);
      return JSON.parse(decode(got.stdout)).item.tags;
    };

    // Positive control: the fixture holds the glued tag AND the three split names.
    expect(storedTags()).toEqual([glued, 'a', 'b', 'c', 'keep']);

    // Run 1 must take the literal tag ONLY. removed: 4 here means the precedence is gone.
    const first = runCli(['untag', '--id', 'k_both', '--store', store, '-t', glued, '--json']);
    expect(first.exitCode).toBe(0);
    expect(JSON.parse(decode(first.stdout)).removed).toBe(1);
    expect(storedTags()).toEqual(['a', 'b', 'c', 'keep']);

    // Run 2 finds no stored tag equal to the whole value, so it falls back to splitting.
    const second = runCli(['untag', '--id', 'k_both', '--store', store, '-t', glued, '--json']);
    expect(second.exitCode).toBe(0);
    expect(JSON.parse(decode(second.stdout)).removed).toBe(3);
    expect(storedTags()).toEqual(['keep']);

    // Run 3 has nothing left to remove and must fail rather than report success.
    const third = runCli(['untag', '--id', 'k_both', '--store', store, '-t', glued, '--json']);
    expect(third.exitCode).toBe(1);
    expect(storedTags()).toEqual(['keep']);
  });

  // The failure message quoted the names it could not find but joined the stored tags
  // raw, so against a single glued tag it read `"iapp" not in [iapp,integrations,
  // architecture]` — denying a tag that is plainly visible, on exactly the damaged items
  // this fallback exists for.
  test('untag failure message quotes stored tags so a glued tag is distinguishable from separate ones', () => {
    const dir = mkdtempSync(join(tmpdir(), 'ok-untag-msg-'));
    const store = join(dir, 'db.json');
    const decode = (buf: Uint8Array) => new TextDecoder().decode(buf);
    const now = '2026-07-06T14:31:34.606Z';
    writeFileSync(store, JSON.stringify({
      items: [{ id: 'k_glued_msg', title: 'Glued', content: 'Body', url: null, tags: ['iapp,integrations,architecture'], metadata: {}, archived: false, created_at: now, updated_at: now }]
    }));

    const miss = runCli(['untag', '--id', 'k_glued_msg', '--store', store, '-t', 'iapp', '--json']);
    expect(miss.exitCode).toBe(1);
    const err = decode(miss.stderr);
    // The stored list must show ONE quoted glued tag, not three bare names.
    expect(err).toContain('"iapp" not in ["iapp,integrations,architecture"]');
    expect(err).not.toContain('not in [iapp,integrations,architecture]');
  });

  // `list -t` is the read-side twin of the untag defect above. Split-only filtering never
  // matches the glued item; what it returns instead depends on the corpus. The fixture below
  // deliberately supplies the worse case — `k_control` carries the three names separately, so
  // split-only answers total: 1 with a DIFFERENT item at exit 0, and the command used to FIND
  // remaining glued items reports a confident wrong answer rather than an empty one. Without
  // such a control item the same defect merely returns total: 0 at exit 0. Both are silent;
  // the swap is the one a fixture has to construct, so this test constructs it.
  test('list -t matches a tag value whole before splitting, so glued items stay discoverable', () => {
    const dir = mkdtempSync(join(tmpdir(), 'ok-list-glued-'));
    const store = join(dir, 'db.json');
    const decode = (buf: Uint8Array) => new TextDecoder().decode(buf);
    const glued = 'iapp,integrations,architecture';
    writeFileSync(store, JSON.stringify({
      items: [
        { id: 'k_damaged', title: 'Damaged', content: 'Body', url: null, tags: [glued], metadata: {}, archived: false, created_at: '2026-07-06T14:31:34.606Z', updated_at: '2026-07-06T14:31:34.606Z' },
        { id: 'k_control', title: 'Control', content: 'Body', url: null, tags: ['iapp', 'integrations', 'architecture'], metadata: {}, archived: false, created_at: '2026-07-06T14:31:35.606Z', updated_at: '2026-07-06T14:31:35.606Z' },
        { id: 'k_partial', title: 'Partial', content: 'Body', url: null, tags: ['iapp', 'integrations'], metadata: {}, archived: false, created_at: '2026-07-06T14:31:36.606Z', updated_at: '2026-07-06T14:31:36.606Z' },
      ]
    }));
    const listIds = (args: string[]): { total: number; ids: string[]; exitCode: number } => {
      const res = runCli(['list', '--store', store, '--limit', '50', '--json', ...args]);
      const out = JSON.parse(decode(res.stdout));
      return { total: out.total, ids: out.items.map((item: { id: string }) => item.id), exitCode: res.exitCode };
    };

    // The glued item MUST be found. Split-only filtering returns ['k_control'] here.
    const whole = listIds(['-t', glued]);
    expect(whole.exitCode).toBe(0);
    expect(whole.ids).toContain('k_damaged');
    expect(whole.ids.sort()).toEqual(['k_control', 'k_damaged']);
    expect(whole.total).toBe(2);

    // Repeated -t must still narrow: k_partial lacks `architecture`, so it drops out, and
    // the glued item does not match a single split name either.
    const narrowed = listIds(['-t', 'iapp', '-t', 'integrations']);
    expect(narrowed.exitCode).toBe(0);
    expect(narrowed.ids.sort()).toEqual(['k_control', 'k_partial']);

    // A single name must NOT be widened into the glued tag by substring matching.
    const single = listIds(['-t', 'iapp']);
    expect(single.exitCode).toBe(0);
    expect(single.ids.sort()).toEqual(['k_control', 'k_partial']);
    expect(single.ids).not.toContain('k_damaged');

    // Negative control: an unrelated tag matches nothing.
    expect(listIds(['-t', 'nope']).total).toBe(0);
  });

  // `update`/`upsert -t` printed `Updated <id>` at exit 0 whether they added 3 tags or 0,
  // and carried the count NOWHERE — not in `message`, not in JSON — the same
  // untruthful-success class as untag's `removed: 0`.
  test('update and upsert report how many tags they actually added', () => {
    const dir = mkdtempSync(join(tmpdir(), 'ok-added-count-'));
    const store = join(dir, 'db.json');
    const decode = (buf: Uint8Array) => new TextDecoder().decode(buf);

    const created = runCli(['add', 'Counted', 'Body', '--store', store, '-t', 'alpha', '--json']);
    expect(created.exitCode).toBe(0);
    const id = JSON.parse(decode(created.stdout)).item.id;

    // Two of the three are new, so the truthful count is 2 — not 3, and not silence.
    const partial = runCli(['update', '--id', id, '--store', store, '-t', 'alpha,beta,gamma', '--json']);
    expect(partial.exitCode).toBe(0);
    const partialOut = JSON.parse(decode(partial.stdout));
    expect(partialOut.added).toBe(2);
    expect(partialOut.message).toContain('(added 2 tags)');
    expect(partialOut.item.tags).toEqual(['alpha', 'beta', 'gamma']);

    // Every requested tag already exists: the count must say 0, at exit 0.
    const noop = runCli(['update', '--id', id, '--store', store, '-t', 'alpha', '--json']);
    expect(noop.exitCode).toBe(0);
    const noopOut = JSON.parse(decode(noop.stdout));
    expect(noopOut.added).toBe(0);
    expect(noopOut.message).toContain('(added 0 tags)');

    // ...and it must say so without --json too, because that prints `message` alone.
    const noopHuman = runCli(['update', '--id', id, '--store', store, '-t', 'alpha']);
    expect(noopHuman.exitCode).toBe(0);
    expect(decode(noopHuman.stdout)).toContain('(added 0 tags)');

    // Singular for one added tag.
    const one = runCli(['update', '--id', id, '--store', store, '-t', 'delta', '--json']);
    expect(one.exitCode).toBe(0);
    expect(JSON.parse(decode(one.stdout)).message).toContain('(added 1 tag)');

    // No -t at all means no count to report, and no bogus `added` field.
    const untagged = runCli(['update', '--id', id, '--store', store, '--title', 'Renamed', '--json']);
    expect(untagged.exitCode).toBe(0);
    const untaggedOut = JSON.parse(decode(untagged.stdout));
    expect(untaggedOut.added).toBeUndefined();
    expect(untaggedOut.message).not.toContain('added');

    // upsert reports `added` on the update path...
    const upsertExisting = runCli(['upsert', '--id', id, '--store', store, '-t', 'delta,epsilon', '--json']);
    expect(upsertExisting.exitCode).toBe(0);
    const upsertExistingOut = JSON.parse(decode(upsertExisting.stdout));
    expect(upsertExistingOut.created).toBe(false);
    expect(upsertExistingOut.added).toBe(1);
    expect(upsertExistingOut.message).toContain('(added 1 tag)');

    // ...and on the create path, so a caller never branches on `created` to read it.
    const upsertNew = runCli(['upsert', 'Fresh', 'Body', '--id', 'k_fresh_count', '--store', store, '-t', 'one,two', '--json']);
    expect(upsertNew.exitCode).toBe(0);
    const upsertNewOut = JSON.parse(decode(upsertNew.stdout));
    expect(upsertNewOut.created).toBe(true);
    expect(upsertNewOut.added).toBe(2);
    expect(upsertNewOut.message).toContain('(added 2 tags)');
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

  test('global notes added through CLI are searchable and available as context', () => {
    const home = mkdtempSync(join(tmpdir(), 'ok-global-note-search-home-'));
    const env = {
      ...isolatedHomeEnv(home),
      HASNA_KNOWLEDGE_AUTH_DIR: join(home, 'auth'),
    };

    const add = runCli([
      'add',
      'Hasna OSS boundary',
      'local-first hosted wrapper open actions guardrails open orgs token=sk-testsecretkeyvalue1234567890',
      '--scope',
      'global',
      '--json',
    ], undefined, env);
    expect(add.exitCode).toBe(0);
    const addOut = JSON.parse(new TextDecoder().decode(add.stdout));

    const update = runCli(['update', '--id', addOut.item.id, '--tag', 'opensource', '--scope', 'global', '--json'], undefined, env);
    expect(update.exitCode).toBe(0);

    const list = runCli(['list', '--tag', 'opensource', '--scope', 'global', '--json'], undefined, env);
    expect(list.exitCode).toBe(0);
    expect(JSON.parse(new TextDecoder().decode(list.stdout)).total).toBe(1);

    const inventory = runCli(['inventory', '--scope', 'global', '--json'], undefined, env);
    expect(inventory.exitCode).toBe(0);
    const inventoryOut = JSON.parse(new TextDecoder().decode(inventory.stdout));
    expect(inventoryOut.summary.legacy_items).toBe(1);
    expect(inventoryOut.summary.chunks).toBe(0);

    const search = runCli(['search', 'Hasna OSS boundary', '--scope', 'global', '--json'], undefined, env);
    expect(search.exitCode).toBe(0);
    const searchOut = JSON.parse(new TextDecoder().decode(search.stdout));
    expect(searchOut.counts.keyword_results).toBe(1);
    expect(searchOut.results[0]).toMatchObject({
      kind: 'legacy_item',
      id: addOut.item.id,
      title: 'Hasna OSS boundary',
      source: { uri: `knowledge://item/${addOut.item.id}` },
    });

    const context = runCli([
      'search',
      'local-first hosted wrapper open actions guardrails open orgs',
      '--context',
      '--scope',
      'global',
      '--json',
    ], undefined, env);
    expect(context.exitCode).toBe(0);
    const contextOut = JSON.parse(new TextDecoder().decode(context.stdout));
    expect(contextOut.results[0]).toMatchObject({ kind: 'legacy_item', id: addOut.item.id });
    expect(contextOut.excerpts[0].text).toContain('local-first hosted wrapper');

    const pack = runCli([
      'context',
      'pack',
      'local-first hosted wrapper open actions guardrails open orgs',
      '--scope',
      'global',
      '--json',
    ], undefined, env);
    expect(pack.exitCode).toBe(0);
    const packOut = JSON.parse(new TextDecoder().decode(pack.stdout));
    expect(packOut.evidence[0]).toMatchObject({ kind: 'legacy_item' });
    expect(packOut.citations[0]).toMatchObject({ source_uri: `knowledge://item/${addOut.item.id}` });
    expect(packOut.citations[0].quote_preview).toContain('[REDACTED:secret_assignment]');
    expect(packOut.citations[0].quote_preview).not.toContain('sk-testsecretkeyvalue');

    const reindex = runCli(['reindex', 'enqueue', '--scope', 'global', '--json'], undefined, env);
    expect(reindex.exitCode).toBe(0);
    expect(JSON.parse(new TextDecoder().decode(reindex.stdout)).enqueued).toBe(0);
  });

  test('global search reads the old legacy note store without migration', () => {
    const home = mkdtempSync(join(tmpdir(), 'ok-global-note-legacy-migrate-'));
    const legacyDir = join(home, '.open-knowledge');
    mkdirSync(legacyDir, { recursive: true });
    writeFileSync(join(legacyDir, 'db.json'), JSON.stringify({
      items: [{
        id: 'k_legacy_global_search',
        title: 'Legacy Global Search',
        content: 'tokenxyz first command migration path',
        url: null,
        tags: ['legacy'],
        created_at: '2026-06-23T00:00:00.000Z',
        updated_at: '2026-06-23T00:01:00.000Z',
      }],
    }));
    const env = {
      ...isolatedHomeEnv(home),
      HASNA_KNOWLEDGE_AUTH_DIR: join(home, 'auth'),
    };

    const search = runCli(['search', 'tokenxyz', '--scope', 'global', '--json'], undefined, env);
    expect(search.exitCode).toBe(0);
    const searchOut = JSON.parse(new TextDecoder().decode(search.stdout));
    expect(searchOut.results[0]).toMatchObject({
      kind: 'legacy_item',
      id: 'k_legacy_global_search',
    });
    expect(existsSync(join(home, '.hasna', 'knowledge', 'db.json'))).toBe(false);
  });

  test('project scope uses .hasna/knowledge workspace', () => {
    const dir = mkdtempSync(join(tmpdir(), 'ok-workspace-'));

    const paths = runCli(['paths', '--scope', 'project', '--json'], dir);
    expect(paths.exitCode).toBe(0);
    const pathsOut = JSON.parse(new TextDecoder().decode(paths.stdout));
    expect(normalizeDarwinPath(pathsOut.home)).toBe(expectedProjectKnowledgeHome(dir));
    expect(pathsOut.exists).toBe(false);
    expect(pathsOut.config_exists).toBe(false);
    expect(pathsOut.json_store_exists).toBe(false);
    expect(pathsOut.knowledge_db_exists).toBe(false);
    expect(existsSync(join(dir, '.hasna', 'knowledge'))).toBe(false);

    const storage = runCli(['storage', 'status', '--scope', 'project', '--json'], dir);
    expect(storage.exitCode).toBe(0);
    const storageOut = JSON.parse(new TextDecoder().decode(storage.stdout));
    expect(storageOut.local_layout.app_path).toBe(join('.hasna', 'knowledge'));
    expect(storageOut.artifact_store.type).toBe('local');
    expect(storageOut.source_ownership.owner).toBe('open-files');
    expect(storageOut.source_ownership.raw_source_bytes_stored_in_open_knowledge).toBe(false);
    expect(storageOut.private_fleet_boundary).toMatchObject({
      manifest_authority: 'open-machines',
      source_ref_authority: 'open-files',
      secret_ref_authority: 'open-secrets',
      raw_private_manifest_bytes_stored_in_open_knowledge: false,
    });
    expect(storageOut.private_fleet_boundary.does_not_store).toContain('sudo passwords');
    expect(existsSync(join(dir, '.hasna', 'knowledge'))).toBe(false);

    const validate = runCli(['storage', 'validate', '--scope', 'project', '--json'], dir);
    expect(validate.exitCode).toBe(0);
    expect(JSON.parse(new TextDecoder().decode(validate.stdout)).ok).toBe(true);
    expect(existsSync(join(dir, '.hasna', 'knowledge'))).toBe(false);

    const inventory = runCli(['inventory', '--scope', 'project', '--json'], dir);
    expect(inventory.exitCode).toBe(0);
    const inventoryOut = JSON.parse(new TextDecoder().decode(inventory.stdout));
    expect(inventoryOut.paths.knowledge_db_exists).toBe(false);
    expect(inventoryOut.summary.sources).toBe(0);
    expect(existsSync(join(dir, '.hasna', 'knowledge'))).toBe(false);

    const search = runCli(['search', 'missing', '--scope', 'project', '--json'], dir);
    expect(search.exitCode).toBe(0);
    const searchOut = JSON.parse(new TextDecoder().decode(search.stdout));
    expect(searchOut.results).toEqual([]);
    expect(searchOut.warnings).toContain('knowledge_db_missing');
    expect(existsSync(join(dir, '.hasna', 'knowledge'))).toBe(false);

    const contextSearch = runCli(['search', 'missing', '--context', '--scope', 'project', '--json'], dir);
    expect(contextSearch.exitCode).toBe(0);
    const contextSearchOut = JSON.parse(new TextDecoder().decode(contextSearch.stdout));
    expect(contextSearchOut.excerpts).toEqual([]);
    expect(contextSearchOut.citations).toEqual([]);
    expect(contextSearchOut.warnings).toContain('knowledge_db_missing');
    expect(existsSync(join(dir, '.hasna', 'knowledge'))).toBe(false);

    const stats = runCli(['stats', '--scope', 'project', '--json'], dir);
    expect(stats.exitCode).toBe(0);
    expect(JSON.parse(new TextDecoder().decode(stats.stdout)).store_exists).toBe(false);
    expect(existsSync(join(dir, '.hasna', 'knowledge'))).toBe(false);

    const dbStats = runCli(['db', 'stats', '--scope', 'project', '--json'], dir);
    expect(dbStats.exitCode).toBe(0);
    expect(JSON.parse(new TextDecoder().decode(dbStats.stdout)).schema_version).toBe(0);
    expect(existsSync(join(dir, '.hasna', 'knowledge'))).toBe(false);

    const panel = runCli(['project-panel', '--project', 'open-knowledge', '--scope', 'project', '--json'], dir);
    expect(panel.exitCode).toBe(0);
    const panelOut = JSON.parse(new TextDecoder().decode(panel.stdout));
    expect(panelOut.schema).toBe('hasna.project_panel.v1');
    expect(normalizeDarwinPath(panelOut.metadata.home)).toBe(expectedProjectKnowledgeHome(dir));
    expect(panelOut.metadata.json_store_exists).toBe(false);
    expect(existsSync(join(dir, '.hasna', 'knowledge'))).toBe(false);

    const syncStatus = runCli(['sync', 'status', '--scope', 'project', '--json'], dir);
    expect(syncStatus.exitCode).toBe(0);
    expect(JSON.parse(new TextDecoder().decode(syncStatus.stdout)).sqlite_schema_version).toBe(0);
    expect(existsSync(join(dir, '.hasna', 'knowledge'))).toBe(false);

    const syncMachines = runCli(['sync', 'machines', '--scope', 'project', '--json'], dir);
    expect(syncMachines.exitCode).toBe(0);
    expect(JSON.parse(new TextDecoder().decode(syncMachines.stdout)).machines).toEqual([]);
    expect(existsSync(join(dir, '.hasna', 'knowledge'))).toBe(false);

    const syncConflicts = runCli(['sync', 'conflicts', '--scope', 'project', '--json'], dir);
    expect(syncConflicts.exitCode).toBe(0);
    expect(JSON.parse(new TextDecoder().decode(syncConflicts.stdout)).conflicts).toEqual([]);
    expect(existsSync(join(dir, '.hasna', 'knowledge'))).toBe(false);

    const add = runCli(['add', 'Project scoped', 'Stored in the app workspace', '--scope', 'project', '--json'], dir);
    expect(add.exitCode).toBe(0);
    expect(existsSync(join(projectKnowledgeHome(dir), 'db.json'))).toBe(true);
    expect(existsSync(join(dir, '.open-knowledge', 'db.json'))).toBe(false);
  }, budget(20000));

  test('source and built read-only sync listing commands do not create workspaces', () => {
    const sourceDir = mkdtempSync(join(tmpdir(), 'ok-sync-readonly-source-'));
    const sourceHome = mkdtempSync(join(tmpdir(), 'ok-sync-readonly-source-home-'));

    for (const args of [
      ['search', 'anything', '--context', '--scope', 'project', '--json'],
      ['sync', 'machines', '--scope', 'project', '--json'],
      ['sync', 'conflicts', '--scope', 'project', '--json'],
      ['sync', 'machines', '--scope', 'global', '--json'],
      ['sync', 'conflicts', '--scope', 'global', '--json'],
    ]) {
      const result = runCli(args, sourceDir, isolatedHomeEnv(sourceHome));
      expect(result.exitCode).toBe(0);
      expect(existsSync(join(sourceDir, '.hasna', 'knowledge'))).toBe(false);
      expect(existsSync(join(sourceHome, '.hasna', 'knowledge'))).toBe(false);
    }

    const builtDir = mkdtempSync(join(tmpdir(), 'ok-sync-readonly-built-'));
    const builtHome = mkdtempSync(join(tmpdir(), 'ok-sync-readonly-built-home-'));
    for (const args of [
      ['search', 'anything', '--context', '--scope', 'project', '--json'],
      ['sync', 'machines', '--scope', 'project', '--json'],
      ['sync', 'conflicts', '--scope', 'project', '--json'],
      ['sync', 'machines', '--scope', 'global', '--json'],
      ['sync', 'conflicts', '--scope', 'global', '--json'],
    ]) {
      const result = runBuiltKnowledgeBin(args, builtDir, isolatedHomeEnv(builtHome));
      expect(result.exitCode).toBe(0);
      expect(existsSync(join(builtDir, '.hasna', 'knowledge'))).toBe(false);
      expect(existsSync(join(builtHome, '.hasna', 'knowledge'))).toBe(false);
    }
  }, budget(20000));

  test('project scope ignores legacy app workspace until explicit migration', () => {
    const dir = mkdtempSync(join(tmpdir(), 'ok-workspace-no-fallback-'));
    const legacyHome = join(dir, '.hasna', 'apps', 'knowledge');
    mkdirSync(legacyHome, { recursive: true });
    writeFileSync(join(legacyHome, 'db.json'), JSON.stringify({
      items: [{
        id: 'k_do_not_read',
        title: 'Legacy app path item',
        content: 'This should not be read through normal project operations.',
        url: null,
        tags: [],
        created_at: '2026-06-28T00:00:00.000Z',
        updated_at: '2026-06-28T00:00:00.000Z',
      }],
    }, null, 2));

    const add = runCli(['add', 'Canonical item', 'Stored in canonical workspace', '--scope', 'project', '--json'], dir);
    expect(add.exitCode).toBe(0);
    expect(existsSync(join(projectKnowledgeHome(dir), 'db.json'))).toBe(true);
    expect(existsSync(join(legacyHome, 'db.json'))).toBe(true);

    const list = runCli(['list', '--scope', 'project', '--json'], dir);
    expect(list.exitCode).toBe(0);
    const out = JSON.parse(new TextDecoder().decode(list.stdout));
    expect(out.total).toBe(1);
    expect(out.items[0].title).toBe('Canonical item');
  });

  test('storage import-legacy dry-run previews without creating canonical store', () => {
    const home = mkdtempSync(join(tmpdir(), 'ok-legacy-dry-run-'));
    const legacyDir = join(home, '.open-knowledge');
    const canonicalPath = join(home, '.hasna', 'knowledge', 'db.json');
    mkdirSync(legacyDir, { recursive: true });
    const legacyPayload = `${JSON.stringify({
      items: [
        {
          id: 'k_legacy_preview',
          short_id: 'legacy_prev',
          title: 'Legacy preview item',
          content: 'Preview only.',
          tags: ['legacy'],
          metadata: {},
          archived: false,
          created_at: '2026-06-08T00:00:00.000Z',
          updated_at: '2026-06-08T00:00:00.000Z',
        },
        {
          title: 'Invalid legacy item without id',
          content: 'This should be reported and skipped.',
        },
      ],
    }, null, 2)}\n`;
    writeFileSync(join(legacyDir, 'db.json'), legacyPayload);

    const preview = runCli(['storage', 'import-legacy', '--dry-run', '--json'], undefined, homeEnv(home));
    expect(preview.exitCode).toBe(0);
    const out = JSON.parse(new TextDecoder().decode(preview.stdout));
    expect(out).toMatchObject({
      ok: true,
      dry_run: true,
      legacy_exists: true,
      canonical_existed: false,
      canonical_created: false,
      would_create_canonical: true,
      imported: 1,
      skipped_existing: 0,
      skipped_invalid: 1,
    });
    expect(out.backup_path).toBeNull();
    expect(out.report_path).toBeNull();
    expect(existsSync(canonicalPath)).toBe(false);
    expect(readFileSync(join(legacyDir, 'db.json'), 'utf8')).toBe(legacyPayload);
  });

  test('storage import-legacy rejects project scope without touching global store', () => {
    const home = mkdtempSync(join(tmpdir(), 'ok-legacy-scope-home-'));
    const dir = mkdtempSync(join(tmpdir(), 'ok-legacy-scope-project-'));
    const rejected = runCli(['storage', 'import-legacy', '--scope', 'project', '--json'], dir, homeEnv(home));
    expect(rejected.exitCode).toBe(1);
    expect(new TextDecoder().decode(rejected.stderr)).toContain('only supports --scope global');
    expect(existsSync(join(home, '.hasna', 'knowledge', 'db.json'))).toBe(false);
    expect(existsSync(join(dir, '.hasna', 'knowledge'))).toBe(false);
  });

  test('storage import-legacy merges into existing canonical store safely', () => {
    const home = mkdtempSync(join(tmpdir(), 'ok-legacy-merge-'));
    const legacyDir = join(home, '.open-knowledge');
    const canonicalDir = join(home, '.hasna', 'knowledge');
    const legacyPath = join(legacyDir, 'db.json');
    const canonicalPath = join(canonicalDir, 'db.json');
    mkdirSync(legacyDir, { recursive: true });
    mkdirSync(canonicalDir, { recursive: true });

    const legacyPayload = `${JSON.stringify({
      items: [
        {
          id: 'k_legacy_only',
          short_id: 'legacy_only',
          title: 'Legacy only item',
          content: 'This item should be imported.',
          tags: ['legacy'],
          metadata: {},
          archived: false,
          created_at: '2026-06-08T00:00:00.000Z',
          updated_at: '2026-06-08T00:00:00.000Z',
        },
        {
          id: 'k_conflict',
          short_id: 'conflict',
          title: 'Legacy conflict title',
          content: 'This must not overwrite canonical data.',
          tags: ['legacy'],
          metadata: {},
          archived: false,
          created_at: '2026-06-08T00:00:00.000Z',
          updated_at: '2026-06-08T00:00:00.000Z',
        },
      ],
    }, null, 2)}\n`;
    writeFileSync(legacyPath, legacyPayload);
    writeFileSync(canonicalPath, `${JSON.stringify({
      items: [
        {
          id: 'k_canonical_only',
          short_id: 'canonical_o',
          title: 'Canonical only item',
          content: 'Already canonical.',
          tags: ['canonical'],
          metadata: {},
          archived: false,
          created_at: '2026-06-09T00:00:00.000Z',
          updated_at: '2026-06-09T00:00:00.000Z',
        },
        {
          id: 'k_conflict',
          short_id: 'conflict',
          title: 'Canonical conflict title',
          content: 'Canonical data wins.',
          tags: ['canonical'],
          metadata: {},
          archived: false,
          created_at: '2026-06-09T00:00:00.000Z',
          updated_at: '2026-06-09T00:00:00.000Z',
        },
      ],
    }, null, 2)}\n`);

    const imported = runCli(['storage', 'import-legacy', '--json'], undefined, homeEnv(home));
    expect(imported.exitCode).toBe(0);
    const importOut = JSON.parse(new TextDecoder().decode(imported.stdout));
    expect(importOut).toMatchObject({
      ok: true,
      dry_run: false,
      legacy_exists: true,
      canonical_existed: true,
      canonical_created: false,
      imported: 1,
      skipped_existing: 1,
    });
    expect(importOut.backup_path).toBeString();
    expect(importOut.report_path).toBeString();
    expect(existsSync(importOut.backup_path)).toBe(true);
    expect(existsSync(importOut.report_path)).toBe(true);

    const merged = JSON.parse(readFileSync(canonicalPath, 'utf8'));
    expect(merged.items).toHaveLength(3);
    expect(merged.items.find((item: any) => item.id === 'k_legacy_only')?.title).toBe('Legacy only item');
    expect(merged.items.find((item: any) => item.id === 'k_conflict')?.title).toBe('Canonical conflict title');
    expect(JSON.parse(readFileSync(importOut.backup_path, 'utf8')).items).toHaveLength(2);
    expect(JSON.parse(readFileSync(importOut.report_path, 'utf8')).imported).toBe(1);
    expect(readFileSync(legacyPath, 'utf8')).toBe(legacyPayload);

    const second = runCli(['storage', 'import-legacy', '--json'], undefined, homeEnv(home));
    expect(second.exitCode).toBe(0);
    const secondOut = JSON.parse(new TextDecoder().decode(second.stdout));
    expect(secondOut).toMatchObject({
      ok: true,
      imported: 0,
      skipped_existing: 2,
      backup_path: null,
      report_path: null,
    });
    expect(JSON.parse(readFileSync(canonicalPath, 'utf8')).items).toHaveLength(3);
    expect(readFileSync(legacyPath, 'utf8')).toBe(legacyPayload);
  });

  test('storage import-legacy can run while caller holds canonical store lock', () => {
    const home = mkdtempSync(join(tmpdir(), 'ok-legacy-reentrant-'));
    const legacyDir = join(home, '.open-knowledge');
    const canonicalDir = join(home, '.hasna', 'knowledge');
    const canonicalPath = join(canonicalDir, 'db.json');
    mkdirSync(legacyDir, { recursive: true });
    mkdirSync(canonicalDir, { recursive: true });
    writeFileSync(join(legacyDir, 'db.json'), `${JSON.stringify({
      items: [{
        id: 'k_legacy_reentrant',
        short_id: 'legacy_reent',
        title: 'Legacy item imported under lock',
        content: 'The import should reuse the held process lock.',
        tags: ['legacy'],
        metadata: {},
        archived: false,
        created_at: '2026-06-08T00:00:00.000Z',
        updated_at: '2026-06-08T00:00:00.000Z',
      }],
    }, null, 2)}\n`);
    writeFileSync(canonicalPath, `${JSON.stringify({ items: [] }, null, 2)}\n`);

    const script = `
      import { importLegacyGlobalStore, withLock } from ${JSON.stringify(pathToFileURL(join(__dirname, '..', 'src', 'store.ts')).href)};
      const canonicalPath = ${JSON.stringify(canonicalPath)};
      let result;
      withLock(canonicalPath, () => {
        result = importLegacyGlobalStore();
      });
      console.log(JSON.stringify(result));
    `;
    const child = Bun.spawnSync(['bun', '-e', script], {
      env: childEnv(homeEnv(home)),
      stdout: 'pipe',
      stderr: 'pipe',
    });
    expect(child.exitCode).toBe(0);
    const importOut = JSON.parse(new TextDecoder().decode(child.stdout));
    expect(importOut).toMatchObject({
      ok: true,
      imported: 1,
      skipped_existing: 0,
    });

    const merged = JSON.parse(readFileSync(canonicalPath, 'utf8'));
    expect(merged.items.map((item: any) => item.id)).toContain('k_legacy_reentrant');
  });

  test('storage validation reports forbidden workspace env and backup artifacts without reading values', () => {
    const dir = mkdtempSync(join(tmpdir(), 'ok-forbidden-cloud-env-'));
    const knowledgeHome = projectKnowledgeHome(dir);
    mkdirSync(join(knowledgeHome, 'migration-exports'), { recursive: true });
    writeFileSync(join(knowledgeHome, 'cloud.env'), 'HASNA_KNOWLEDGE_DATABASE_URL=not-a-real-secret\n');
    writeFileSync(join(knowledgeHome, 'knowledge.db.pre-cloud-2026-07-06.bak'), '');

    const validate = runCli(['storage', 'validate', '--scope', 'project', '--json'], dir);
    expect(validate.exitCode).toBe(1);
    const out = JSON.parse(new TextDecoder().decode(validate.stdout));
    expect(out.ok).toBe(false);
    expect(out.validation.errors.join('\n')).toContain('cloud.env');
    expect(out.validation.errors.join('\n')).toContain('migration-exports');
    expect(out.validation.errors.join('\n')).toContain('knowledge.db.pre-cloud-2026-07-06.bak');
    expect(JSON.stringify(out)).not.toContain('not-a-real-secret');
  });

  test('source ingestion rejects private Knowledge workspace file refs before reading', () => {
    const dir = mkdtempSync(join(tmpdir(), 'ok-private-source-ref-'));
    const ingest = runCli(['ingest', 'source', 'file:///home/hasna/.hasna/knowledge/knowledge.db', '--scope', 'project', '--json'], dir);
    expect(ingest.exitCode).toBe(1);
    expect(new TextDecoder().decode(ingest.stderr)).toContain('private-ref lint failed');
  });

  test('storage migration safely moves legacy app workspace to canonical knowledge path', () => {
    const dir = mkdtempSync(join(tmpdir(), 'ok-workspace-migrate-'));
    const home = mkdtempSync(join(tmpdir(), 'ok-workspace-migrate-home-'));
    const legacyHome = join(dir, '.hasna', 'apps', 'knowledge');
    const currentHome = projectKnowledgeHome(dir, home);
    mkdirSync(join(legacyHome, 'artifacts'), { recursive: true });
    writeFileSync(join(legacyHome, 'db.json'), JSON.stringify({
      items: [{
        id: 'k_legacy_path',
        title: 'Legacy path item',
        content: 'migrate me',
        url: null,
        tags: [],
        created_at: '2026-06-28T00:00:00.000Z',
        updated_at: '2026-06-28T00:00:00.000Z',
      }],
    }, null, 2));
    writeFileSync(join(legacyHome, 'artifacts', 'wiki.md'), '# Migrated artifact\n');
    migrateKnowledgeDb(join(legacyHome, 'knowledge.db'));

    const preview = runCli(['storage', 'migrate-legacy-path', '--scope', 'project', '--json'], dir, isolatedHomeEnv(home));
    expect(preview.exitCode).toBe(0);
    const previewOut = JSON.parse(new TextDecoder().decode(preview.stdout));
    expect(previewOut.dry_run).toBe(true);
    expect(previewOut.approval_required).toBe(true);
    expect(previewOut.legacy_before.json_items).toBe(1);
    expect(previewOut.legacy_before.sqlite.integrity_check).toBe('ok');
    expect(existsSync(currentHome)).toBe(false);

    const applied = runCli([
      'storage',
      'migrate-legacy-path',
      '--scope',
      'project',
      '--approve-write',
      '--approved-by',
      'cli-test',
      '--json',
    ], dir, isolatedHomeEnv(home));
    if (applied.exitCode !== 0) {
      throw new Error([
        `migrate-legacy-path failed with exit code ${applied.exitCode}`,
        `stdout: ${new TextDecoder().decode(applied.stdout)}`,
        `stderr: ${new TextDecoder().decode(applied.stderr)}`,
      ].join('\n'));
    }
    const appliedOut = JSON.parse(new TextDecoder().decode(applied.stdout));
    expect(appliedOut.ok).toBe(true);
    expect(appliedOut.dry_run).toBe(false);
    expect(appliedOut.checks).toMatchObject({
      backup_matches_legacy: true,
      migrated_matches_backup: true,
      tombstone_written: true,
    });
    expect(appliedOut.backup_after.path).toBe(appliedOut.backup_home);
    expect(appliedOut.backup_after.json_items).toBe(1);
    expect(appliedOut.backup_after.sqlite.integrity_check).toBe('ok');
    expect(appliedOut.backup_after.artifacts.file_count).toBe(1);
    expectSameExistingPath(appliedOut.current_home, currentHome);
    expect(existsSync(join(currentHome, 'db.json'))).toBe(true);
    expect(existsSync(join(currentHome, 'knowledge.db'))).toBe(true);
    expect(existsSync(join(currentHome, 'artifacts', 'wiki.md'))).toBe(true);
    expect(existsSync(join(legacyHome, 'TOMBSTONE.md'))).toBe(true);
    expect(existsSync(join(legacyHome, 'db.json'))).toBe(false);
    expect(existsSync(join(appliedOut.backup_home, 'db.json'))).toBe(true);

    const paths = runCli(['paths', '--scope', 'project', '--json'], dir, isolatedHomeEnv(home));
    const pathsOut = JSON.parse(new TextDecoder().decode(paths.stdout));
    expectSameExistingPath(pathsOut.home, currentHome);

    const rerun = runCli(['storage', 'migrate-legacy-path', '--scope', 'project', '--json'], dir, isolatedHomeEnv(home));
    expect(rerun.exitCode).toBe(0);
    const rerunOut = JSON.parse(new TextDecoder().decode(rerun.stdout));
    expect(rerunOut.ok).toBe(true);
    expect(rerunOut.approval_required).toBe(false);
    expect(rerunOut.checks.legacy_is_tombstone).toBe(true);
    expect(rerunOut.message).toContain('already migrated');
  });

  test('storage migration refuses to overwrite populated canonical workspace', () => {
    const dir = mkdtempSync(join(tmpdir(), 'ok-workspace-migrate-refuse-'));
    const home = mkdtempSync(join(tmpdir(), 'ok-workspace-migrate-refuse-home-'));
    const legacyHome = join(dir, '.hasna', 'apps', 'knowledge');
    const currentHome = projectKnowledgeHome(dir, home);
    mkdirSync(legacyHome, { recursive: true });
    mkdirSync(currentHome, { recursive: true });
    writeFileSync(join(legacyHome, 'db.json'), JSON.stringify({
      items: [{
        id: 'k_legacy_path',
        title: 'Legacy path item',
        content: 'legacy',
        url: null,
        tags: [],
        created_at: '2026-06-28T00:00:00.000Z',
        updated_at: '2026-06-28T00:00:00.000Z',
      }],
    }, null, 2));
    writeFileSync(join(currentHome, 'db.json'), JSON.stringify({
      items: [{
        id: 'k_current_path',
        title: 'Current path item',
        content: 'current',
        url: null,
        tags: [],
        created_at: '2026-06-28T00:00:00.000Z',
        updated_at: '2026-06-28T00:00:00.000Z',
      }],
    }, null, 2));

    const result = runCli([
      'storage',
      'migrate-legacy-path',
      '--scope',
      'project',
      '--approve-write',
      '--approved-by',
      'cli-test',
      '--json',
    ], dir, isolatedHomeEnv(home));
    expect(result.exitCode).toBe(0);
    const out = JSON.parse(new TextDecoder().decode(result.stdout));
    expect(out.ok).toBe(false);
    expect(out.warnings).toContain('current_workspace_contains_data');
    expect(existsSync(join(legacyHome, 'db.json'))).toBe(true);
    expect(existsSync(join(currentHome, 'db.json'))).toBe(true);
    expect(existsSync(join(legacyHome, 'TOMBSTONE.md'))).toBe(false);
  });

  test('storage migrate-project-path moves the previous cwd-relative project workspace into the canonical project home', () => {
    const dir = mkdtempSync(join(tmpdir(), 'ok-project-path-migrate-'));
    const home = mkdtempSync(join(tmpdir(), 'ok-project-path-migrate-home-'));
    const previousHome = join(dir, '.hasna', 'knowledge');
    const canonicalHome = projectKnowledgeHome(dir, home);
    mkdirSync(join(previousHome, 'artifacts'), { recursive: true });
    writeFileSync(join(previousHome, 'db.json'), JSON.stringify({
      items: [{
        id: 'k_previous_project',
        title: 'Previous project store item',
        content: 'migrate to canonical project home',
        url: null,
        tags: [],
        created_at: '2026-06-28T00:00:00.000Z',
        updated_at: '2026-06-28T00:00:00.000Z',
      }],
    }, null, 2));
    writeFileSync(join(previousHome, 'artifacts', 'wiki.md'), '# Project artifact\n');

    const preview = runCli(['storage', 'migrate-project-path', '--scope', 'project', '--json'], dir, isolatedHomeEnv(home));
    expect(preview.exitCode).toBe(0);
    const previewOut = JSON.parse(new TextDecoder().decode(preview.stdout));
    expect(previewOut.dry_run).toBe(true);
    expect(previewOut.approval_required).toBe(true);
    expect(previewOut.legacy_before.json_items).toBe(1);
    expect(existsSync(canonicalHome)).toBe(false);

    const applied = runCli([
      'storage',
      'migrate-project-path',
      '--scope',
      'project',
      '--approve-write',
      '--approved-by',
      'cli-test',
      '--json',
    ], dir, isolatedHomeEnv(home));
    expect(applied.exitCode).toBe(0);
    const appliedOut = JSON.parse(new TextDecoder().decode(applied.stdout));
    expect(appliedOut.ok).toBe(true);
    expect(appliedOut.dry_run).toBe(false);
    expect(appliedOut.checks).toMatchObject({
      backup_matches_legacy: true,
      migrated_matches_backup: true,
      tombstone_written: true,
    });
    expectSameExistingPath(appliedOut.current_home, canonicalHome);
    expect(existsSync(join(canonicalHome, 'db.json'))).toBe(true);
    expect(existsSync(join(canonicalHome, 'artifacts', 'wiki.md'))).toBe(true);
    expect(existsSync(join(previousHome, 'TOMBSTONE.md'))).toBe(true);
    expect(existsSync(join(previousHome, 'db.json'))).toBe(false);
    expect(existsSync(join(appliedOut.backup_home, 'db.json'))).toBe(true);

    const rerun = runCli(['storage', 'migrate-project-path', '--scope', 'project', '--json'], dir, isolatedHomeEnv(home));
    expect(rerun.exitCode).toBe(0);
    const rerunOut = JSON.parse(new TextDecoder().decode(rerun.stdout));
    expect(rerunOut.ok).toBe(true);
    expect(rerunOut.approval_required).toBe(false);
    expect(rerunOut.checks.legacy_is_tombstone).toBe(true);
  });

  test('storage migrate-project-path refuses when the canonical project home already contains data', () => {
    const dir = mkdtempSync(join(tmpdir(), 'ok-project-path-migrate-refuse-'));
    const home = mkdtempSync(join(tmpdir(), 'ok-project-path-migrate-refuse-home-'));
    const previousHome = join(dir, '.hasna', 'knowledge');
    const canonicalHome = projectKnowledgeHome(dir, home);
    mkdirSync(previousHome, { recursive: true });
    mkdirSync(canonicalHome, { recursive: true });
    writeFileSync(join(previousHome, 'db.json'), JSON.stringify({
      items: [{
        id: 'k_previous_project',
        title: 'Previous project store item',
        content: 'legacy',
        url: null,
        tags: [],
        created_at: '2026-06-28T00:00:00.000Z',
        updated_at: '2026-06-28T00:00:00.000Z',
      }],
    }, null, 2));
    writeFileSync(join(canonicalHome, 'db.json'), JSON.stringify({
      items: [{
        id: 'k_canonical_project',
        title: 'Canonical project store item',
        content: 'canonical',
        url: null,
        tags: [],
        created_at: '2026-06-28T00:00:00.000Z',
        updated_at: '2026-06-28T00:00:00.000Z',
      }],
    }, null, 2));

    const result = runCli([
      'storage',
      'migrate-project-path',
      '--scope',
      'project',
      '--approve-write',
      '--approved-by',
      'cli-test',
      '--json',
    ], dir, isolatedHomeEnv(home));
    expect(result.exitCode).toBe(0);
    const out = JSON.parse(new TextDecoder().decode(result.stdout));
    expect(out.ok).toBe(false);
    expect(out.warnings).toContain('current_workspace_contains_data');
    expect(existsSync(join(previousHome, 'db.json'))).toBe(true);
    expect(existsSync(join(canonicalHome, 'db.json'))).toBe(true);
    expect(existsSync(join(previousHome, 'TOMBSTONE.md'))).toBe(false);
  });

  test('storage merge safely imports legacy app-folder items into populated canonical store', () => {
    const dir = mkdtempSync(join(tmpdir(), 'ok-workspace-merge-'));
    const home = mkdtempSync(join(tmpdir(), 'ok-workspace-merge-home-'));
    const legacyHome = join(dir, '.hasna', 'apps', 'knowledge');
    const currentHome = projectKnowledgeHome(dir, home);
    mkdirSync(legacyHome, { recursive: true });
    mkdirSync(currentHome, { recursive: true });
    writeFileSync(join(legacyHome, 'db.json'), JSON.stringify({
      items: [
        {
          id: 'k_duplicate',
          title: 'Duplicate item',
          content: 'same payload',
          url: null,
          tags: ['shared'],
          metadata: { source: 'legacy' },
          archived: false,
          created_at: '2026-06-28T00:00:00.000Z',
          updated_at: '2026-06-28T00:00:00.000Z',
        },
        {
          id: 'k_stranded',
          short_id: 'stranded',
          title: 'Stranded item',
          content: 'preserve this exact object',
          url: 'https://example.com/stranded',
          tags: ['legacy'],
          metadata: { source: 'legacy', nested: { value: true } },
          archived: true,
          created_at: '2026-06-27T00:00:00.000Z',
          updated_at: '2026-06-27T00:01:00.000Z',
        },
      ],
    }, null, 2));
    writeFileSync(join(currentHome, 'db.json'), JSON.stringify({
      items: [
        {
          id: 'k_current',
          title: 'Current item',
          content: 'current payload',
          url: null,
          tags: [],
          created_at: '2026-06-29T00:00:00.000Z',
          updated_at: '2026-06-29T00:00:00.000Z',
        },
        {
          id: 'k_duplicate',
          title: 'Duplicate item',
          content: 'same payload',
          url: null,
          tags: ['shared'],
          metadata: { source: 'legacy' },
          archived: false,
          created_at: '2026-06-28T00:00:00.000Z',
          updated_at: '2026-06-28T00:00:00.000Z',
        },
      ],
    }, null, 2));

    const preview = runCli(['storage', 'merge-legacy-path', '--scope', 'project', '--json'], dir, isolatedHomeEnv(home));
    expect(preview.exitCode).toBe(0);
    const previewOut = JSON.parse(new TextDecoder().decode(preview.stdout));
    expect(previewOut.dry_run).toBe(true);
    expect(previewOut.approval_required).toBe(true);
    expect(previewOut.merge).toMatchObject({
      current_items: 2,
      legacy_items: 2,
      duplicate_ids_identical: 1,
      stranded_items: 1,
      expected_total_items: 3,
    });
    expect(previewOut.conflicts).toEqual([]);

    const applied = runCli([
      'storage',
      'merge-legacy-path',
      '--scope',
      'project',
      '--approve-write',
      '--approved-by',
      'cli-test',
      '--json',
    ], dir, isolatedHomeEnv(home));
    expect(applied.exitCode).toBe(0);
    const appliedOut = JSON.parse(new TextDecoder().decode(applied.stdout));
    expect(appliedOut.ok).toBe(true);
    expect(appliedOut.dry_run).toBe(false);
    expect(appliedOut.merge).toMatchObject({
      merged_items: 1,
      expected_total_items: 3,
      final_items: 3,
    });
    expect(appliedOut.checks).toMatchObject({
      legacy_backup_written: true,
      no_conflicts: true,
      final_count_matches_expected: true,
    });
    expect(existsSync(join(appliedOut.backup_home, 'db.json'))).toBe(true);

    const merged = JSON.parse(readFileSync(join(currentHome, 'db.json'), 'utf8')) as {
      items: Array<{ id: string; archived?: boolean; metadata?: Record<string, unknown> }>;
    };
    expect(merged.items.map((item) => item.id).sort()).toEqual(['k_current', 'k_duplicate', 'k_stranded']);
    expect(merged.items.find((item) => item.id === 'k_stranded')).toMatchObject({
      archived: true,
      metadata: { source: 'legacy', nested: { value: true } },
    });

    const rerun = runCli([
      'storage',
      'merge-legacy-path',
      '--scope',
      'project',
      '--approve-write',
      '--approved-by',
      'cli-test',
      '--json',
    ], dir, isolatedHomeEnv(home));
    expect(rerun.exitCode).toBe(0);
    const rerunOut = JSON.parse(new TextDecoder().decode(rerun.stdout));
    expect(rerunOut.merge).toMatchObject({
      stranded_items: 0,
      merged_items: 0,
      final_items: 3,
    });
  });

  test('storage merge refuses conflicting duplicate IDs', () => {
    const dir = mkdtempSync(join(tmpdir(), 'ok-workspace-merge-conflict-'));
    const home = mkdtempSync(join(tmpdir(), 'ok-workspace-merge-conflict-home-'));
    const legacyHome = join(dir, '.hasna', 'apps', 'knowledge');
    const currentHome = projectKnowledgeHome(dir, home);
    mkdirSync(legacyHome, { recursive: true });
    mkdirSync(currentHome, { recursive: true });
    const baseItem = {
      id: 'k_conflict',
      title: 'Conflict item',
      url: null,
      tags: [],
      created_at: '2026-06-28T00:00:00.000Z',
      updated_at: '2026-06-28T00:00:00.000Z',
    };
    writeFileSync(join(legacyHome, 'db.json'), JSON.stringify({
      items: [{ ...baseItem, content: 'legacy content' }],
    }, null, 2));
    writeFileSync(join(currentHome, 'db.json'), JSON.stringify({
      items: [{ ...baseItem, content: 'current content' }],
    }, null, 2));

    const result = runCli([
      'storage',
      'merge-legacy-path',
      '--scope',
      'project',
      '--approve-write',
      '--approved-by',
      'cli-test',
      '--json',
    ], dir, isolatedHomeEnv(home));
    expect(result.exitCode).toBe(0);
    const out = JSON.parse(new TextDecoder().decode(result.stdout));
    expect(out.ok).toBe(false);
    expect(out.dry_run).toBe(true);
    expect(out.merge.duplicate_ids_conflicting).toBe(1);
    expect(out.conflicts).toEqual([expect.objectContaining({ type: 'id_conflict', id: 'k_conflict' })]);
    expect(existsSync(join(currentHome, 'db.json'))).toBe(true);
    expect(existsSync(join(legacyHome, 'db.json'))).toBe(true);
  });

  test('storage merge refuses id and short_id namespace collisions', () => {
    const dir = mkdtempSync(join(tmpdir(), 'ok-workspace-merge-namespace-conflict-'));
    const home = mkdtempSync(join(tmpdir(), 'ok-workspace-merge-namespace-home-'));
    const legacyHome = join(dir, '.hasna', 'apps', 'knowledge');
    const currentHome = projectKnowledgeHome(dir, home);
    mkdirSync(legacyHome, { recursive: true });
    mkdirSync(currentHome, { recursive: true });
    writeFileSync(join(currentHome, 'db.json'), JSON.stringify({
      items: [
        {
          id: 'k_current_short_owner',
          short_id: 'legacy_id_hits_current_short',
          title: 'Current short owner',
          content: 'current',
          url: null,
          tags: [],
          created_at: '2026-06-28T00:00:00.000Z',
          updated_at: '2026-06-28T00:00:00.000Z',
        },
        {
          id: 'current_id_hits_legacy_short',
          title: 'Current id owner',
          content: 'current',
          url: null,
          tags: [],
          created_at: '2026-06-28T00:00:00.000Z',
          updated_at: '2026-06-28T00:00:00.000Z',
        },
      ],
    }, null, 2));
    writeFileSync(join(legacyHome, 'db.json'), JSON.stringify({
      items: [
        {
          id: 'legacy_id_hits_current_short',
          title: 'Legacy id collision',
          content: 'legacy',
          url: null,
          tags: [],
          created_at: '2026-06-28T00:00:00.000Z',
          updated_at: '2026-06-28T00:00:00.000Z',
        },
        {
          id: 'k_legacy_short_owner',
          short_id: 'current_id_hits_legacy_short',
          title: 'Legacy short collision',
          content: 'legacy',
          url: null,
          tags: [],
          created_at: '2026-06-28T00:00:00.000Z',
          updated_at: '2026-06-28T00:00:00.000Z',
        },
      ],
    }, null, 2));

    const result = runCli(['storage', 'merge-legacy-path', '--scope', 'project', '--json'], dir, isolatedHomeEnv(home));
    expect(result.exitCode).toBe(0);
    const out = JSON.parse(new TextDecoder().decode(result.stdout));
    expect(out.ok).toBe(false);
    expect(out.merge.short_id_conflicts).toBe(2);
    expect(out.conflicts).toEqual([
      expect.objectContaining({ type: 'short_id_conflict', id: 'legacy_id_hits_current_short' }),
      expect.objectContaining({ type: 'short_id_conflict', id: 'current_id_hits_legacy_short' }),
    ]);
  });

  test('storage merge refuses duplicate lookup keys inside legacy store', () => {
    const dir = mkdtempSync(join(tmpdir(), 'ok-workspace-merge-legacy-duplicates-'));
    const home = mkdtempSync(join(tmpdir(), 'ok-workspace-merge-legacy-dupes-home-'));
    const legacyHome = join(dir, '.hasna', 'apps', 'knowledge');
    const currentHome = projectKnowledgeHome(dir, home);
    mkdirSync(legacyHome, { recursive: true });
    mkdirSync(currentHome, { recursive: true });
    writeFileSync(join(currentHome, 'db.json'), JSON.stringify({ items: [] }, null, 2));
    writeFileSync(join(legacyHome, 'db.json'), JSON.stringify({
      items: [
        {
          id: 'k_duplicate_legacy',
          title: 'Legacy first duplicate id',
          content: 'legacy',
          url: null,
          tags: [],
          created_at: '2026-06-28T00:00:00.000Z',
          updated_at: '2026-06-28T00:00:00.000Z',
        },
        {
          id: 'k_duplicate_legacy',
          title: 'Legacy second duplicate id',
          content: 'legacy changed',
          url: null,
          tags: [],
          created_at: '2026-06-28T00:00:00.000Z',
          updated_at: '2026-06-28T00:00:00.000Z',
        },
        {
          id: 'k_legacy_short_a',
          short_id: 'shared_short',
          title: 'Legacy first duplicate short',
          content: 'legacy',
          url: null,
          tags: [],
          created_at: '2026-06-28T00:00:00.000Z',
          updated_at: '2026-06-28T00:00:00.000Z',
        },
        {
          id: 'k_legacy_short_b',
          short_id: 'shared_short',
          title: 'Legacy second duplicate short',
          content: 'legacy',
          url: null,
          tags: [],
          created_at: '2026-06-28T00:00:00.000Z',
          updated_at: '2026-06-28T00:00:00.000Z',
        },
      ],
    }, null, 2));

    const result = runCli(['storage', 'merge-legacy-path', '--scope', 'project', '--json'], dir, isolatedHomeEnv(home));
    expect(result.exitCode).toBe(0);
    const out = JSON.parse(new TextDecoder().decode(result.stdout));
    expect(out.ok).toBe(false);
    expect(out.merge.duplicate_ids_conflicting).toBe(1);
    expect(out.merge.short_id_conflicts).toBe(1);
    expect(out.conflicts).toEqual([
      expect.objectContaining({ type: 'id_conflict', id: 'k_duplicate_legacy' }),
      expect.objectContaining({ type: 'short_id_conflict', id: 'shared_short' }),
    ]);
  });

  test('default status/path terminal output is compact with detail hints', () => {
    const dir = mkdtempSync(join(tmpdir(), 'ok-compact-status-'));

    const paths = runCli(['paths', '--scope', 'project'], dir);
    expect(paths.exitCode).toBe(0);
    const pathsOut = new TextDecoder().decode(paths.stdout);
    expect(pathsOut).toContain('Knowledge paths (project)');
    expect(pathsOut).toContain('Hint: use --verbose');
    expect(pathsOut).not.toContain('"config"');

    const sync = runCli(['sync', 'status', '--scope', 'project'], dir);
    expect(sync.exitCode).toBe(0);
    const syncOut = new TextDecoder().decode(sync.stdout);
    expect(syncOut).toContain('Sync status (project)');
    expect(syncOut).toContain('Machines: 0');
    expect(syncOut).toContain('Hint: use --verbose');
    expect(syncOut.trim().startsWith('{')).toBe(false);

    const verbose = runCli(['sync', 'status', '--scope', 'project', '--verbose'], dir);
    expect(verbose.exitCode).toBe(0);
    const verboseOut = new TextDecoder().decode(verbose.stdout);
    expect(verboseOut.trim().startsWith('{')).toBe(true);
    expect(verboseOut).toContain('"machines"');
  });

  test('machines topology command exposes adapter-aware topology shape', () => {
    const dir = mkdtempSync(join(tmpdir(), 'ok-machines-cli-'));
    const home = mkdtempSync(join(tmpdir(), 'ok-machines-cli-home-'));

    const result = runCli(
      ['machines', 'topology', '--scope', 'project', '--no-tailscale', '--json'],
      dir,
      isolatedHomeEnv(home),
    );
    expect(result.exitCode).toBe(0);
    const out = JSON.parse(new TextDecoder().decode(result.stdout));
    expect(out.ok).toBe(true);
    expect(['local', 'open-machines']).toContain(out.source);
    expect(out.adapter.package).toBe('@hasna/machines');
    expect(typeof out.adapter.available).toBe('boolean');
    expect(out.knowledge.app_path).toBe(join('.hasna', 'knowledge'));
    expect(normalizeDarwinPath(out.knowledge.workspace_home)).toBe(expectedProjectKnowledgeHome(dir, home));
    expect(existsSync(join(dir, '.hasna', 'knowledge'))).toBe(false);
    expect(out.machines.length).toBeGreaterThanOrEqual(1);
    expect(out.machines.some((machine: any) => machine.local)).toBe(true);

    const compact = runCli(['machines', 'topology', '--scope', 'project', '--no-tailscale'], dir);
    expect(compact.exitCode).toBe(0);
    const compactOut = new TextDecoder().decode(compact.stdout);
    expect(compactOut).toContain('machine(s) discovered');
    expect(compactOut).toContain('Hint: use --verbose');
    expect(compactOut.trim().startsWith('{')).toBe(false);
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
      { PATH: pathWithBin(bin) },
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
    writeFakeMachinesRouteBin(bin, 'doctor-linux-node-a.tailnet.test', '/remote/open-knowledge', true);

    const result = runCli(['sync', 'doctor', '--machine', 'linux-node-a', '--scope', 'project', '--json'], dir, {
      PATH: pathWithBin(bin),
    });

    expect(result.exitCode).toBe(0);
    const out = JSON.parse(new TextDecoder().decode(result.stdout));
    expect(out.package.name).toBe('@hasna/knowledge');
    expect(out.read_only).toBe(true);
    expect(out.resolved_route).toMatchObject({
      target: 'doctor-linux-node-a.tailnet.test',
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
        modified_at: '2026-06-09T00:00:00.000Z',
        metadata: { provenance: { generated_from: 'test', artifact_key: 'wiki/README.md' } },
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
      modified_time: {
        with_modified_at: 1,
        missing_modified_at: 0,
        invalid_modified_at: 0,
      },
      provenance: {
        with_provenance: 1,
        missing_provenance: 0,
        with_artifact_key: 1,
        missing_artifact_key: 0,
        artifact_key_mismatches: 0,
        generated_from: [{ value: 'test', count: 1 }],
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
        tracks_modified_time: true,
        preserves_provenance: true,
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
          artifact_modified_at: 'not-a-date',
          provenance: { generated_from: 'legacy-s3', artifact_key: 'wiki/not-legacy.md' },
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
      modified_time: {
        with_modified_at: 0,
        invalid_modified_at: 1,
      },
      provenance: {
        with_provenance: 1,
        artifact_key_mismatches: 1,
      },
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
    expect(out.storage.artifact_manifest.warnings).toContain('artifact_manifest_invalid_modified_at:1');
    expect(out.storage.artifact_manifest.warnings).toContain('artifact_manifest_provenance_key_mismatch:1');
    expect(out.storage.artifact_manifest.warnings).toContain('artifact_manifest_raw_payload_sentinels:1');
    expect(out.warnings).toContain('artifact_manifest_s3_key_contains_storage_prefix:1');
    expect(out.warnings).toContain('artifact_manifest_raw_payload_sentinels:1');
  });

  test('storage repair-artifact-keys previews and repairs legacy S3 keys with approval', () => {
    const dir = mkdtempSync(join(tmpdir(), 'ok-storage-repair-s3-'));
    const service = createKnowledgeService({ scope: 'project', cwd: dir });
    const workspace = service.ensureWorkspace();
    const config = defaultKnowledgeConfig();
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
        modified_at: '2026-06-09T00:00:00.000Z',
        metadata: { provenance: { generated_from: 'legacy-s3', artifact_key: 'wiki/legacy.md' } },
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

  test('global list does not migrate legacy .open-knowledge data on read', () => {
    const home = mkdtempSync(join(tmpdir(), 'ok-legacy-home-'));
    const legacyDir = join(home, '.open-knowledge');
    mkdirSync(legacyDir, { recursive: true });
    writeFileSync(join(legacyDir, 'db.json'), `${JSON.stringify({
      items: [{
        id: 'k_legacy_contract',
        short_id: 'legacy_contr',
        title: 'Legacy global item',
        content: 'Migrated into the app workspace.',
        tags: ['legacy'],
        metadata: {},
        archived: false,
        created_at: '2026-06-08T00:00:00.000Z',
        updated_at: '2026-06-08T00:00:00.000Z',
      }],
    }, null, 2)}\n`);

    const list = runCli(['list', '--json'], undefined, isolatedHomeEnv(home));
    expect(list.exitCode).toBe(0);
    const listOut = JSON.parse(new TextDecoder().decode(list.stdout));
    expect(listOut.total).toBe(0);
    expect(listOut.store_exists).toBe(false);
    expect(existsSync(join(home, '.hasna', 'knowledge', 'db.json'))).toBe(false);
  });

  test('setup and auth commands keep client transport out of workspace config', () => {
    const dir = mkdtempSync(join(tmpdir(), 'ok-hosted-cli-'));
    const authDir = join(dir, 'auth');
    const env = { HASNA_KNOWLEDGE_AUTH_DIR: authDir };

    const setup = runCli(['setup', '--scope', 'project', '--json'], dir, env);
    expect(setup.exitCode).toBe(0);
    const setupOut = JSON.parse(new TextDecoder().decode(setup.stdout));
    expect(setupOut.mode).toBeUndefined();
    expect(setupOut.api_url).toBeUndefined();
    expect(setupOut.storage_type).toBe('local');

    const storage = runCli(['storage', 'status', '--scope', 'project', '--json'], dir, env);
    expect(storage.exitCode).toBe(0);
    const storageOut = JSON.parse(new TextDecoder().decode(storage.stdout));
    expect(storageOut.hosted).toBeUndefined();
    expect(storageOut.canonical_example.active).toBe(false);

    const before = runCli(['auth', 'whoami', '--scope', 'project', '--json'], dir, env);
    expect(before.exitCode).toBe(0);
    expect(JSON.parse(new TextDecoder().decode(before.stdout)).authenticated).toBe(false);

    const login = runCli(['auth', 'login', '--api-key', 'kh_cli', '--email', 'agent@example.com', '--org', 'hasna', '--scope', 'project', '--json'], dir, env);
    expect(login.exitCode).toBe(0);
    const loginOut = JSON.parse(new TextDecoder().decode(login.stdout));
    expect(loginOut.authenticated).toBe(true);
    expect(loginOut.email).toBe('agent@example.com');
    expect(existsSync(join(authDir, 'auth.json'))).toBe(true);

    const logout = runCli(['auth', 'logout', '--scope', 'project', '--json'], dir, env);
    expect(logout.exitCode).toBe(0);
    expect(JSON.parse(new TextDecoder().decode(logout.stdout)).removed).toBe(true);
  });

  test('setup can opt into canonical example S3 artifact storage', () => {
    const dir = mkdtempSync(join(tmpdir(), 'ok-canonical-storage-cli-'));

    const setup = runCli(['setup', '--canonical-example', '--scope', 'project', '--json'], dir);
    expect(setup.exitCode).toBe(0);
    const setupOut = JSON.parse(new TextDecoder().decode(setup.stdout));
    expect(setupOut.storage_type).toBe('s3');
    expect(setupOut.artifact_uri_prefix).toBe('s3://example-knowledge-prod/.hasna/knowledge/');
    expect(setupOut.canonical_example.active).toBe(true);

    const storage = runCli(['storage', 'status', '--scope', 'project', '--json'], dir);
    expect(storage.exitCode).toBe(0);
    const storageOut = JSON.parse(new TextDecoder().decode(storage.stdout));
    expect(storageOut.artifact_store.s3).toMatchObject({
      bucket: 'example-knowledge-prod',
      prefix: '.hasna/knowledge',
      region: 'us-east-1',
      profile: 'example-infra',
    });
    expect(storageOut.canonical_example.secrets).toMatchObject({
      env: 'example/knowledge/prod/env',
      aws: 'example/knowledge/prod/aws',
      s3: 'example/knowledge/prod/s3',
      future_rds: 'example/knowledge/prod/rds',
    });
  });

  test('db init and stats create project knowledge.db', () => {
    const dir = mkdtempSync(join(tmpdir(), 'ok-db-cli-'));

    const init = runCli(['db', 'init', '--scope', 'project', '--json'], dir);
    expect(init.exitCode).toBe(0);
    const initOut = JSON.parse(new TextDecoder().decode(init.stdout));
    expect(initOut.schema_version).toBe(CURRENT_SCHEMA_VERSION);
    expect(existsSync(join(projectKnowledgeHome(dir), 'knowledge.db'))).toBe(true);

    const stats = runCli(['db', 'stats', '--scope', 'project', '--json'], dir);
    expect(stats.exitCode).toBe(0);
    const statsOut = JSON.parse(new TextDecoder().decode(stats.stdout));
    expect(statsOut.schema_version).toBe(CURRENT_SCHEMA_VERSION);
    expect(statsOut.sources).toBe(0);
    expect(statsOut.runs).toBe(0);

    const storage = runCli(['db', 'storage', 'status', '--scope', 'project', '--json'], dir);
    expect(storage.exitCode).toBe(0);
    const storageOut = JSON.parse(new TextDecoder().decode(storage.stdout));
    expect(storageOut.service).toBe('knowledge');
    expect(storageOut.backend).toBe('sqlite');
    expect(storageOut.tables).toContain('sources');
    expect(storageOut.tables).not.toContain('chunks_fts');
  });

  test('db init migrates an existing global schema v7 database to schema v8', () => {
    const dir = mkdtempSync(join(tmpdir(), 'ok-db-cli-v7-to-v8-'));
    const home = join(dir, 'home');
    const dbPath = join(home, '.hasna', 'knowledge', 'knowledge.db');
    createSchema7KnowledgeDb(dbPath);

    const init = runCli(['db', 'init', '--scope', 'global', '--json'], dir, {
      HOME: home,
      USERPROFILE: home,
    });
    expect(init.exitCode).toBe(0);
    const initOut = JSON.parse(new TextDecoder().decode(init.stdout));
    expect(initOut.ok).toBe(true);
    expect(initOut.schema_version).toBe(CURRENT_SCHEMA_VERSION);

    const stats = runCli(['db', 'stats', '--scope', 'global', '--json'], dir, {
      HOME: home,
      USERPROFILE: home,
    });
    expect(stats.exitCode).toBe(0);
    const statsOut = JSON.parse(new TextDecoder().decode(stats.stdout));
    expect(statsOut.schema_version).toBe(CURRENT_SCHEMA_VERSION);

    const db = openKnowledgeDb(dbPath);
    try {
      const columns = db.query<{ name: string }, []>('PRAGMA table_info(wiki_pages)').all()
        .map((row) => row.name);
      expect(columns).toContain('valid_from');
      expect(columns).toContain('last_verified_at');
    } finally {
      db.close();
    }
  });

  test('sync status, snapshot, machines, and conflicts use the project catalog', () => {
    const dir = mkdtempSync(join(tmpdir(), 'ok-sync-cli-'));

    const status = runCli(['sync', 'status', '--scope', 'project', '--json'], dir);
    expect(status.exitCode).toBe(0);
    const statusOut = JSON.parse(new TextDecoder().decode(status.stdout));
    expect(statusOut.sqlite_schema_version).toBe(0);
    expect(statusOut.machines.total).toBe(0);
    expect(statusOut.conflicts.open).toBe(0);
    expect(existsSync(join(dir, '.hasna', 'knowledge'))).toBe(false);

    const compactStatus = runCli(['sync', 'status', '--scope', 'project'], dir);
    expect(compactStatus.exitCode).toBe(0);
    expect(new TextDecoder().decode(compactStatus.stdout)).toContain('open conflicts: 0');

    const snapshot = runCli(['sync', 'snapshot', '--scope', 'project', '--no-tailscale', '--json'], dir);
    expect(snapshot.exitCode).toBe(0);
    const snapshotOut = JSON.parse(new TextDecoder().decode(snapshot.stdout));
    expect(snapshotOut.ok).toBe(true);
    expect(snapshotOut.snapshot.content_hash).toStartWith('sha256:');
    expect(snapshotOut.machines_upserted).toBeGreaterThanOrEqual(1);

    const statusAfterSnapshot = runCli(['sync', 'status', '--scope', 'project', '--json'], dir);
    expect(statusAfterSnapshot.exitCode).toBe(0);
    const statusAfterSnapshotOut = JSON.parse(new TextDecoder().decode(statusAfterSnapshot.stdout));
    expect(statusAfterSnapshotOut.sqlite_schema_version).toBe(CURRENT_SCHEMA_VERSION);

    const machines = runCli(['sync', 'machines', '--scope', 'project', '--json'], dir);
    expect(machines.exitCode).toBe(0);
    const machinesOut = JSON.parse(new TextDecoder().decode(machines.stdout));
    expect(machinesOut.machines.length).toBeGreaterThanOrEqual(1);

    const compactMachines = runCli(['sync', 'machines', '--scope', 'project'], dir);
    expect(compactMachines.exitCode).toBe(0);
    expect(new TextDecoder().decode(compactMachines.stdout)).toContain('registered sync machine(s)');

    const conflicts = runCli(['sync', 'conflicts', '--scope', 'project', '--json'], dir);
    expect(conflicts.exitCode).toBe(0);
    const conflictsOut = JSON.parse(new TextDecoder().decode(conflicts.stdout));
    expect(conflictsOut.conflicts).toEqual([]);

    const compactConflicts = runCli(['sync', 'conflicts', '--scope', 'project'], dir);
    expect(compactConflicts.exitCode).toBe(0);
    expect(new TextDecoder().decode(compactConflicts.stdout)).toContain('0 sync conflict(s)');

    const service = createKnowledgeService({ scope: 'project', cwd: dir });
    const conflict = recordKnowledgeSyncConflict(service.ensureWorkspace().knowledgeDbPath, {
      entityKind: 'wiki_pages',
      entityId: 'wiki/handbook.md',
      localMachineId: 'linux-node-b',
      remoteMachineId: 'linux-node-a',
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
  }, budget(10000));

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
    expect(existsSync(join(projectKnowledgeHome(peerDir), 'artifacts', 'wiki', 'README.md'))).toBe(false);

    const compactDryRun = runCli(['sync', 'dry-run', '--peer-workspace', peerDir, '--scope', 'project'], sourceDir);
    expect(compactDryRun.exitCode).toBe(0);
    const compactDryRunOut = new TextDecoder().decode(compactDryRun.stdout);
    expect(compactDryRunOut).toContain('Sync dry-run completed (dry run)');
    expect(compactDryRunOut).toContain('Hint: use --verbose');

    const push = runCli(['sync', 'push', '--peer-workspace', peerDir, '--scope', 'project', '--json'], sourceDir);
    expect(push.exitCode).toBe(0);
    const pushOut = JSON.parse(new TextDecoder().decode(push.stdout));
    expect(pushOut.ok).toBe(true);
    expect(pushOut.push.artifacts.copied).toBeGreaterThanOrEqual(1);
    expect(existsSync(join(projectKnowledgeHome(peerDir), 'artifacts', 'wiki', 'README.md'))).toBe(true);

    const peerStats = runCli(['db', 'stats', '--scope', 'project', '--json'], peerDir);
    expect(peerStats.exitCode).toBe(0);
    const peerStatsOut = JSON.parse(new TextDecoder().decode(peerStats.stdout));
    expect(peerStatsOut.sources).toBe(1);
    expect(peerStatsOut.storage_objects).toBe(4);
  }, budget(10000));

  test('sync peer-workspace works without machines adapter calls', () => {
    const sourceDir = mkdtempSync(join(tmpdir(), 'ok-sync-no-machines-source-'));
    const peerDir = mkdtempSync(join(tmpdir(), 'ok-sync-no-machines-peer-'));
    const bin = join(sourceDir, 'bin');
    const machinesMarker = join(sourceDir, 'machines-called.txt');
    const source = join(sourceDir, 'sync-source.md');
    writeFailingMachinesBin(bin, machinesMarker);
    writeFileSync(source, 'Explicit peer workspace sync must not require open-machines.');

    const env = { PATH: pathWithBin(bin) };
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
  }, budget(10000));

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
    expect(existsSync(join(projectKnowledgeHome(peerDir), 'artifacts', 'wiki', 'README.md'))).toBe(true);
  }, budget(10000));

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
        workspace_home: '/remote/.hasna/knowledge',
        sqlite_schema_version: 6,
        machine_id: 'linux-node-a',
        artifact_root_uri: 'file:///remote/.hasna/knowledge/artifacts/',
      },
      tables: [],
      artifacts: [],
      warnings: [],
      message: 'old bundle without protocol fields',
    };

    const result = runCli(['sync', 'pull', '--machine', 'linux-node-a', '--peer-workspace', '/remote/open-knowledge', '--scope', 'project', '--json'], dir, {
      PATH: pathWithBin(bin),
      ...fakeSshCommandEnv(bin),
      KNOWLEDGE_FAKE_SSH_EXPORT_JSON: JSON.stringify(oldBundle),
    });

    expect(result.exitCode).toBe(1);
    expect(new TextDecoder().decode(result.stderr)).toContain('unsupported sync protocol');
  });

  test('ssh sync resolves machine target through machines route when available', () => {
    const dir = mkdtempSync(join(tmpdir(), 'ok-sync-ssh-route-'));
    const targetPath = join(dir, 'ssh-target.txt');
    const bin = writeFakeSshBin(dir);
    writeFakeMachinesRouteBin(bin, 'routed-linux-node-a.tailnet.test');
    const bundle = {
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

    const result = runCli(['sync', 'pull', '--machine', 'linux-node-a', '--peer-workspace', '/remote/open-knowledge', '--scope', 'project', '--json'], dir, {
      PATH: pathWithBin(bin),
      ...fakeSshCommandEnv(bin),
      KNOWLEDGE_FAKE_SSH_EXPORT_JSON: JSON.stringify(bundle),
      KNOWLEDGE_FAKE_SSH_TARGET_PATH: targetPath,
    });

    expect(result.exitCode).toBe(0);
    expect(readFileSync(targetPath, 'utf8')).toBe('routed-linux-node-a.tailnet.test');
    const out = JSON.parse(new TextDecoder().decode(result.stdout));
    expect(out.resolved_machine).toBe('routed-linux-node-a.tailnet.test');
    expect(out.resolved_route).toMatchObject({
      source: 'open-machines',
      adapter: {
        implementation: 'cli',
        available: true,
      },
      target: 'routed-linux-node-a.tailnet.test',
      route: 'tailscale',
      target_kind: 'tailscale',
      confidence: 'high',
      evidence: {
        topology: true,
        matched_by: 'machine_id',
        selected_hint: {
          kind: 'tailscale',
          target: 'routed-linux-node-a.tailnet.test',
          reachable: true,
        },
      },
    });
  });

  test('ssh sync resolves peer workspace through machines path mapping when omitted', () => {
    const dir = mkdtempSync(join(tmpdir(), 'ok-sync-ssh-workspace-'));
    const targetPath = join(dir, 'ssh-target.txt');
    const bin = writeFakeSshBin(dir);
    writeFakeMachinesRouteBin(bin, 'routed-linux-node-a.tailnet.test', '/mapped/open-knowledge');
    const bundle = {
      ok: true,
      format: 'knowledge-sync-bundle',
      version: 1,
      protocol_version: 1,
      min_protocol_version: 1,
      generated_at: '2026-06-09T00:00:00.000Z',
      source: {
        scope: 'project',
        workspace_home: '/mapped/open-knowledge/.hasna/knowledge',
        sqlite_schema_version: 6,
        machine_id: 'linux-node-a',
        artifact_root_uri: 'file:///mapped/open-knowledge/.hasna/knowledge/artifacts/',
      },
      tables: [],
      artifacts: [],
      warnings: [],
      message: 'valid empty bundle',
    };

    const result = runCli(['sync', 'pull', '--machine', 'linux-node-a', '--scope', 'project', '--json'], dir, {
      PATH: pathWithBin(bin),
      ...fakeSshCommandEnv(bin),
      KNOWLEDGE_FAKE_SSH_EXPORT_JSON: JSON.stringify(bundle),
      KNOWLEDGE_FAKE_SSH_TARGET_PATH: targetPath,
    });

    expect(result.exitCode).toBe(0);
    expect(readFileSync(targetPath, 'utf8')).toBe('routed-linux-node-a.tailnet.test');
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
        workspace_home: `${dir}/.hasna/knowledge`,
        sqlite_schema_version: 6,
        machine_id: 'linux-node-b',
        artifact_root_uri: `file://${dir}/.hasna/knowledge/artifacts/`,
      },
      target: {
        scope: 'project',
        workspace_home: '/remote/.hasna/knowledge',
        sqlite_schema_version: 6,
        artifact_root_uri: 'file:///remote/.hasna/knowledge/artifacts/',
      },
      tables: [],
      artifacts: { source_artifacts: 0, target_artifacts: 0, copied: 0, skipped: 0, conflicts: 0, missing_content: 0 },
      conflicts_created: 0,
      warnings: [],
      message: 'old import result without protocol fields',
    };

    const result = runCli(['sync', 'push', '--machine', 'linux-node-a', '--peer-workspace', '/remote/open-knowledge', '--scope', 'project', '--json', '--dry-run'], dir, {
      PATH: pathWithBin(bin),
      ...fakeSshCommandEnv(bin),
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

    const compactSourceSearch = runCli(['search', 'source', 'company', 'wiki', '--scope', 'project'], dir);
    expect(compactSourceSearch.exitCode).toBe(0);
    const compactSourceSearchOut = new TextDecoder().decode(compactSourceSearch.stdout);
    expect(compactSourceSearchOut).toContain('search result(s)');
    expect(compactSourceSearchOut).toContain('source-governed company wiki content');
    expect(compactSourceSearchOut).toContain('Hint: use --verbose');
    expect(compactSourceSearchOut).not.toContain('"provenance"');

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

    const compactContext = runCli(['search', 'company', 'wiki', 'content', '--context', '--scope', 'project', '--semantic', '--fake', '--dimensions', '8'], dir);
    expect(compactContext.exitCode).toBe(0);
    const compactContextOut = new TextDecoder().decode(compactContext.stdout);
    expect(compactContextOut).toContain('context excerpt(s)');
    expect(compactContextOut).toContain('Citations:');
    expect(compactContextOut).toContain('Hint: use --verbose');
  }, budget(15000));

  test('context pack and proposal context commands return bounded agent JSON', () => {
    const dir = mkdtempSync(join(tmpdir(), 'ok-context-pack-cli-'));
    const source = join(dir, 'source.md');
    writeFileSync(source, 'CLI context pack should cite bounded source evidence for alpha roadmap.');
    const sourceRef = `file://${source}`;

    const ingest = runCli(['ingest', 'source', sourceRef, '--purpose', 'knowledge_index', '--scope', 'project', '--json'], dir);
    expect(ingest.exitCode).toBe(0);

    const pack = runCli(['context', 'pack', 'alpha', 'roadmap', '--scope', 'project', '--max-tokens', '1200', '--max-items', '1', '--json'], dir);
    expect(pack.exitCode).toBe(0);
    const packOut = JSON.parse(new TextDecoder().decode(pack.stdout));
    expect(packOut.format).toBe('knowledge-agent-context-pack');
    expect(packOut.source).toBe('search');
    expect(packOut.budgets.items_included).toBeLessThanOrEqual(1);
    expect(packOut.budgets.estimated_tokens).toBeLessThanOrEqual(packOut.budgets.max_tokens);
    expect(packOut.evidence[0].citation_ids.length).toBeGreaterThan(0);

    const db = openKnowledgeDb(join(projectKnowledgeHome(dir), 'knowledge.db'));
    // Relative to now, NOT a hardcoded date: this row is filtered through `--since 30d`
    // below, so a fixed timestamp is a time bomb. The original '2026-06-25T00:00:00.000Z'
    // aged out of the 30-day window on 2026-07-25 and turned main's CI red on wall clock
    // alone, with no code change.
    const runCreatedAt = new Date(Date.now() - 5 * 24 * 60 * 60 * 1000).toISOString();
    try {
      db.run(
        `INSERT INTO runs (id, type, prompt, status, provider, model, metadata_json, created_at, updated_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        [
          'run_cli_loop',
          'loop-proposal',
          'CLI loop context pack should assemble alpha roadmap proposal evidence.',
          'completed',
          'local',
          'context-pack',
          JSON.stringify({ loop_id: 'loop_cli', artifact_uri: 'file:///tmp/run_cli_loop.json' }),
          runCreatedAt,
          runCreatedAt,
        ],
      );
    } finally {
      db.close();
    }

    const proposal = runCli(['proposals', 'context', '--from', 'loops', '--topic', 'alpha roadmap proposal', '--since', '30d', '--max-tokens', '1200', '--json', '--scope', 'project'], dir);
    expect(proposal.exitCode).toBe(0);
    const proposalOut = JSON.parse(new TextDecoder().decode(proposal.stdout));
    expect(proposalOut.source).toBe('loops');
    expect(proposalOut.purpose).toBe('proposal');
    expect(proposalOut.evidence.some((entry: any) => entry.id === 'run:run_cli_loop')).toBe(true);
    expect(proposalOut.safety.raw_artifact_content_included).toBe(false);

    const runsPack = runCli(['context', 'pack', '--from', 'runs', '--topic', 'alpha roadmap proposal', '--scope', 'project', '--max-tokens', '1200', '--json'], dir);
    expect(runsPack.exitCode).toBe(0);
    const runsPackOut = JSON.parse(new TextDecoder().decode(runsPack.stdout));
    expect(runsPackOut.source).toBe('runs');
    expect(runsPackOut.purpose).toBe('proposal');

    const missingTopic = runCli(['proposals', 'context', '--from', 'loops', '--scope', 'project', '--json'], dir);
    expect(missingTopic.exitCode).toBe(1);
    expect(new TextDecoder().decode(missingTopic.stderr)).toContain('--topic <text>');
  });

  test('export defaults to compact preview and full records require explicit machine-readable flags', () => {
    const dir = mkdtempSync(join(tmpdir(), 'ok-export-compact-'));
    const store = join(dir, 'db.json');

    const add = runCli(['add', 'Exported compact item', 'Full export content stays out of default terminal output', '--store', store, '--json']);
    expect(add.exitCode).toBe(0);

    const compact = runCli(['export', '--store', store]);
    expect(compact.exitCode).toBe(0);
    const compactOut = new TextDecoder().decode(compact.stdout);
    expect(compactOut).toContain('Export preview: 1 item(s) available');
    expect(compactOut).not.toContain('Full export content stays out');

    const json = runCli(['export', '--store', store, '--json']);
    expect(json.exitCode).toBe(0);
    expect(JSON.parse(new TextDecoder().decode(json.stdout)).items[0].content).toContain('Full export content');

    const verbose = runCli(['export', '--store', store, '--verbose']);
    expect(verbose.exitCode).toBe(0);
    expect(JSON.parse(new TextDecoder().decode(verbose.stdout)).items[0].content).toContain('Full export content');

    const jsonl = runCli(['export', '--store', store, '--format', 'jsonl']);
    expect(jsonl.exitCode).toBe(0);
    expect(new TextDecoder().decode(jsonl.stdout)).toContain('Full export content');
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
    expect(existsSync(join(projectKnowledgeHome(dir), 'artifacts', 'schemas', 'v1.md'))).toBe(true);
    expect(existsSync(join(projectKnowledgeHome(dir), 'artifacts', 'indexes', 'root.md'))).toBe(true);
    expect(existsSync(join(projectKnowledgeHome(dir), 'artifacts', 'wiki', 'README.md'))).toBe(true);

    const stats = runCli(['db', 'stats', '--scope', 'project', '--json'], dir);
    expect(stats.exitCode).toBe(0);
    const statsOut = JSON.parse(new TextDecoder().decode(stats.stdout));
    expect(statsOut.storage_objects).toBe(4);
    expect(statsOut.wiki_pages).toBe(1);
    expect(statsOut.indexes).toBe(1);
  });

  test('inventory retrieves legacy items and SQLite knowledge layers', () => {
    const dir = mkdtempSync(join(tmpdir(), 'ok-inventory-cli-'));
    const sourcePath = join(dir, 'inventory-source.md');
    const sourceRef = pathToFileURL(sourcePath).href;
    writeFileSync(sourcePath, [
      '# Inventory Source',
      '',
      'The inventory command must retrieve source chunks, wiki pages, artifact rows, and run ledger entries.',
    ].join('\n'));

    const add = runCli(['add', 'Inventory Note', 'Manual note body for inventory checks', '--scope', 'project', '--json'], dir);
    expect(add.exitCode).toBe(0);

    const ingest = runCli(['ingest', 'source', sourceRef, '--purpose', 'knowledge_index', '--scope', 'project', '--json'], dir);
    expect(ingest.exitCode).toBe(0);

    const init = runCli(['wiki', 'init', '--scope', 'project', '--json'], dir);
    expect(init.exitCode).toBe(0);

    const ask = runCli(['ask', 'What does the inventory source say?', '--scope', 'project', '--json'], dir);
    expect(ask.exitCode).toBe(0);

    const inventory = runCli(['inventory', '--scope', 'project', '--json', '--limit', '10'], dir);
    expect(inventory.exitCode).toBe(0);
    const out = JSON.parse(new TextDecoder().decode(inventory.stdout));
    expect(out.summary.legacy_items).toBe(1);
    expect(out.summary.sources).toBe(1);
    expect(out.summary.chunks).toBeGreaterThanOrEqual(2);
    expect(out.summary.wiki_pages).toBe(1);
    expect(out.summary.indexes).toBe(1);
    expect(out.summary.storage_objects).toBeGreaterThanOrEqual(4);
    expect(out.summary.runs).toBeGreaterThanOrEqual(1);
    expect(out.items[0].title).toBe('Inventory Note');
    expect(out.sources[0].uri).toBe(sourceRef);
    expect(out.chunks.some((chunk: any) => String(chunk.text_preview).includes('inventory command'))).toBe(true);
    expect(out.wiki_pages.some((page: any) => page.path === 'wiki/README.md')).toBe(true);
    expect(out.storage_objects.some((object: any) => String(object.artifact_uri).replace(/\\/g, '/').includes('wiki/README.md'))).toBe(true);
    expect(out.runs.some((run: any) => run.type === 'knowledge-prompt')).toBe(true);

    const text = runCli(['inventory', '--scope', 'project', '--limit', '3'], dir);
    expect(text.exitCode).toBe(0);
    const textOut = new TextDecoder().decode(text.stdout);
    expect(textOut).toContain('Knowledge inventory (project)');
    expect(textOut).toContain('Inventory Note');
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
    const fileRef = pathToFileURL(join(tmpdir(), 'readme.md')).href;
    expect(parseSourceRef(fileRef)).toMatchObject({ kind: 'file', path: fileURLToPath(fileRef) });
    expect(parseSourceRef('https://example.com/docs')).toMatchObject({ kind: 'web', url: 'https://example.com/docs' });
  });

  // The `dedupe` CLI command had no test: `grep -rn "'dedupe'" tests/` returns zero hits across
  // the 38 test files. Corrected in adversarial review: that probe misses `ok_dedupe` in
  // tests/mcp.test.ts, which does seed a duplicate pair and assert `removed === 1` - the MCP
  // surface was covered, the CLI one was not, and the earlier claim of "no test anywhere in the
  // suite" overstated it. It calls `itemStore.deleteMany`, so the CLI path was still a
  // destructive command shipping without a regression guard.
  //
  // THE FIXTURE IS BUILT AS A DISCRIMINATOR, not as a happy path. It holds a real duplicate pair
  // AND four items that must survive, so it fails in both directions: if dedupe stopped removing
  // anything the pair assertions go red, and if it became too eager the survivor assertions go
  // red. A fixture with only duplicates cannot tell working dedupe from absent dedupe, and a
  // fixture with only distinct items cannot tell it from a no-op — that shape of fixture is
  // exactly how wrong answers about this repo have survived review before.
  //
  // Every assertion reads the STORE back. `removed`/`remaining` from the JSON are checked
  // against what is actually on disk, because a count is the easiest thing in this command to
  // get right while deleting the wrong rows.
  test('dedupe collapses only exact title+content duplicates, and refuses without --yes', () => {
    const dir = mkdtempSync(join(tmpdir(), 'kn-dedupe-'));
    const store = join(dir, 'db.json');
    const decode = (buf: Uint8Array) => new TextDecoder().decode(buf);
    const at = (day: string) => `2026-07-0${day}T00:00:00.000Z`;
    const item = (id: string, title: string, content: string, extra: Record<string, unknown> = {}) => ({
      id,
      title,
      content,
      url: null,
      tags: [],
      metadata: {},
      archived: false,
      created_at: at(id.slice(-1)),
      updated_at: at(id.slice(-1)),
      ...extra,
    });

    // `item()` derives its timestamps from the last character of the id, which only works for ids
    // ending in a digit 1-9. The delimiter pairs below need distinct, valid timestamps and ids
    // that name the delimiter they guard, so they pass theirs explicitly.
    const sep = (id: string, title: string, content: string, iso: string) =>
      item(id, title, content, { created_at: iso, updated_at: iso });

    // k_dup_1/k_dup_2 are the duplicate pair. They differ in url and tags ON PURPOSE: the key is
    // title+content only, so the second one's url and tags are DESTROYED by dedupe. That is
    // current behaviour, and pinning it here means changing it has to be deliberate rather than
    // discovered by a user missing a tag.
    const seedItems = [
      item('k_dup_1', 'Same', 'Body', { url: 'https://first.example', tags: ['first'] }),
      item('k_dup_2', 'Same', 'Body', { url: 'https://second.example', tags: ['second'] }),
      // Same title, different content -> not a duplicate.
      item('k_title_3', 'Same', 'Different body'),
      // Same content, different title -> not a duplicate.
      item('k_content_4', 'Other', 'Body'),
      // THE EMPTY-SEPARATOR BOUNDARY. 'T' + 'AB' and 'TA' + 'B' concatenate to the same 'TAB', so
      // with an EMPTY separator these two collide and dedupe deletes one of them — silent data
      // loss on two unrelated items. With any non-empty separator the keys differ.
      item('k_bound_5', 'T', 'AB'),
      item('k_bound_6', 'TA', 'B'),
      // THE PRINTABLE-DELIMITER BOUNDARY — added in adversarial review, because the pair above
      // does NOT justify the NUL specifically. It only discriminates empty vs non-empty:
      // substituting ',', '\t', '\n' or a multi-char sentinel for the NUL leaves 'T','AB' and
      // 'TA','B' distinct, so all four substitutions kept this test GREEN. Measured with a ','
      // separator against the comma pair below: `removed 1, remaining 1` — one of two unrelated
      // items silently deleted, the exact failure class this test exists to catch.
      //
      // A fixture can only tell one delimiter from another by putting that delimiter INSIDE the
      // data. Each pair below is distinct under NUL and collides under its own candidate
      // delimiter, so all six must survive. Add a pair here before changing the separator.
      sep('k_sep_comma_a', 'A', 'B,C', '2026-07-07T00:00:00.000Z'),
      sep('k_sep_comma_b', 'A,B', 'C', '2026-07-08T00:00:00.000Z'),
      sep('k_sep_tab_a', 'D', 'E\tF', '2026-07-09T00:00:00.000Z'),
      sep('k_sep_tab_b', 'D\tE', 'F', '2026-07-10T00:00:00.000Z'),
      sep('k_sep_nl_a', 'G', 'H\nI', '2026-07-11T00:00:00.000Z'),
      sep('k_sep_nl_b', 'G\nH', 'I', '2026-07-12T00:00:00.000Z'),
    ];
    writeFileSync(store, JSON.stringify({ items: seedItems }));
    const seededBytes = readFileSync(store);

    const storedIds = (): string[] => (JSON.parse(readFileSync(store, 'utf8')) as { items: Array<{ id: string }> }).items.map((entry) => entry.id);
    const storedItem = (id: string) => {
      const found = (JSON.parse(readFileSync(store, 'utf8')) as { items: Array<Record<string, any>> }).items.find((entry) => entry.id === id);
      expect(found, `${id} should still be in the store`).toBeDefined();
      return found!;
    };

    // Positive control: the fixture really is what the assertions below assume — twelve items, one
    // genuine duplicate pair, and every boundary pair present.
    expect(storedIds()).toEqual([
      'k_dup_1', 'k_dup_2', 'k_title_3', 'k_content_4', 'k_bound_5', 'k_bound_6',
      'k_sep_comma_a', 'k_sep_comma_b', 'k_sep_tab_a', 'k_sep_tab_b', 'k_sep_nl_a', 'k_sep_nl_b',
    ]);
    expect(`${storedItem('k_bound_5').title}${storedItem('k_bound_5').content}`).toBe(`${storedItem('k_bound_6').title}${storedItem('k_bound_6').content}`);

    // Positive control on the DISCRIMINATING POWER of each delimiter pair, which is the whole
    // point of them: under its own candidate delimiter the pair's keys are IDENTICAL (so
    // substituting that delimiter collapses two unrelated items and reddens this test), and under
    // the real NUL they are DISTINCT (so the pair does not itself get deduped). Asserted rather
    // than described, because a pair that failed to collide under the substitute would look
    // exactly like a passing test while guarding nothing.
    const keyWith = (id: string, delim: string) => `${storedItem(id).title}${delim}${storedItem(id).content}`;
    for (const [a, b, delim, name] of [
      ['k_sep_comma_a', 'k_sep_comma_b', ',', 'comma'],
      ['k_sep_tab_a', 'k_sep_tab_b', '\t', 'tab'],
      ['k_sep_nl_a', 'k_sep_nl_b', '\n', 'newline'],
      ['k_bound_5', 'k_bound_6', '', 'empty'],
    ] as const) {
      expect(keyWith(a, delim), `${name}: the pair must collide under ${JSON.stringify(delim)} or it guards nothing`).toBe(keyWith(b, delim));
      // The NUL is written as the six-character escape backslash-u-0000, never as a literal NUL
      // byte: a literal NUL in this file also makes `grep` treat it as binary and go silent,
      // which is how a NUL survived unnoticed in this PR's own description. Byte-checked in CI
      // by nothing, so it is asserted here instead - see the no-literal-NUL test below.
      expect(keyWith(a, '\u0000'), `${name}: the pair must stay distinct under the real NUL separator`).not.toBe(keyWith(b, '\u0000'));
    }

    // Refusing without --yes must delete nothing. Compared byte-for-byte rather than by count,
    // because a rewrite that preserves the count would still be a write this command must not do.
    const refused = runCli(['dedupe', '--store', store, '--json']);
    expect(refused.exitCode).not.toBe(0);
    expect(decode(refused.stderr)).toContain('Refusing dedupe without --yes');
    expect(readFileSync(store).equals(seededBytes)).toBe(true);

    const deduped = runCli(['dedupe', '--yes', '--store', store, '--json']);
    expect(deduped.exitCode).toBe(0);
    const result = JSON.parse(decode(deduped.stdout));
    expect(result.ok).toBe(true);
    expect(result.removed).toBe(1);
    expect(result.remaining).toBe(11);
    expect(result.message).toBe('Dedupe removed 1 duplicate(s)');

    // The reported counts must agree with the store, in both directions.
    const after = storedIds();
    expect(after).toHaveLength(result.remaining);
    expect(seedItems.length - after.length).toBe(result.removed);

    // The FIRST occurrence survives and the later one is dropped — not an arbitrary winner.
    expect(after).toEqual([
      'k_dup_1', 'k_title_3', 'k_content_4', 'k_bound_5', 'k_bound_6',
      'k_sep_comma_a', 'k_sep_comma_b', 'k_sep_tab_a', 'k_sep_tab_b', 'k_sep_nl_a', 'k_sep_nl_b',
    ]);
    expect(storedItem('k_dup_1').url).toBe('https://first.example');
    expect(storedItem('k_dup_1').tags).toEqual(['first']);

    // All TEN non-duplicates are untouched, including both halves of every separator pair.
    // Corrected in adversarial review: an earlier comment here said "the three non-duplicates"
    // while four were asserted, and claimed THIS assertion is the one that fails if the
    // separator is emptied. It is not - bun aborts the test at the `result.removed` expectation
    // above, so these lines never execute on that mutation. They are the second line of
    // defence, not the detector.
    expect(after).toContain('k_title_3');
    expect(after).toContain('k_content_4');
    expect(after).toContain('k_bound_5');
    expect(after).toContain('k_bound_6');
    expect(after).toContain('k_sep_comma_a');
    expect(after).toContain('k_sep_comma_b');
    expect(after).toContain('k_sep_tab_a');
    expect(after).toContain('k_sep_tab_b');
    expect(after).toContain('k_sep_nl_a');
    expect(after).toContain('k_sep_nl_b');

    // Idempotence: a second run has nothing left to collapse and must report 0 rather than
    // deleting more.
    const again = runCli(['dedupe', '--yes', '--store', store, '--json']);
    expect(again.exitCode).toBe(0);
    const secondResult = JSON.parse(decode(again.stdout));
    expect(secondResult.removed).toBe(0);
    expect(secondResult.remaining).toBe(11);
    expect(storedIds()).toEqual(after);
  });

  // Archived items are deduped too, which is worth its own assertion because `dedupe` is the only
  // destructive command here that does NOT filter on `archived` — `stats` and the default `list`
  // both do. An archived item is a soft-delete, so collapsing archived duplicates is defensible,
  // but it means dedupe reaches rows the operator has already put out of sight. Pinned so a change
  // either way is deliberate.
  test('dedupe reaches archived items as well as live ones', () => {
    const dir = mkdtempSync(join(tmpdir(), 'kn-dedupe-arch-'));
    const store = join(dir, 'db.json');
    const decode = (buf: Uint8Array) => new TextDecoder().decode(buf);
    const now = '2026-07-06T14:31:34.606Z';
    const item = (id: string, title: string, content: string, archived: boolean) => ({
      id, title, content, url: null, tags: [], metadata: {}, archived, created_at: now, updated_at: now,
    });
    writeFileSync(store, JSON.stringify({
      items: [
        item('k_arch_1', 'Arch', 'Arch body', true),
        item('k_arch_2', 'Arch', 'Arch body', true),
        // Live control: proves the run below is not simply deleting everything archived.
        item('k_live_1', 'Live', 'Live body', false),
      ],
    }));

    const deduped = runCli(['dedupe', '--yes', '--store', store, '--json']);
    expect(deduped.exitCode).toBe(0);
    const result = JSON.parse(decode(deduped.stdout));
    expect(result.removed).toBe(1);
    expect(result.remaining).toBe(2);
    const items = (JSON.parse(readFileSync(store, 'utf8')) as { items: Array<{ id: string; archived: boolean }> }).items;
    expect(items.map((entry) => entry.id)).toEqual(['k_arch_1', 'k_live_1']);
    expect(items.find((entry) => entry.id === 'k_arch_1')!.archived).toBe(true);
  });
});

describe('Knowledge CLI transport selection', () => {
  const decode = (buf: Uint8Array) => new TextDecoder().decode(buf);

  function runCliWithCleanRoute(args: string[], env: Record<string, string>) {
    const inherited = { ...process.env } as Record<string, string>;
    for (const key of [...KNOWLEDGE_API_URL_ENV_KEYS, ...KNOWLEDGE_API_KEY_ENV_KEYS, ...RETIRED_KNOWLEDGE_SELECTOR_ENV_KEYS, 'HASNA_KNOWLEDGE_LOCAL']) {
      delete inherited[key];
    }
    return Bun.spawnSync(['bun', CLI, ...args], {
      env: { ...inherited, ...env },
      stdout: 'pipe',
      stderr: 'pipe',
    });
  }

  const API_URL = 'https://knowledge.invalid';

  function sandboxHome(): Record<string, string> {
    const home = mkdtempSync(join(tmpdir(), 'knowledge-transport-'));
    return { HOME: home, USERPROFILE: home };
  }

  test('canonical API URL plus key selects HTTP and exits zero', () => {
    const result = runCliWithCleanRoute(['transport', '--json'], {
      ...sandboxHome(),
      HASNA_KNOWLEDGE_API_URL: API_URL,
      HASNA_KNOWLEDGE_API_KEY: 'k_fake_test_key',
    });
    expect(result.exitCode).toBe(0);
    expect(JSON.parse(decode(result.stdout))).toMatchObject({ ok: true, transport: 'http' });
  });

  test('canonical API URL absent fails closed: non-zero, actionable error, no on-box store created', () => {
    const home = mkdtempSync(join(tmpdir(), 'knowledge-transport-'));
    const homeEnv = { HOME: home, USERPROFILE: home };
    const result = runCliWithCleanRoute(['list', '--limit', '1', '--json'], homeEnv);
    expect(result.exitCode).not.toBe(0);
    // The fail-closed error names the required hosted env pair and the opt-in.
    const combined = decode(result.stdout) + decode(result.stderr);
    expect(combined).toContain('HASNA_KNOWLEDGE_API_URL');
    expect(combined).toContain('HASNA_KNOWLEDGE_API_KEY');
    expect(combined).toContain('HASNA_KNOWLEDGE_LOCAL');
    // No false-green fallback notice may accompany the rejection.
    expect(combined).not.toContain('knowledge-local-fallback');
    // And no on-box store file was created under the sandbox home.
    expect(existsSync(join(home, '.hasna', 'knowledge'))).toBe(false);
  });

  test('explicit HASNA_KNOWLEDGE_LOCAL=1 opt-in selects SQLite and exits zero', () => {
    const result = runCliWithCleanRoute(['transport', '--json'], {
      ...sandboxHome(),
      HASNA_KNOWLEDGE_LOCAL: '1',
    });
    expect(result.exitCode).toBe(0);
    expect(JSON.parse(decode(result.stdout))).toMatchObject({
      ok: true,
      transport: 'sqlite',
      source: 'HASNA_KNOWLEDGE_LOCAL',
      local_opt_in_present: true,
    });
  });

  test('retired selector fails loudly and names both replacements', () => {
    const result = runCliWithCleanRoute(['transport', '--json'], {
      ...sandboxHome(),
      HASNA_KNOWLEDGE_STORAGE_MODE: 'postgres',
    });
    expect(result.exitCode).not.toBe(0);
    const combined = decode(result.stdout) + decode(result.stderr);
    expect(combined).toContain('HASNA_KNOWLEDGE_STORAGE_MODE');
    expect(combined).toContain('HASNA_KNOWLEDGE_API_URL');
    expect(combined).toContain('HASNA_KNOWLEDGE_DATABASE_URL');
  });

  test('canonical URL without key fails closed without rendering values', () => {
    const result = runCliWithCleanRoute(['transport', '--json'], {
      ...sandboxHome(),
      HASNA_KNOWLEDGE_API_URL: API_URL,
    });
    expect(result.exitCode).not.toBe(0);
    const combined = decode(result.stdout) + decode(result.stderr);
    expect(combined).toContain('HASNA_KNOWLEDGE_API_KEY');
    expect(combined).not.toContain(API_URL);
  });
});
