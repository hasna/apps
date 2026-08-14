#!/usr/bin/env bun

import { spawnSync } from "node:child_process";
import {
  chmodSync,
  cpSync,
  existsSync,
  mkdirSync,
  mkdtempSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, relative, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const repoRoot = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const systemPath = "/usr/local/sbin:/usr/local/bin:/usr/sbin:/usr/bin:/sbin:/bin";
const runtimeBinPath = dirname(process.execPath);
const supportedContractVersion = 1;

function defaultCliCommand() {
  const builtCli = join(repoRoot, "dist", "cli", "index.js");
  return existsSync(builtCli) ? builtCli : "machines";
}

function parseArgs(argv) {
  const options = {
    json: false,
    keepTemp: false,
    packageDir: process.env.MACHINES_PACKAGE_DIR || repoRoot,
    cliCommand: process.env.MACHINES_CLI_COMMAND || defaultCliCommand(),
  };
  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i];
    if (arg === "--json") options.json = true;
    else if (arg === "--keep-temp") options.keepTemp = true;
    else if (arg === "--package-dir") {
      options.packageDir = argv[i + 1];
      i += 1;
    } else if (arg === "--cli-command") {
      options.cliCommand = argv[i + 1];
      i += 1;
    } else if (arg === "--help" || arg === "-h") {
      console.log([
        "Usage: bun scripts/consumer-conformance.mjs [--json] [--package-dir <path>] [--cli-command <command>]",
        "",
        "Verifies downstream app dependency shapes for @hasna/machines:",
        "  sdk-local: @hasna/machines/consumer is importable and emits v1 envelopes",
        "  sdk-local also validates schema artifacts and builds resolver snapshots",
        "  future-contract-sdk: fake v2 SDK is detected before route/workspace calls are trusted",
        "  global-cli-only: machines CLI JSON can be used when SDK is absent",
        "  no-sdk-no-cli: consumer can report graceful unavailable diagnostics",
      ].join("\n"));
      process.exit(0);
    } else {
      throw new Error(`Unknown argument: ${arg}`);
    }
  }
  return options;
}

function run(command, args, options = {}) {
  const result = spawnSync(command, args, {
    encoding: "utf8",
    env: process.env,
    ...options,
  });
  return {
    status: result.status ?? 1,
    stdout: result.stdout || "",
    stderr: result.stderr || "",
  };
}

function shellQuote(value) {
  return `'${value.replace(/'/g, "'\\''")}'`;
}

function resolveCommand(command) {
  if (command.includes("/")) return resolve(command);
  const result = run("bash", ["-lc", `command -v ${shellQuote(command)}`]);
  if (result.status !== 0) throw new Error(`Unable to resolve CLI command: ${command}`);
  return result.stdout.trim().split(/\r?\n/)[0];
}

function packagePath(root, packageName) {
  return join(root, ...packageName.split("/"));
}

function copyPackage(source, target) {
  if (!existsSync(source)) throw new Error(`Package source does not exist: ${source}`);
  const sourceRoot = resolve(source);
  const privateArtifactDir = `.${"takumi"}`;
  cpSync(source, target, {
    recursive: true,
    filter: (path) => {
      const normalized = relative(sourceRoot, path).replace(/\\/g, "/");
      if (!normalized) return true;
      return normalized !== "node_modules"
        && !normalized.startsWith("node_modules/")
        && normalized !== ".git"
        && !normalized.startsWith(".git/")
        && normalized !== ".hasna"
        && !normalized.startsWith(".hasna/")
        && normalized !== privateArtifactDir
        && !normalized.startsWith(`${privateArtifactDir}/`);
    },
  });
}

function createTempApp(name) {
  const appDir = mkdtempSync(join(tmpdir(), `machines-consumer-${name}-`));
  mkdirSync(join(appDir, "node_modules", "@hasna"), { recursive: true });
  return appDir;
}

function installPackage(appDir, sourceDir) {
  const target = packagePath(join(appDir, "node_modules"), "@hasna/machines");
  mkdirSync(dirname(target), { recursive: true });
  copyPackage(sourceDir, target);
}

// Hermeticity barrier: module resolution walks UP from the temp app dir, so an
// ambient node_modules in a parent directory (for example /tmp/node_modules
// containing @hasna/machines from unrelated work) would make the "SDK absent"
// cases resolve a real package. Install a tombstone that always fails to
// import so those cases stay deterministic regardless of ambient state.
function installUnavailableTombstone(appDir) {
  const target = packagePath(join(appDir, "node_modules"), "@hasna/machines");
  mkdirSync(target, { recursive: true });
  writeFileSync(join(target, "package.json"), JSON.stringify({
    name: "@hasna/machines",
    version: "0.0.0-unavailable",
    type: "module",
    exports: {
      ".": "./unavailable.mjs",
      "./consumer": "./unavailable.mjs",
    },
  }, null, 2));
  writeFileSync(join(target, "unavailable.mjs"), "throw new Error('machines_unavailable: @hasna/machines is not installed in this app');\n");
}

function installFutureContractPackage(appDir, version = 2) {
  const target = packagePath(join(appDir, "node_modules"), "@hasna/machines");
  mkdirSync(target, { recursive: true });
  writeFileSync(join(target, "package.json"), JSON.stringify({
    name: "@hasna/machines",
    version: `999.0.0-contract-v${version}`,
    type: "module",
    exports: {
      ".": "./consumer.mjs",
      "./consumer": "./consumer.mjs",
    },
  }, null, 2));
  writeFileSync(join(target, "consumer.mjs"), `
    export const MACHINES_CONSUMER_CONTRACT_VERSION = ${version};
    export const MACHINES_CONSUMER_CONTRACT = {
      schema_version: ${version},
      package_name: '@hasna/machines',
      entrypoint: '@hasna/machines/consumer',
      capabilities: {
        topology: true,
        compatibility: true,
        route_resolution: true,
        cli_json_fallback: true,
        workspace_path_mapping: true,
        workspace_diagnostics: true,
      },
      envelopes: ['topology', 'route', 'workspace', 'compatibility'],
      stable_exports: ['resolveMachineRoute', 'resolveMachineWorkspace', 'checkMachineCompatibility'],
    };
    export function resolveMachineRoute() {
      throw new Error('future route resolver should not be called by guarded consumers');
    }
    export function resolveMachineWorkspace() {
      throw new Error('future workspace resolver should not be called by guarded consumers');
    }
    export function checkMachineCompatibility() {
      throw new Error('future compatibility resolver should not be called by guarded consumers');
    }
  `);
}

function writeSdkProbe(appDir) {
  const script = join(appDir, "sdk-probe.mjs");
  writeFileSync(script, `
    import {
      MACHINES_CONSUMER_CONTRACT,
      MACHINES_CONSUMER_CONTRACT_VERSION,
      MACHINES_CONSUMER_SCHEMA_BUNDLE,
      checkMachineCompatibility,
      createMachineResolverSnapshot,
      discoverMachineTopology,
      getBrowserPlanFleet,
      getMachineDetails,
      listMachineProjectAssignments,
      listMachineTrashPolicies,
      resolveNoteMachineContext,
      validateMachinesConsumerEnvelope,
      resolveMachineRoute,
      resolveMachineWorkspace,
    } from '@hasna/machines/consumer';

    const topology = discoverMachineTopology({ includeTailscale: false, now: new Date('2026-06-09T00:00:00.000Z') });
    const route = resolveMachineRoute('local', { topology, now: new Date('2026-06-09T00:00:00.000Z') });
    const workspace = resolveMachineWorkspace({
      machineId: 'local',
      projectId: 'open-knowledge',
      repoName: 'open-knowledge',
      workspaceRoot: '/tmp/workspace',
      projectRoot: '/tmp/workspace/open-knowledge',
      openFilesRoot: '/tmp/workspace/open-files',
      topology,
      now: new Date('2026-06-09T00:00:00.000Z'),
    });
    const compatibility = checkMachineCompatibility({
      machineId: 'local',
      commands: [],
      packages: [],
      workspaces: [],
      now: new Date('2026-06-09T00:00:00.000Z'),
    });
    const projectAssignments = listMachineProjectAssignments({
      now: new Date('2026-06-09T00:00:00.000Z'),
    });
    const noteMachineContext = resolveNoteMachineContext({
      topology,
      originMachineId: 'consumer-conformance-local',
      sourceMachineId: 'consumer-conformance-local',
      actor: { actor_type: 'agent', agent_id: 'conformance-agent', agent_name: 'Conformance Agent', source: 'agent' },
      now: new Date('2026-06-09T00:00:00.000Z'),
    });
    const trashPolicies = listMachineTrashPolicies({
      topology,
      now: new Date('2026-06-09T00:00:00.000Z'),
    });
    const machineDetails = getMachineDetails('consumer-conformance-local', {
      topology,
      now: new Date('2026-06-09T00:00:00.000Z'),
    });
    const browserPlanFleet = getBrowserPlanFleet({
      topology,
      now: new Date('2026-06-09T00:00:00.000Z'),
    });
    const snapshot = createMachineResolverSnapshot({
      route,
      workspace,
      now: new Date('2026-06-09T00:00:00.000Z'),
    });

    console.log(JSON.stringify({
      source: 'sdk',
      supported: MACHINES_CONSUMER_CONTRACT_VERSION <= ${supportedContractVersion},
      contract_version: MACHINES_CONSUMER_CONTRACT_VERSION,
      entrypoint: MACHINES_CONSUMER_CONTRACT.entrypoint,
      schema_id: MACHINES_CONSUMER_SCHEMA_BUNDLE.$id,
      schema_artifact: MACHINES_CONSUMER_CONTRACT.schema_artifact,
      envelopes: MACHINES_CONSUMER_CONTRACT.envelopes,
      capabilities: MACHINES_CONSUMER_CONTRACT.capabilities,
      validation: {
        contract: validateMachinesConsumerEnvelope('contract', MACHINES_CONSUMER_CONTRACT).ok,
        topology: validateMachinesConsumerEnvelope('topology', topology).ok,
        route: validateMachinesConsumerEnvelope('route', route).ok,
        workspace: validateMachinesConsumerEnvelope('workspace', workspace).ok,
        compatibility: validateMachinesConsumerEnvelope('compatibility', compatibility).ok,
        resolver_snapshot: validateMachinesConsumerEnvelope('resolver_snapshot', snapshot).ok,
        project_assignments: validateMachinesConsumerEnvelope('project_assignments', projectAssignments).ok,
        note_machine_context: validateMachinesConsumerEnvelope('note_machine_context', noteMachineContext).ok,
        machine_trash_policies: validateMachinesConsumerEnvelope('machine_trash_policies', trashPolicies).ok,
        machine_details: validateMachinesConsumerEnvelope('machine_details', machineDetails).ok,
        browserplan_fleet: validateMachinesConsumerEnvelope('browserplan_fleet', browserPlanFleet).ok,
      },
      topology: { schema_version: topology.schema_version, machines: topology.machines.length, pagination: topology.pagination, first_display_name: topology.machines[0]?.display_name ?? null },
      route: { schema_version: route.schema_version, ok: route.ok, route: route.route, target: route.target, cacheable: route.cacheability.cacheable },
      workspace: { schema_version: workspace.schema_version, ok: workspace.ok, project_root: workspace.paths.project_root.path, cacheable: workspace.cacheability.cacheable },
      compatibility: { schema_version: compatibility.schema_version, ok: compatibility.ok },
      resolver_snapshot: { schema_version: snapshot.schema_version, cacheable: snapshot.cacheability.cacheable, authority: snapshot.cacheability.source_authority },
      project_assignments: { schema_version: projectAssignments.schema_version, count: projectAssignments.assignments.length },
      note_machine_context: { schema_version: noteMachineContext.schema_version, origin: noteMachineContext.origin_machine?.display_name ?? null, actor: noteMachineContext.actor.display_name },
      machine_trash_policies: { schema_version: trashPolicies.schema_version, count: trashPolicies.policies.length, pagination: trashPolicies.pagination },
      machine_details: { schema_version: machineDetails.schema_version, display_name: machineDetails.display_name, status: machineDetails.status.label },
      browserplan_fleet: {
        schema_version: browserPlanFleet.schema_version,
        target: browserPlanFleet.target.name,
        expected: browserPlanFleet.coverage.expected,
        returned: browserPlanFleet.coverage.returned,
        excluded: browserPlanFleet.target.install_target_excludes,
      },
    }));
  `);
  return script;
}

function writeFutureProbe(appDir) {
  const script = join(appDir, "future-probe.mjs");
  writeFileSync(script, `
    import {
      MACHINES_CONSUMER_CONTRACT,
      MACHINES_CONSUMER_CONTRACT_VERSION,
    } from '@hasna/machines/consumer';

    const supported = MACHINES_CONSUMER_CONTRACT_VERSION <= ${supportedContractVersion};
    console.log(JSON.stringify({
      source: 'sdk',
      supported,
      contract_version: MACHINES_CONSUMER_CONTRACT_VERSION,
      entrypoint: MACHINES_CONSUMER_CONTRACT.entrypoint,
      error: supported ? null : 'unsupported_contract_version:' + MACHINES_CONSUMER_CONTRACT_VERSION,
      trusted_envelopes: supported ? MACHINES_CONSUMER_CONTRACT.envelopes : [],
    }));
  `);
  return script;
}

function writeCliProbe(appDir) {
  const script = join(appDir, "cli-probe.mjs");
  writeFileSync(script, `
    import { spawnSync } from 'node:child_process';

    function run(args) {
      const result = spawnSync('machines', args, { encoding: 'utf8', env: process.env });
      if ((result.status ?? 1) !== 0) throw new Error(result.stderr || 'machines command failed');
      return JSON.parse(result.stdout);
    }

    const topology = run(['topology', '--no-tailscale', '--json']);
    const route = run(['route', '--machine', 'local', '--no-tailscale', '--json']);
    const browserPlanFleet = run(['browserplan', 'fleet', '--json']);
    console.log(JSON.stringify({
      source: 'cli',
      supported: true,
      topology: { schema_version: topology.schema_version, machines: topology.machines.length, pagination: topology.pagination },
      route: { schema_version: route.schema_version, ok: route.ok, route: route.route, target: route.target },
      browserplan_fleet: {
        schema_version: browserPlanFleet.schema_version,
        target: browserPlanFleet.target.name,
        expected: browserPlanFleet.coverage.expected,
        returned: browserPlanFleet.coverage.returned,
        excluded: browserPlanFleet.target.install_target_excludes,
      },
    }));
  `);
  return script;
}

function writeUnavailableProbe(appDir) {
  const script = join(appDir, "unavailable-probe.mjs");
  writeFileSync(script, `
    import { spawnSync } from 'node:child_process';

    let sdk = false;
    try {
      await import('@hasna/machines/consumer');
      sdk = true;
    } catch {
      sdk = false;
    }
    const cli = spawnSync('bash', ['-lc', 'command -v machines >/dev/null 2>&1'], {
      encoding: 'utf8',
      env: process.env,
    }).status === 0;
    console.log(JSON.stringify({
      source: 'unavailable',
      supported: false,
      sdk_available: sdk,
      cli_available: cli,
      error: sdk || cli ? null : 'machines_unavailable',
    }));
  `);
  return script;
}

function writeMachinesWrapper(binDir, command) {
  mkdirSync(binDir, { recursive: true });
  const wrapper = join(binDir, "machines");
  writeFileSync(wrapper, `#!/bin/sh\nexec ${JSON.stringify(command)} "$@"\n`);
  chmodSync(wrapper, 0o755);
  return wrapper;
}

function runNodeScript(script, appDir, env) {
  const result = run(process.execPath, [script], {
    cwd: appDir,
    env,
  });
  if (result.status !== 0) {
    throw new Error(`${script} failed\nstdout:\n${result.stdout}\nstderr:\n${result.stderr}`);
  }
  return JSON.parse(result.stdout);
}

function assertCase(name, output) {
  if (name === "sdk-local") {
    if (output.source !== "sdk" || output.contract_version !== 1 || output.supported !== true) {
      throw new Error(`${name}: invalid SDK output\n${JSON.stringify(output, null, 2)}`);
    }
    for (const envelope of ["topology", "route", "workspace", "compatibility"]) {
      if (!output.envelopes.includes(envelope)) throw new Error(`${name}: missing envelope ${envelope}`);
      if (output[envelope].schema_version !== 1) throw new Error(`${name}: ${envelope} schema mismatch`);
    }
    if (!output.envelopes.includes("resolver_snapshot") || output.resolver_snapshot.schema_version !== 1) {
      throw new Error(`${name}: missing resolver snapshot envelope\n${JSON.stringify(output, null, 2)}`);
    }
    for (const envelope of ["project_assignments", "note_machine_context", "machine_trash_policies", "machine_details", "browserplan_fleet"]) {
      if (!output.envelopes.includes(envelope) || output[envelope].schema_version !== 1) {
        throw new Error(`${name}: missing ${envelope} envelope\n${JSON.stringify(output, null, 2)}`);
      }
    }
    if (!output.topology.pagination || output.topology.pagination.limit !== 10) {
      throw new Error(`${name}: missing topology pagination contract\n${JSON.stringify(output, null, 2)}`);
    }
    if (!output.schema_artifact || !output.schema_id || !Object.values(output.validation).every(Boolean)) {
      throw new Error(`${name}: schema validation failed\n${JSON.stringify(output, null, 2)}`);
    }
  }
  if (name === "future-contract-sdk") {
    if (output.supported !== false || output.error !== "unsupported_contract_version:2" || output.trusted_envelopes.length !== 0) {
      throw new Error(`${name}: future contract was not rejected\n${JSON.stringify(output, null, 2)}`);
    }
  }
  if (name === "global-cli-only") {
    if (output.source !== "cli" || output.supported !== true || output.topology.schema_version !== 1 || output.route.schema_version !== 1) {
      throw new Error(`${name}: invalid CLI output\n${JSON.stringify(output, null, 2)}`);
    }
    if (!output.topology.pagination || output.topology.pagination.limit !== 10) {
      throw new Error(`${name}: missing CLI topology pagination\n${JSON.stringify(output, null, 2)}`);
    }
    if (!output.browserplan_fleet || output.browserplan_fleet.schema_version !== 1 || output.browserplan_fleet.expected !== 11) {
      throw new Error(`${name}: missing CLI BrowserPlan fleet contract\n${JSON.stringify(output, null, 2)}`);
    }
  }
  if (name === "no-sdk-no-cli") {
    if (output.sdk_available !== false || output.cli_available !== false || output.error !== "machines_unavailable") {
      throw new Error(`${name}: unavailable case did not degrade cleanly\n${JSON.stringify(output, null, 2)}`);
    }
  }
}

function runCase(input) {
  const appDir = createTempApp(input.name);
  try {
    if (input.installSdk) installPackage(appDir, input.packageDir);
    if (input.installFutureSdk) installFutureContractPackage(appDir, 2);
    if (!input.installSdk && !input.installFutureSdk) installUnavailableTombstone(appDir);
    const script = input.writeProbe(appDir);
    const env = {
      ...process.env,
      PATH: input.path,
      HASNA_MACHINES_DB_PATH: join(appDir, "machines.db"),
      HASNA_MACHINES_MANIFEST_PATH: join(appDir, "machines.json"),
      HASNA_MACHINES_MACHINE_ID: "consumer-conformance-local",
    };
    const output = runNodeScript(script, appDir, env);
    assertCase(input.name, output);
    return {
      name: input.name,
      ok: true,
      app_dir: input.keepTemp ? appDir : null,
      output,
    };
  } finally {
    if (!input.keepTemp) rmSync(appDir, { recursive: true, force: true });
  }
}

function main() {
  const options = parseArgs(process.argv.slice(2));
  const packageDir = resolve(options.packageDir);
  const cliCommand = resolveCommand(options.cliCommand);
  const cliBinDir = mkdtempSync(join(tmpdir(), "machines-consumer-cli-bin-"));
  const emptyPathDir = mkdtempSync(join(tmpdir(), "machines-consumer-empty-path-"));
  writeMachinesWrapper(cliBinDir, cliCommand);
  try {
    const cases = [
      {
        name: "sdk-local",
        installSdk: true,
        path: systemPath,
        writeProbe: writeSdkProbe,
      },
      {
        name: "future-contract-sdk",
        installFutureSdk: true,
        path: systemPath,
        writeProbe: writeFutureProbe,
      },
      {
        name: "global-cli-only",
        path: `${cliBinDir}:${runtimeBinPath}:${systemPath}`,
        writeProbe: writeCliProbe,
      },
      {
        name: "no-sdk-no-cli",
        path: emptyPathDir,
        writeProbe: writeUnavailableProbe,
      },
    ].map((entry) => ({
      ...entry,
      packageDir,
      keepTemp: options.keepTemp,
    }));

    const results = cases.map(runCase);
    const summary = {
      ok: true,
      package_dir: packageDir,
      cli_command: cliCommand,
      supported_contract_version: supportedContractVersion,
      cases: results,
    };
    if (options.json) console.log(JSON.stringify(summary, null, 2));
    else {
      console.log("machines consumer conformance: ok");
      for (const result of results) console.log(`- ${result.name}: ${result.output.source}/${result.output.supported ? "supported" : result.output.error}`);
    }
  } finally {
    if (!options.keepTemp) rmSync(cliBinDir, { recursive: true, force: true });
    if (!options.keepTemp) rmSync(emptyPathDir, { recursive: true, force: true });
  }
}

main();
