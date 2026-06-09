#!/usr/bin/env bun

import { spawnSync } from 'node:child_process';
import {
  cpSync,
  existsSync,
  chmodSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  symlinkSync,
  writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, relative, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const repoRoot = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const systemPath = '/usr/local/sbin:/usr/local/bin:/usr/sbin:/usr/bin:/sbin:/bin';

function parseArgs(argv) {
  const options = {
    json: false,
    keepTemp: false,
    packageDir: process.env.KNOWLEDGE_PACKAGE_DIR || repoRoot,
    machinesPackageDir: process.env.MACHINES_PACKAGE_DIR || null,
    peer: process.env.KNOWLEDGE_SMOKE_MACHINE || 'local',
  };
  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i];
    if (arg === '--json') options.json = true;
    else if (arg === '--keep-temp') options.keepTemp = true;
    else if (arg === '--package-dir') {
      options.packageDir = argv[i + 1];
      i += 1;
    } else if (arg === '--machines-package-dir') {
      options.machinesPackageDir = argv[i + 1];
      i += 1;
    } else if (arg === '--peer') {
      options.peer = argv[i + 1];
      i += 1;
    } else if (arg === '--help' || arg === '-h') {
      console.log([
        'Usage: bun scripts/smoke-machines-adapter.mjs [--json] [--package-dir <path>] [--machines-package-dir <path>] [--peer <machine>]',
        '',
        'Verifies installed-package machines adapter modes:',
        '  sdk-local: @hasna/knowledge and @hasna/machines available in temp app node_modules',
        '  global-cli-only: @hasna/knowledge local, @hasna/machines absent, global machines CLI on PATH',
        '  no-sdk-no-cli: @hasna/knowledge local, @hasna/machines absent, machines CLI absent from PATH',
      ].join('\n'));
      process.exit(0);
    } else {
      throw new Error(`Unknown argument: ${arg}`);
    }
  }
  return options;
}

function readJson(path) {
  return JSON.parse(readFileSync(path, 'utf8'));
}

function run(command, args, options = {}) {
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

function commandPath(command) {
  const result = run('bash', ['-lc', `command -v ${command}`]);
  return result.status === 0 ? result.stdout.trim().split(/\r?\n/)[0] : null;
}

function globalNodeModules() {
  const result = run(process.execPath, ['pm', 'bin', '-g']);
  if (result.status !== 0) throw new Error(`Unable to locate Bun global bin: ${result.stderr.trim()}`);
  const globalBin = result.stdout.trim();
  return resolve(globalBin, '..', 'install', 'global', 'node_modules');
}

function packagePath(root, packageName) {
  const parts = packageName.startsWith('@') ? packageName.split('/') : [packageName];
  return join(root, ...parts);
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
  const pkg = readJson(join(packageDir, 'package.json'));
  const deps = {
    ...(pkg.dependencies || {}),
    ...(pkg.peerDependencies || {}),
  };
  for (const dep of Object.keys(deps)) {
    if (exclude.has(dep)) continue;
    linkDependency(globalRoot, nodeModules, dep);
  }
}

function writeChildScript(appDir) {
  const path = join(appDir, 'adapter-smoke.mjs');
  writeFileSync(path, `
    import { createKnowledgeMachinesAdapter } from '@hasna/knowledge';

    const adapter = createKnowledgeMachinesAdapter({
      mode: process.env.KNOWLEDGE_ADAPTER_MODE,
      includeTailscale: false,
    });
    const status = await adapter.status();
    const route = await adapter.route({
      machineId: process.env.KNOWLEDGE_SMOKE_MACHINE || 'local',
      includeTailscale: false,
    });

    console.log(JSON.stringify({ status, route }));
  `);
  return path;
}

function createTempApp(input) {
  const appDir = mkdtempSync(join(tmpdir(), `knowledge-machines-${input.name}-`));
  const nodeModules = join(appDir, 'node_modules');
  const knowledgeTarget = packagePath(nodeModules, '@hasna/knowledge');
  mkdirSync(dirname(knowledgeTarget), { recursive: true });
  copyPackage(input.knowledgePackageDir, knowledgeTarget);
  linkPackageDependencies(input.knowledgePackageDir, input.globalRoot, nodeModules, new Set(['@hasna/machines']));

  if (input.includeMachinesPackage) {
    const machinesTarget = packagePath(nodeModules, '@hasna/machines');
    mkdirSync(dirname(machinesTarget), { recursive: true });
    copyPackage(input.machinesPackageDir, machinesTarget);
    linkPackageDependencies(input.machinesPackageDir, input.globalRoot, nodeModules);
  }

  const child = writeChildScript(appDir);
  return { appDir, child };
}

function writeMachinesWrapper(appDir, machinesBin) {
  const binDir = join(appDir, 'bin');
  mkdirSync(binDir, { recursive: true });
  const wrapper = join(binDir, 'machines');
  writeFileSync(wrapper, `#!/bin/sh\nexec '${process.execPath.replace(/'/g, "'\\''")}' '${machinesBin.replace(/'/g, "'\\''")}' "$@"\n`);
  chmodSync(wrapper, 0o755);
  return binDir;
}

function assertCase(name, output, expected) {
  const route = output.route || {};
  const adapter = route.adapter || {};
  if (expected.source && route.source !== expected.source) {
    throw new Error(`${name}: expected route.source=${expected.source}, got ${route.source}\n${JSON.stringify(output, null, 2)}`);
  }
  if (expected.implementation && adapter.implementation !== expected.implementation) {
    throw new Error(`${name}: expected adapter implementation=${expected.implementation}, got ${adapter.implementation}\n${JSON.stringify(output, null, 2)}`);
  }
  if (expected.available !== undefined && adapter.available !== expected.available) {
    throw new Error(`${name}: expected adapter available=${expected.available}, got ${adapter.available}\n${JSON.stringify(output, null, 2)}`);
  }
  if (expected.contractVersion !== undefined && adapter.contract_version !== expected.contractVersion) {
    throw new Error(`${name}: expected contract_version=${expected.contractVersion}, got ${adapter.contract_version}\n${JSON.stringify(output, null, 2)}`);
  }
}

function runCase(input) {
  const temp = createTempApp(input);
  try {
    const env = {
      ...process.env,
      PATH: input.path,
      NODE_PATH: '',
      KNOWLEDGE_ADAPTER_MODE: input.adapterMode,
      KNOWLEDGE_SMOKE_MACHINE: input.peer,
      HASNA_MACHINES_DB_PATH: join(temp.appDir, 'machines.db'),
      HASNA_MACHINES_MANIFEST_PATH: join(temp.appDir, 'machines.json'),
      HASNA_MACHINES_MACHINE_ID: 'adapter-smoke-local',
    };
    const result = run(process.execPath, [temp.child], {
      cwd: temp.appDir,
      env,
    });
    if (result.status !== 0) {
      throw new Error(`${input.name}: child process failed\nstdout:\n${result.stdout}\nstderr:\n${result.stderr}`);
    }
    const output = JSON.parse(result.stdout);
    assertCase(input.name, output, input.expected);
    return {
      name: input.name,
      ok: true,
      app_dir: input.keepTemp ? temp.appDir : null,
      route_source: output.route.source,
      adapter: output.route.adapter,
      status: output.status,
    };
  } finally {
    if (!input.keepTemp) rmSync(temp.appDir, { recursive: true, force: true });
  }
}

function main() {
  const options = parseArgs(process.argv.slice(2));
  const globalRoot = globalNodeModules();
  const knowledgePackageDir = resolve(options.packageDir);
  const machinesPackageDir = resolve(options.machinesPackageDir || packagePath(globalRoot, '@hasna/machines'));
  const machinesBin = commandPath('machines');
  if (!machinesBin) throw new Error('Global machines CLI is required for the global-cli-only smoke case.');

  const cliOnlyApp = mkdtempSync(join(tmpdir(), 'knowledge-machines-cli-path-'));
  const cliOnlyBin = writeMachinesWrapper(cliOnlyApp, machinesBin);
  const noCliApp = mkdtempSync(join(tmpdir(), 'knowledge-machines-no-cli-path-'));
  const noCliBin = join(noCliApp, 'bin');
  mkdirSync(noCliBin, { recursive: true });

  try {
    const cases = [
      {
        name: 'sdk-local',
        adapterMode: 'sdk',
        includeMachinesPackage: true,
        path: systemPath,
        expected: {
          source: 'open-machines',
          implementation: 'sdk',
          available: true,
          contractVersion: 1,
        },
      },
      {
        name: 'global-cli-only',
        adapterMode: 'cli',
        includeMachinesPackage: false,
        path: `${cliOnlyBin}:${systemPath}`,
        expected: {
          source: 'open-machines',
          implementation: 'cli',
          available: true,
        },
      },
      {
        name: 'no-sdk-no-cli',
        adapterMode: 'auto',
        includeMachinesPackage: false,
        path: noCliBin,
        expected: {
          source: 'raw',
          implementation: 'disabled',
          available: false,
        },
      },
    ].map((entry) => ({
      ...entry,
      peer: options.peer,
      keepTemp: options.keepTemp,
      globalRoot,
      knowledgePackageDir,
      machinesPackageDir,
    }));

    const results = cases.map(runCase);
    const summary = {
      ok: true,
      package_dir: knowledgePackageDir,
      machines_package_dir: machinesPackageDir,
      peer: options.peer,
      cases: results,
    };
    console.log(options.json ? JSON.stringify(summary, null, 2) : [
      'knowledge machines adapter smoke: ok',
      ...results.map((result) => `- ${result.name}: ${result.route_source}/${result.adapter.implementation}`),
    ].join('\n'));
  } finally {
    if (!options.keepTemp) rmSync(cliOnlyApp, { recursive: true, force: true });
    if (!options.keepTemp) rmSync(noCliApp, { recursive: true, force: true });
  }
}

main();
