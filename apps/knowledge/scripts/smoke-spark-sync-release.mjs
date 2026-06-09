#!/usr/bin/env bun

import { spawnSync } from 'node:child_process';
import { chmodSync, cpSync, existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, symlinkSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, relative, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const repoRoot = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const packageJson = JSON.parse(readFileSync(join(repoRoot, 'package.json'), 'utf8'));

function parseArgs(argv) {
  const options = {
    json: false,
    dryRun: false,
    keepTemp: false,
    install: true,
    installMachines: true,
    noMachinesSync: true,
    remote: process.env.KNOWLEDGE_SPARK_REMOTE || 'spark01',
    peer: process.env.KNOWLEDGE_SPARK_PEER || 'spark01',
    knowledgeVersion: process.env.KNOWLEDGE_VERSION || packageJson.version,
    machinesVersion: process.env.MACHINES_VERSION || 'latest',
    packageDir: process.env.KNOWLEDGE_PACKAGE_DIR || null,
    machinesPackageDir: process.env.MACHINES_PACKAGE_DIR || null,
    evidenceJson: process.env.KNOWLEDGE_SMOKE_EVIDENCE_JSON || null,
    evidenceMd: process.env.KNOWLEDGE_SMOKE_EVIDENCE_MD || null,
  };
  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i];
    if (arg === '--json') options.json = true;
    else if (arg === '--dry-run') options.dryRun = true;
    else if (arg === '--keep-temp') options.keepTemp = true;
    else if (arg === '--no-install') options.install = false;
    else if (arg === '--no-machines-install') options.installMachines = false;
    else if (arg === '--skip-no-machines-sync') options.noMachinesSync = false;
    else if (arg === '--remote') {
      options.remote = argv[i + 1];
      i += 1;
    } else if (arg === '--peer') {
      options.peer = argv[i + 1];
      i += 1;
    } else if (arg === '--knowledge-version') {
      options.knowledgeVersion = argv[i + 1];
      i += 1;
    } else if (arg === '--machines-version') {
      options.machinesVersion = argv[i + 1];
      i += 1;
    } else if (arg === '--package-dir') {
      options.packageDir = argv[i + 1];
      i += 1;
    } else if (arg === '--machines-package-dir') {
      options.machinesPackageDir = argv[i + 1];
      i += 1;
    } else if (arg === '--evidence-json') {
      options.evidenceJson = argv[i + 1];
      i += 1;
    } else if (arg === '--evidence-md') {
      options.evidenceMd = argv[i + 1];
      i += 1;
    } else if (arg === '--help' || arg === '-h') {
      console.log([
        'Usage: bun scripts/smoke-spark-sync-release.mjs [--json] [--dry-run] [--keep-temp]',
        '       [--knowledge-version <version>] [--machines-version <version|latest>]',
        '       [--remote spark01] [--peer spark01] [--package-dir <path>] [--machines-package-dir <path>]',
        '       [--evidence-json <path>] [--evidence-md <path>] [--no-install] [--no-machines-install]',
        '       [--skip-no-machines-sync]',
        '',
        'Runs the published-package spark02/spark01 release smoke:',
        '  1. install @hasna/knowledge and @hasna/machines on both machines',
        '  2. verify knowledge/machines adapter and machines consumer contracts',
        '  3. run sync doctor, dry-run, push, artifact manifest, and source-boundary checks',
        '  4. force conflicts in both directions, run fake AI proposals, approve resolutions',
        '  5. verify final bidirectional dry-run converges with zero conflicts',
        '  6. repeat the sync/conflict path with @hasna/machines hidden locally',
      ].join('\n'));
      process.exit(0);
    } else {
      throw new Error(`Unknown argument: ${arg}`);
    }
  }
  return options;
}

function shellQuote(value) {
  return `'${String(value).replace(/'/g, "'\\''")}'`;
}

function run(command, args = [], options = {}) {
  const result = spawnSync(command, args, {
    encoding: 'utf8',
    env: process.env,
    ...options,
  });
  return {
    status: result.status ?? 1,
    stdout: result.stdout || '',
    stderr: result.stderr || '',
  };
}

function runChecked(command, args = [], options = {}) {
  const result = run(command, args, options);
  if (result.status !== 0) {
    throw new Error([
      `Command failed: ${command} ${args.join(' ')}`,
      result.stdout ? `stdout:\n${result.stdout}` : null,
      result.stderr ? `stderr:\n${result.stderr}` : null,
    ].filter(Boolean).join('\n'));
  }
  return result.stdout;
}

function runShell(command, options = {}) {
  return runChecked('bash', ['-lc', command], options);
}

function runRemote(remote, command, options = {}) {
  return runChecked('ssh', [remote, command], options);
}

function parseJsonOutput(label, raw) {
  try {
    return JSON.parse(raw);
  } catch (error) {
    throw new Error(`${label} did not return JSON: ${(raw || String(error)).slice(0, 1200)}`);
  }
}

function localJson(label, command, options = {}) {
  return parseJsonOutput(label, runShell(command, options));
}

function remoteJson(remote, label, command, options = {}) {
  return parseJsonOutput(label, runRemote(remote, command, options));
}

function packagePath(root, name) {
  return join(root, ...name.split('/'));
}

function copyPackage(source, target) {
  if (!existsSync(source)) throw new Error(`Package source does not exist: ${source}`);
  const sourceRoot = resolve(source);
  cpSync(source, target, {
    recursive: true,
    filter: (path) => {
      const normalized = relative(sourceRoot, path).replace(/\\/g, '/');
      if (!normalized) return true;
      return normalized !== 'node_modules'
        && !normalized.startsWith('node_modules/')
        && normalized !== '.git'
        && !normalized.startsWith('.git/')
        && normalized !== '.hasna'
        && !normalized.startsWith('.hasna/')
        && normalized !== '.takumi'
        && !normalized.startsWith('.takumi/');
    },
  });
}

function linkDependency(root, nodeModules, packageName) {
  const source = packagePath(root, packageName);
  if (!existsSync(source)) return false;
  const target = packagePath(nodeModules, packageName);
  mkdirSync(dirname(target), { recursive: true });
  if (!existsSync(target)) symlinkSync(source, target, 'dir');
  return true;
}

function linkPackageDependencies(packageDir, globalRoot, nodeModules, exclude = new Set()) {
  const pkg = JSON.parse(readFileSync(join(packageDir, 'package.json'), 'utf8'));
  const deps = {
    ...(pkg.dependencies || {}),
    ...(pkg.peerDependencies || {}),
  };
  for (const dep of Object.keys(deps)) {
    if (exclude.has(dep)) continue;
    linkDependency(globalRoot, nodeModules, dep);
  }
}

function shadowMissingMachinesPackage(nodeModules) {
  const target = packagePath(nodeModules, '@hasna/machines');
  mkdirSync(target, { recursive: true });
  writeFileSync(join(target, 'package.json'), JSON.stringify({
    name: '@hasna/machines',
    version: '0.0.0-hidden-for-knowledge-smoke',
    type: 'module',
    exports: {
      '.': './missing.mjs',
      './consumer': './missing.mjs',
    },
  }, null, 2));
  writeFileSync(join(target, 'missing.mjs'), [
    "throw new Error(\"Cannot find module '@hasna/machines/consumer'\");",
    '',
  ].join('\n'));
}


function localGlobalNodeModules() {
  const bin = runChecked(process.execPath, ['pm', 'bin', '-g']).trim();
  return resolve(bin, '..', 'install', 'global', 'node_modules');
}

function remoteGlobalNodeModules(remote) {
  const bin = runRemote(remote, 'bun pm bin -g').trim();
  return resolve(bin, '..', 'install', 'global', 'node_modules');
}

function installPackages(options) {
  if (!options.install) return { installed: false };
  runShell(`bun install -g ${shellQuote(`@hasna/knowledge@${options.knowledgeVersion}`)}`);
  runRemote(options.remote, `bun install -g ${shellQuote(`@hasna/knowledge@${options.knowledgeVersion}`)}`);
  if (options.installMachines) {
    runShell(`bun install -g ${shellQuote(`@hasna/machines@${options.machinesVersion}`)}`);
    runRemote(options.remote, `bun install -g ${shellQuote(`@hasna/machines@${options.machinesVersion}`)}`);
  }
  return {
    installed: true,
    knowledge: options.knowledgeVersion,
    machines: options.installMachines ? options.machinesVersion : null,
  };
}

function packageDirs(options) {
  const localRoot = localGlobalNodeModules();
  const remoteRoot = remoteGlobalNodeModules(options.remote);
  return {
    local: {
      knowledge: resolve(options.packageDir || packagePath(localRoot, '@hasna/knowledge')),
      machines: resolve(options.machinesPackageDir || packagePath(localRoot, '@hasna/machines')),
    },
    remote: {
      knowledge: packagePath(remoteRoot, '@hasna/knowledge'),
      machines: packagePath(remoteRoot, '@hasna/machines'),
    },
  };
}

function createNoMachinesKnowledgeRunner(dirs) {
  const appDir = mkdtempSync(join(tmpdir(), 'knowledge-no-machines-runner-'));
  const nodeModules = join(appDir, 'node_modules');
  const knowledgeTarget = packagePath(nodeModules, '@hasna/knowledge');
  mkdirSync(dirname(knowledgeTarget), { recursive: true });
  copyPackage(dirs.local.knowledge, knowledgeTarget);
  const globalRoot = dirname(dirname(dirs.local.knowledge));
  linkPackageDependencies(dirs.local.knowledge, globalRoot, nodeModules, new Set(['@hasna/machines']));
  shadowMissingMachinesPackage(nodeModules);

  const binDir = join(appDir, 'bin');
  mkdirSync(binDir, { recursive: true });
  const wrapper = join(binDir, 'knowledge');
  writeFileSync(wrapper, `#!/bin/sh\nexec ${JSON.stringify(process.execPath)} ${JSON.stringify(join(knowledgeTarget, 'bin', 'knowledge.js'))} "$@"\n`);
  chmodSync(wrapper, 0o755);

  return {
    app_dir: appDir,
    bin_dir: binDir,
    env: {
      ...process.env,
      PATH: `${binDir}:/usr/local/sbin:/usr/local/bin:/usr/sbin:/usr/bin:/sbin:/bin`,
      NODE_PATH: nodeModules,
    },
    shadowed_machines_package: packagePath(nodeModules, '@hasna/machines'),
  };
}

function commandVersion(command) {
  const result = run(command, ['--version']);
  return result.status === 0 ? result.stdout.trim() : null;
}

function remoteCommandVersion(remote, command) {
  const result = run('ssh', [remote, `${shellQuote(command)} --version`]);
  return result.status === 0 ? result.stdout.trim() : null;
}

function commandEnvPrefix(options = {}) {
  const env = options.env;
  if (!env) return '';
  const entries = [];
  if (env.PATH) entries.push(`PATH=${shellQuote(env.PATH)}`);
  if (env.NODE_PATH !== undefined) entries.push(`NODE_PATH=${shellQuote(env.NODE_PATH)}`);
  return entries.length ? `/usr/bin/env ${entries.join(' ')} ` : '';
}

function runAdapterSmoke({ remote, peer, dirs }) {
  const script = join(repoRoot, 'scripts', 'smoke-machines-adapter.mjs');
  const local = localJson(
    'local machines adapter smoke',
    `${shellQuote(process.execPath)} ${shellQuote(script)} --json --package-dir ${shellQuote(dirs.local.knowledge)} --machines-package-dir ${shellQuote(dirs.local.machines)} --peer ${shellQuote('local')}`,
  );
  const remoteSmoke = remoteJson(
    remote,
    'remote machines adapter smoke',
    `cd ${shellQuote(dirs.remote.knowledge)} && bun scripts/smoke-machines-adapter.mjs --json --package-dir ${shellQuote(dirs.remote.knowledge)} --machines-package-dir ${shellQuote(dirs.remote.machines)} --peer ${shellQuote('local')}`,
  );
  return { peer, local, remote: remoteSmoke };
}

function runConsumerConformance({ remote, dirs }) {
  const localScript = join(dirs.local.machines, 'scripts', 'consumer-conformance.mjs');
  const local = existsSync(localScript)
    ? localJson('local machines consumer conformance', `${shellQuote(process.execPath)} ${shellQuote(localScript)} --json --package-dir ${shellQuote(dirs.local.machines)}`)
    : { ok: true, skipped: true, reason: `missing:${localScript}` };
  const remoteHasScript = run('ssh', [remote, `test -f ${shellQuote(join(dirs.remote.machines, 'scripts', 'consumer-conformance.mjs'))}`]).status === 0;
  const remoteResult = remoteHasScript
    ? remoteJson(
        remote,
        'remote machines consumer conformance',
        `bun ${shellQuote(join(dirs.remote.machines, 'scripts', 'consumer-conformance.mjs'))} --json --package-dir ${shellQuote(dirs.remote.machines)}`,
      )
    : { ok: true, skipped: true, reason: `missing:${join(dirs.remote.machines, 'scripts', 'consumer-conformance.mjs')}` };
  return { local, remote: remoteResult };
}

function knowledgeJson(cwd, args, options = {}) {
  const command = `cd ${shellQuote(cwd)} && ${commandEnvPrefix(options)}knowledge ${args.map(shellQuote).join(' ')}`;
  return localJson(`knowledge ${args.join(' ')}`, command, options);
}

function remoteKnowledgeJson(remote, cwd, args, options = {}) {
  const command = `cd ${shellQuote(cwd)} && knowledge ${args.map(shellQuote).join(' ')}`;
  return remoteJson(remote, `remote knowledge ${args.join(' ')}`, command, options);
}

function tableInserted(result) {
  return result?.tables?.reduce((sum, table) => sum + (table.inserted || 0), 0) ?? 0;
}

function tableConflicts(result) {
  return result?.tables?.reduce((sum, table) => sum + (table.conflicts || 0), 0) ?? 0;
}

function changedTables(result) {
  return (result?.tables ?? [])
    .map((table) => ({
      table: table.table,
      inserted: table.inserted,
      updated: table.updated,
      skipped: table.skipped,
      conflicts: table.conflicts,
    }))
    .filter((table) => table.inserted || table.updated || table.conflicts);
}

function openWikiConflict(payload) {
  const conflict = payload.conflicts?.find((entry) => entry.status === 'open' && entry.entity_kind === 'wiki_pages');
  if (!conflict) throw new Error(`No open wiki_pages conflict found: ${JSON.stringify(payload).slice(0, 1200)}`);
  return conflict;
}

function assertArtifactDoctor(doctor, label) {
  const manifest = doctor.storage?.artifact_manifest;
  if (!doctor.ok) throw new Error(`${label}: sync doctor not ok`);
  if (doctor.open_files?.raw_payload_sentinel_hits !== 0) throw new Error(`${label}: raw open-files payload sentinel hits detected`);
  if (!manifest?.ok) throw new Error(`${label}: artifact manifest not ok`);
  if (!manifest.sync_manifest?.portable_keys) throw new Error(`${label}: artifact manifest does not use portable keys`);
  if (!manifest.sync_manifest?.tracks_modified_time) throw new Error(`${label}: artifact manifest does not track modified time`);
  if (!manifest.sync_manifest?.preserves_provenance) throw new Error(`${label}: artifact manifest does not preserve provenance`);
  if (manifest.sync_manifest?.includes_raw_source_bytes) throw new Error(`${label}: artifact manifest includes raw source bytes`);
  if ((manifest.modified_time?.missing_modified_at ?? 0) !== 0) throw new Error(`${label}: artifact manifest is missing modified_at metadata`);
  if ((manifest.provenance?.missing_provenance ?? 0) !== 0) throw new Error(`${label}: artifact manifest is missing provenance metadata`);
  if ((manifest.provenance?.artifact_key_mismatches ?? 0) !== 0) throw new Error(`${label}: artifact manifest provenance key mismatch`);
}

function forceRemoteWikiConflict(remote, cwd) {
  const code = [
    'import { Database } from "bun:sqlite";',
    'const db = new Database(".hasna/apps/knowledge/knowledge.db");',
    'db.run("UPDATE wiki_pages SET title = ?, updated_at = ? WHERE path = ?", ["Spark01 edited Wiki", "2026-06-09T16:00:00.000Z", "wiki/README.md"]);',
    'db.close();',
  ].join(' ');
  runRemote(remote, `cd ${shellQuote(cwd)} && bun -e ${shellQuote(code)}`);
}

function assertSyncSmokeExpectations(summary, expectations, label) {
  if (!expectations) return;
  const route = summary.doctor_before.route;
  const workspace = summary.doctor_before.workspace;
  if (expectations.routeSource && route?.source !== expectations.routeSource) {
    throw new Error(`${label}: expected route source ${expectations.routeSource}, got ${route?.source}`);
  }
  if (expectations.routeAdapterImplementation && route?.adapter?.implementation !== expectations.routeAdapterImplementation) {
    throw new Error(`${label}: expected route adapter ${expectations.routeAdapterImplementation}, got ${route?.adapter?.implementation}`);
  }
  if (expectations.routeAdapterAvailable !== undefined && route?.adapter?.available !== expectations.routeAdapterAvailable) {
    throw new Error(`${label}: expected route adapter available=${expectations.routeAdapterAvailable}, got ${route?.adapter?.available}`);
  }
  if (expectations.routeAdapterError && route?.adapter?.error !== expectations.routeAdapterError) {
    throw new Error(`${label}: expected route adapter error ${expectations.routeAdapterError}, got ${route?.adapter?.error}`);
  }
  if (expectations.workspaceSource && workspace?.source !== expectations.workspaceSource) {
    throw new Error(`${label}: expected workspace source ${expectations.workspaceSource}, got ${workspace?.source}`);
  }
  if (expectations.workspaceAdapterError && workspace?.adapter?.error !== expectations.workspaceAdapterError) {
    throw new Error(`${label}: expected workspace adapter error ${expectations.workspaceAdapterError}, got ${workspace?.adapter?.error}`);
  }
}

function runSyncSmoke(options, runOptions = {}) {
  const localDir = mkdtempSync(join(tmpdir(), `knowledge-spark02-${options.knowledgeVersion}-`));
  const remoteDir = runRemote(options.remote, `mktemp -d ${shellQuote(`/tmp/knowledge-spark01-${options.knowledgeVersion}-XXXXXX`)}`).trim();
  const localCommandOptions = runOptions.localCommandOptions ?? {};
  try {
    knowledgeJson(localDir, ['db', 'init', '--scope', 'project', '--json'], localCommandOptions);
    knowledgeJson(localDir, ['wiki', 'init', '--scope', 'project', '--json'], localCommandOptions);
    const sourcePath = join(localDir, 'spark-sync-source.md');
    writeFileSync(sourcePath, `Spark installed sync convergence fixture from spark02 to ${options.remote}.\n`);
    knowledgeJson(localDir, ['ingest', 'source', `file://${sourcePath}`, '--scope', 'project', '--json'], localCommandOptions);
    remoteKnowledgeJson(options.remote, remoteDir, ['db', 'init', '--scope', 'project', '--json']);

    const doctorBefore = knowledgeJson(localDir, ['sync', 'doctor', '--scope', 'project', '--machine', options.peer, '--peer-workspace', remoteDir, '--json'], localCommandOptions);
    const initialDryRun = knowledgeJson(localDir, ['sync', 'dry-run', '--scope', 'project', '--machine', options.peer, '--peer-workspace', remoteDir, '--json'], localCommandOptions);
    const push = knowledgeJson(localDir, ['sync', 'push', '--scope', 'project', '--machine', options.peer, '--peer-workspace', remoteDir, '--json'], localCommandOptions);
    const remoteDoctor = remoteKnowledgeJson(options.remote, remoteDir, ['sync', 'doctor', '--scope', 'project', '--json']);
    const afterPushDryRun = knowledgeJson(localDir, ['sync', 'dry-run', '--scope', 'project', '--machine', options.peer, '--peer-workspace', remoteDir, '--json'], localCommandOptions);

    assertArtifactDoctor(remoteDoctor, 'remote after push');

    forceRemoteWikiConflict(options.remote, remoteDir);
    const conflictPush = knowledgeJson(localDir, ['sync', 'push', '--scope', 'project', '--machine', options.peer, '--peer-workspace', remoteDir, '--json'], localCommandOptions);
    const remoteConflicts = remoteKnowledgeJson(options.remote, remoteDir, ['sync', 'conflicts', '--scope', 'project', '--json']);
    const remoteConflict = openWikiConflict(remoteConflicts);
    const remoteProposal = remoteKnowledgeJson(options.remote, remoteDir, ['sync', 'conflicts', 'propose', remoteConflict.id, '--mode', 'ai', '--fake', '--scope', 'project', '--json']);
    const remoteResolution = remoteKnowledgeJson(options.remote, remoteDir, [
      'sync', 'conflicts', 'resolve', remoteConflict.id,
      '--approve-write',
      '--approved-by', 'spark-smoke',
      '--strategy', 'manual-merge',
      '--patch-uri', 'file:///tmp/spark-smoke.patch',
      '--scope', 'project',
      '--json',
    ]);

    const pullConflict = knowledgeJson(localDir, ['sync', 'pull', '--scope', 'project', '--machine', options.peer, '--peer-workspace', remoteDir, '--json'], localCommandOptions);
    const localConflicts = knowledgeJson(localDir, ['sync', 'conflicts', '--scope', 'project', '--json'], localCommandOptions);
    const localConflict = openWikiConflict(localConflicts);
    const localProposal = knowledgeJson(localDir, ['sync', 'conflicts', 'propose', localConflict.id, '--mode', 'ai', '--fake', '--scope', 'project', '--json'], localCommandOptions);
    const localResolution = knowledgeJson(localDir, [
      'sync', 'conflicts', 'resolve', localConflict.id,
      '--approve-write',
      '--approved-by', 'spark-smoke',
      '--strategy', 'manual-merge',
      '--patch-uri', 'file:///tmp/spark-smoke-local.patch',
      '--scope', 'project',
      '--json',
    ], localCommandOptions);
    const finalDryRun = knowledgeJson(localDir, ['sync', 'dry-run', '--scope', 'project', '--machine', options.peer, '--peer-workspace', remoteDir, '--json'], localCommandOptions);

    const summary = {
      scenario: runOptions.scenario ?? 'default',
      local_dir: localDir,
      remote_dir: remoteDir,
      doctor_before: {
        ok: doctorBefore.ok,
        route: doctorBefore.resolved_route,
        workspace: doctorBefore.resolved_workspace,
      },
      initial_dry_run: {
        ok: initialDryRun.ok,
        inserted: tableInserted(initialDryRun.push),
        conflicts: initialDryRun.push?.conflicts_created ?? tableConflicts(initialDryRun.push),
      },
      push: {
        ok: push.ok,
        inserted: tableInserted(push.push),
        artifacts: push.push?.artifacts,
        conflicts: push.push?.conflicts_created ?? tableConflicts(push.push),
        route: push.resolved_route,
        workspace: push.resolved_workspace,
      },
      remote_doctor: {
        ok: remoteDoctor.ok,
        raw_payload_sentinel_hits: remoteDoctor.open_files.raw_payload_sentinel_hits,
        artifact_manifest: remoteDoctor.storage.artifact_manifest,
      },
      after_push_dry_run: {
        ok: afterPushDryRun.ok,
        inserted: tableInserted(afterPushDryRun.push),
        conflicts: afterPushDryRun.push?.conflicts_created ?? tableConflicts(afterPushDryRun.push),
      },
      remote_conflict: {
        push_ok: conflictPush.ok,
        conflicts_created: conflictPush.push?.conflicts_created,
        tables: changedTables(conflictPush.push),
        conflict_id: remoteConflict.id,
        proposal_mode: remoteProposal.mode,
        proposal_agent_generated: remoteProposal.agent?.generated === true,
        proposal_tools: remoteProposal.agent?.read_only_tools?.map((tool) => tool.name) ?? [],
        resolution_ok: remoteResolution.ok,
        resolution_status: remoteResolution.conflict?.status,
      },
      local_conflict: {
        pull_ok: pullConflict.ok,
        conflicts_created: pullConflict.pull?.conflicts_created,
        tables: changedTables(pullConflict.pull),
        conflict_id: localConflict.id,
        proposal_mode: localProposal.mode,
        proposal_agent_generated: localProposal.agent?.generated === true,
        proposal_tools: localProposal.agent?.read_only_tools?.map((tool) => tool.name) ?? [],
        resolution_ok: localResolution.ok,
        resolution_status: localResolution.conflict?.status,
      },
      final_dry_run: {
        ok: finalDryRun.ok,
        message: finalDryRun.message,
        pull: {
          ok: finalDryRun.pull?.ok,
          inserted: tableInserted(finalDryRun.pull),
          conflicts_created: finalDryRun.pull?.conflicts_created,
          tables: changedTables(finalDryRun.pull),
        },
        push: {
          ok: finalDryRun.push?.ok,
          inserted: tableInserted(finalDryRun.push),
          conflicts_created: finalDryRun.push?.conflicts_created,
          tables: changedTables(finalDryRun.push),
        },
      },
    };

    if (!initialDryRun.ok || (summary.initial_dry_run.conflicts ?? 0) !== 0) throw new Error('Initial dry-run failed or found conflicts.');
    if (!push.ok || (summary.push.conflicts ?? 0) !== 0 || push.push?.artifacts?.copied !== 4) throw new Error('Initial push failed or did not copy generated artifacts.');
    if (!afterPushDryRun.ok || summary.after_push_dry_run.inserted !== 0 || (summary.after_push_dry_run.conflicts ?? 0) !== 0) throw new Error('After-push dry-run did not converge.');
    if (conflictPush.ok !== false || conflictPush.push?.conflicts_created !== 1) throw new Error('Remote forced conflict was not detected.');
    if (remoteProposal.mode !== 'ai' || remoteProposal.agent?.generated !== true) throw new Error('Remote fake AI proposal did not run.');
    if (!remoteResolution.ok || remoteResolution.conflict?.status !== 'resolved') throw new Error('Remote conflict resolution failed.');
    if (pullConflict.ok !== false || pullConflict.pull?.conflicts_created !== 1) throw new Error('Local forced conflict was not detected.');
    if (localProposal.mode !== 'ai' || localProposal.agent?.generated !== true) throw new Error('Local fake AI proposal did not run.');
    if (!localResolution.ok || localResolution.conflict?.status !== 'resolved') throw new Error('Local conflict resolution failed.');
    if (!finalDryRun.ok || finalDryRun.pull?.conflicts_created !== 0 || finalDryRun.push?.conflicts_created !== 0) throw new Error('Final bidirectional dry-run did not converge.');
    assertSyncSmokeExpectations(summary, runOptions.expect, runOptions.scenario ?? 'sync smoke');

    return summary;
  } finally {
    if (!options.keepTemp) {
      rmSync(localDir, { recursive: true, force: true });
      run('ssh', [options.remote, `rm -rf ${shellQuote(remoteDir)}`]);
    }
  }
}

function runNoMachinesSyncSmoke(options, dirs) {
  const runner = createNoMachinesKnowledgeRunner(dirs);
  try {
    const probeDir = mkdtempSync(join(tmpdir(), `knowledge-no-machines-probe-${options.knowledgeVersion}-`));
    let probe;
    try {
      probe = knowledgeJson(probeDir, ['machines', 'topology', '--no-tailscale', '--json'], { env: runner.env });
    } finally {
      if (!options.keepTemp) rmSync(probeDir, { recursive: true, force: true });
    }
    if (probe.adapter?.implementation !== 'disabled' || probe.adapter?.available !== false) {
      throw new Error(`no-machines probe did not disable adapter: ${JSON.stringify(probe.adapter)}`);
    }
    const sync = runSyncSmoke(options, {
      scenario: 'no-machines',
      localCommandOptions: { env: runner.env },
      expect: {
        routeSource: 'raw',
        routeAdapterImplementation: 'disabled',
        routeAdapterAvailable: false,
        workspaceSource: 'argument',
        workspaceAdapterError: 'argument_override',
      },
    });
    return {
      runner_app_dir: options.keepTemp ? runner.app_dir : null,
      shadowed_machines_package: options.keepTemp ? runner.shadowed_machines_package : null,
      local_path: runner.env.PATH,
      hidden_sdk: true,
      hidden_cli: true,
      adapter_probe: {
        source: probe.source,
        adapter: probe.adapter,
        warnings: probe.warnings,
      },
      sync,
    };
  } finally {
    if (!options.keepTemp) rmSync(runner.app_dir, { recursive: true, force: true });
  }
}

function dryRunSummary(options) {
  return {
    ok: true,
    dry_run: true,
    remote: options.remote,
    peer: options.peer,
    install: options.install,
    install_machines: options.installMachines,
    no_machines_sync: options.noMachinesSync,
    knowledge_version: options.knowledgeVersion,
    machines_version: options.installMachines ? options.machinesVersion : null,
    checks: [
      'install @hasna/knowledge on local and remote',
      'install @hasna/machines on local and remote when enabled',
      'verify local and remote knowledge --version',
      'run knowledge machines adapter smoke locally and remotely',
      'run machines consumer conformance locally and remotely when available',
      'run sync doctor before sync and after remote import',
      'assert artifact manifest modified_at/provenance/raw-source boundary',
      'run dry-run, push, follow-up dry-run',
      'force conflicts in both directions',
      'run fake AI conflict proposals and approval-gated resolutions',
      'assert final bidirectional dry-run has zero conflicts',
      'run isolated installed-package sync with @hasna/machines and machines CLI hidden',
    ],
  };
}

function markdownEvidence(summary) {
  return [
    '# Spark Knowledge Sync Release Smoke',
    '',
    `- ok: ${summary.ok}`,
    `- knowledge version: ${summary.versions?.local ?? summary.knowledge_version}`,
    `- machines version: ${summary.versions?.machines_local ?? summary.machines_version ?? 'unknown'}`,
    `- remote: ${summary.remote}`,
    `- peer: ${summary.peer}`,
    `- route: ${summary.sync?.push?.route?.route ?? 'n/a'} ${summary.sync?.push?.route?.target ?? ''}`.trim(),
    `- initial push inserted: ${summary.sync?.push?.inserted ?? 'n/a'}`,
    `- artifacts copied: ${summary.sync?.push?.artifacts?.copied ?? 'n/a'}`,
    `- final dry-run ok: ${summary.sync?.final_dry_run?.ok ?? 'n/a'}`,
    `- final pull conflicts: ${summary.sync?.final_dry_run?.pull?.conflicts_created ?? 'n/a'}`,
    `- final push conflicts: ${summary.sync?.final_dry_run?.push?.conflicts_created ?? 'n/a'}`,
    `- no-machines sync ok: ${summary.no_machines_sync?.sync?.final_dry_run?.ok ?? summary.no_machines_sync?.skipped ?? 'n/a'}`,
    '',
    '```json',
    JSON.stringify(summary, null, 2),
    '```',
    '',
  ].join('\n');
}

function outputSummary(summary, options) {
  if (options.evidenceJson) writeFileSync(options.evidenceJson, `${JSON.stringify(summary, null, 2)}\n`);
  if (options.evidenceMd) writeFileSync(options.evidenceMd, markdownEvidence(summary));
  if (options.json) console.log(JSON.stringify(summary, null, 2));
  else {
    console.log([
      `spark sync release smoke: ${summary.ok ? 'ok' : 'failed'}`,
      `knowledge: ${summary.versions?.local ?? summary.knowledge_version}`,
      `remote: ${summary.remote}`,
      `final dry-run: ${summary.sync?.final_dry_run?.ok ?? summary.dry_run}`,
    ].join('\n'));
  }
}

function main() {
  const options = parseArgs(process.argv.slice(2));
  if (options.dryRun) {
    outputSummary(dryRunSummary(options), options);
    return;
  }

  const install = installPackages(options);
  const dirs = packageDirs(options);
  const versions = {
    local: commandVersion('knowledge'),
    remote: remoteCommandVersion(options.remote, 'knowledge'),
    machines_local: commandVersion('machines'),
    machines_remote: remoteCommandVersion(options.remote, 'machines'),
  };
  const expectedKnowledgeVersion = `@hasna/knowledge ${options.knowledgeVersion}`;
  if (versions.local !== expectedKnowledgeVersion || versions.remote !== expectedKnowledgeVersion) {
    throw new Error(`Knowledge version mismatch: ${JSON.stringify(versions)}`);
  }

  const adapter_smoke = runAdapterSmoke({ remote: options.remote, peer: options.peer, dirs });
  const machines_conformance = runConsumerConformance({ remote: options.remote, dirs });
  const sync = runSyncSmoke(options);
  const no_machines_sync = options.noMachinesSync
    ? runNoMachinesSyncSmoke(options, dirs)
    : { skipped: true, reason: 'skip_no_machines_sync' };
  const summary = {
    ok: true,
    generated_at: new Date().toISOString(),
    remote: options.remote,
    peer: options.peer,
    install,
    package_dirs: dirs,
    versions,
    adapter_smoke,
    machines_conformance,
    sync,
    no_machines_sync,
  };
  outputSummary(summary, options);
}

main();
