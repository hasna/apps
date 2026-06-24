#!/usr/bin/env bun
import { existsSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, rmSync, statSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { basename, dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

type PackageJson = {
  name?: string;
  version?: string;
  bin?: Record<string, string>;
  dependencies?: Record<string, string>;
  optionalDependencies?: Record<string, string>;
  peerDependencies?: Record<string, string>;
};

type RepoSpec = {
  id: string;
  relativePath: string;
  packageName: string;
  requiredFiles: string[];
  importChecks: ImportCheck[];
  binChecks: BinCheck[];
  statusChecks: BinCheck[];
};

type ImportCheck = {
  id: string;
  specifier: string;
  assertion: string;
};

type BinCheck = {
  id: string;
  bin: string;
  args: string[];
  expect?: string;
  envProfile?: EnvProfile;
  allowExitCodes?: number[];
};

type EnvProfile = "computer" | "browser" | "machines" | "todos";

type CommandReport = {
  id: string;
  command: string;
  cwd: string;
  status: "passed" | "failed";
  exit_code: number | null;
  duration_ms: number;
  stdout_tail: string;
  stderr_tail: string;
};

type CommandExecution = CommandReport & {
  stdout: string;
  stderr: string;
};

type RepoReport = {
  id: string;
  path: string;
  package_name: string;
  version: string;
  packed_tarball: string | null;
  required_files: {
    checked: string[];
    missing: string[];
  };
  dependency_warnings: string[];
  installed_versions: InstalledPackage[];
};

type InstalledPackage = {
  name: string;
  version: string;
  path: string;
  top_level: boolean;
};

type PackedReport = {
  schema_version: "open-computer.packed-cross-repo-smoke.v1";
  generated_at: string;
  workspace_root: string;
  temp_app: string | null;
  options: {
    skip_build: boolean;
    keep_temp: boolean;
    strict_dependencies: boolean;
  };
  environment: {
    bun: string;
    node: string;
    platform: NodeJS.Platform;
    arch: string;
  };
  repos: RepoReport[];
  commands: CommandReport[];
  warnings: string[];
  failures: string[];
  summary: {
    status: "passed" | "failed";
    repos: number;
    packed: number;
    commands_passed: number;
    commands_failed: number;
    warnings: number;
    duration_ms: number;
  };
};

type Options = {
  help: boolean;
  keepTemp: boolean;
  skipBuild: boolean;
  strictDependencies: boolean;
  writePath: string | null;
};

const SCRIPT_DIR = dirname(fileURLToPath(import.meta.url));
const COMPUTER_ROOT = resolve(SCRIPT_DIR, "..");
const WORKSPACE_ROOT = resolve(COMPUTER_ROOT, "..");
const OUTPUT_TAIL_BYTES = 8_000;
const SERVER_TIMEOUT_EXIT = 124;

const REPOS: RepoSpec[] = [
  {
    id: "open-computer",
    relativePath: "open-computer",
    packageName: "@hasna/computer",
    requiredFiles: [
      "package/package.json",
      "package/dist/index.js",
      "package/dist/storage.js",
      "package/dist/cli/index.js",
      "package/dist/mcp/index.js",
      "package/dist/server/index.js",
      "package/src/db/migrations/001_initial.sql",
      "package/helpers/manifest.json",
      "package/dashboard/dist/index.html",
      "package/README.md",
      "package/LICENSE",
    ],
    importChecks: [
      {
        id: "computer-root-export",
        specifier: "@hasna/computer",
        assertion: "if (!m.runTask || !m.executeAction) throw new Error('missing root exports')",
      },
      {
        id: "computer-storage-export",
        specifier: "@hasna/computer/storage",
        assertion: "if (!m.getStorageStatus || !m.storagePush) throw new Error('missing storage exports')",
      },
    ],
    binChecks: [
      { id: "computer-version", bin: "computer", args: ["--version"], expect: "0.1." },
      { id: "computer-mcp-help", bin: "computer-mcp", args: ["--help"], expect: "Usage:" },
      { id: "computer-serve-help", bin: "computer-serve", args: ["--help"], expect: "Usage:" },
    ],
    statusChecks: [
      { id: "computer-storage-status", bin: "computer", args: ["storage", "status", "--json"], expect: "\"service\": \"computer\"", envProfile: "computer" },
      {
        id: "computer-installed-machine-smoke",
        bin: "computer",
        args: ["validate-machine", "--json", "--allow-failures", "--skip-screenshot"],
        expect: "open-computer.installed-machine-smoke.v1",
        envProfile: "computer",
      },
    ],
  },
  {
    id: "open-browser",
    relativePath: "open-browser",
    packageName: "@hasna/browser",
    requiredFiles: [
      "package/package.json",
      "package/dist/index.js",
      "package/dist/storage.js",
      "package/dist/video.js",
      "package/dist/extension.js",
      "package/dist/cli/index.js",
      "package/dist/mcp/index.js",
      "package/dist/server/index.js",
      "package/dashboard/dist/index.html",
      "package/extension/dist/manifest.json",
      "package/README.md",
      "package/LICENSE",
    ],
    importChecks: [
      {
        id: "browser-root-export",
        specifier: "@hasna/browser",
        assertion: "if (!m.createBrowserSDK || !m.BrowserSDK || !m.createSession) throw new Error('missing root exports')",
      },
      {
        id: "browser-storage-export",
        specifier: "@hasna/browser/storage",
        assertion: "if (!m.getStorageStatus || !m.storagePush) throw new Error('missing storage exports')",
      },
      {
        id: "browser-video-export",
        specifier: "@hasna/browser/video",
        assertion: "if (!m.resolveVideoRecordingPreset || !m.validateVideoOutput) throw new Error('missing video exports')",
      },
      {
        id: "browser-extension-export",
        specifier: "@hasna/browser/extension",
        assertion: "if (!m.createExtensionPage || !m.createExtensionPairing) throw new Error('missing extension exports')",
      },
    ],
    binChecks: [
      { id: "browser-version", bin: "browser", args: ["--version"], expect: "0.4." },
      { id: "browser-mcp-help", bin: "browser-mcp", args: ["--help"], expect: "Usage:" },
      { id: "browser-mcp-version", bin: "browser-mcp", args: ["--version"], expect: "0.4." },
    ],
    statusChecks: [
      { id: "browser-storage-status", bin: "browser", args: ["storage", "status", "--json"], expect: "\"service\": \"browser\"", envProfile: "browser" },
    ],
  },
  {
    id: "open-machines",
    relativePath: "open-machines",
    packageName: "@hasna/machines",
    requiredFiles: [
      "package/package.json",
      "package/dist/index.js",
      "package/dist/consumer.js",
      "package/dist/storage.js",
      "package/dist/cli/index.js",
      "package/dist/mcp/index.js",
      "package/dist/agent/index.js",
      "package/schemas/machines-consumer.schema.json",
      "package/scripts/consumer-conformance.mjs",
      "package/README.md",
      "package/LICENSE",
    ],
    importChecks: [
      {
        id: "machines-root-export",
        specifier: "@hasna/machines",
        assertion: "if (!m.getPackageVersion || !m.checkMachineCompatibility || !m.resolveMachineWorkspace) throw new Error('missing root exports')",
      },
      {
        id: "machines-consumer-export",
        specifier: "@hasna/machines/consumer",
        assertion: "if (!m.resolveMachineWorkspace || !m.MACHINES_CONSUMER_CONTRACT_VERSION) throw new Error('missing consumer exports')",
      },
      {
        id: "machines-storage-export",
        specifier: "@hasna/machines/storage",
        assertion: "if (!m.getStorageStatus || !m.storagePush) throw new Error('missing storage exports')",
      },
    ],
    binChecks: [
      { id: "machines-version", bin: "machines", args: ["--version"], expect: "0.0." },
      { id: "machines-help", bin: "machines", args: ["--help"], expect: "Usage:" },
      { id: "machines-mcp-version", bin: "machines-mcp", args: ["--version"], expect: "0.0." },
      { id: "machines-mcp-help", bin: "machines-mcp", args: ["--help"], expect: "Usage:" },
      { id: "machines-agent-version", bin: "machines-agent", args: ["--version"], expect: "0.0." },
      { id: "machines-agent-help", bin: "machines-agent", args: ["--help"], expect: "Usage:" },
    ],
    statusChecks: [
      { id: "machines-self-test", bin: "machines", args: ["self-test", "--json"], expect: "\"checks\"", envProfile: "machines" },
      { id: "machines-storage-status", bin: "machines", args: ["storage", "status", "--json"], expect: "\"mode\"", envProfile: "machines" },
    ],
  },
  {
    id: "open-todos",
    relativePath: "open-todos",
    packageName: "@hasna/todos",
    requiredFiles: [
      "package/package.json",
      "package/dist/index.js",
      "package/dist/sdk/index.js",
      "package/dist/mcp.js",
      "package/dist/registry.js",
      "package/dist/contracts.js",
      "package/dist/storage.js",
      "package/dist/cli/index.js",
      "package/dist/mcp/index.js",
      "package/dist/server/index.js",
      "package/dashboard/dist/index.html",
      "package/README.md",
      "package/LICENSE",
    ],
    importChecks: [
      {
        id: "todos-root-export",
        specifier: "@hasna/todos",
        assertion: "if (!m.TodosClient || !m.createClient || !m.TODOS_REGISTRY) throw new Error('missing root exports')",
      },
      {
        id: "todos-sdk-export",
        specifier: "@hasna/todos/sdk",
        assertion: "if (!m.TodosClient || !m.createClient || !m.TodosAPIError) throw new Error('missing sdk exports')",
      },
      {
        id: "todos-mcp-export",
        specifier: "@hasna/todos/mcp",
        assertion: "if (!m.createMcpManifest || !Array.isArray(m.getMcpToolNames())) throw new Error('missing mcp exports')",
      },
      {
        id: "todos-registry-export",
        specifier: "@hasna/todos/registry",
        assertion: "if (!m.createTodosRegistry || !Array.isArray(m.TODOS_PACKAGE_EXPORTS)) throw new Error('missing registry exports')",
      },
      {
        id: "todos-contracts-export",
        specifier: "@hasna/todos/contracts",
        assertion: "if (!m.createContractsManifest || !m.TODOS_CONTRACTS) throw new Error('missing contracts exports')",
      },
      {
        id: "todos-storage-export",
        specifier: "@hasna/todos/storage",
        assertion: "if (!m.createLocalSqliteTodosStorageAdapter || !Array.isArray(m.TODOS_STORAGE_TABLES)) throw new Error('missing storage exports')",
      },
    ],
    binChecks: [
      { id: "todos-version", bin: "todos", args: ["--version"], expect: "0.11." },
      { id: "todos-help", bin: "todos", args: ["--help"], expect: "Usage:" },
      { id: "todos-mcp-help", bin: "todos-mcp", args: ["--help"], expect: "Usage:" },
    ],
    statusChecks: [
      { id: "todos-storage-status", bin: "todos", args: ["storage", "status", "--json"], expect: "\"mode\"", envProfile: "todos" },
      { id: "todos-health", bin: "todos", args: ["health", "--json"], expect: "\"checks\"", envProfile: "todos" },
    ],
  },
];

async function main(): Promise<void> {
  const startedAt = Date.now();
  const options = parseArgs(process.argv.slice(2));
  if (options.help) {
    printHelp();
    return;
  }

  const tmp = mkdtempSync(join(tmpdir(), "open-computer-packed-cross-repo-"));
  const packsDir = join(tmp, "packs");
  const appDir = join(tmp, "app");
  const commands: CommandReport[] = [];
  const warnings: string[] = [];
  const failures: string[] = [];
  const repos: RepoReport[] = [];

  mkdirSync(packsDir, { recursive: true });

  try {
    const packageVersions = new Map<string, string>();
    const packageJsonByRepo = new Map<string, PackageJson>();
    for (const spec of REPOS) {
      const repoPath = resolve(WORKSPACE_ROOT, spec.relativePath);
      assert(existsSync(repoPath), `repository missing: ${repoPath}`);
      const packageJson = readJson<PackageJson>(join(repoPath, "package.json"));
      assert(packageJson.name === spec.packageName, `${spec.id} package name mismatch: expected ${spec.packageName}, got ${packageJson.name ?? "(missing)"}`);
      assert(typeof packageJson.version === "string" && packageJson.version.length > 0, `${spec.id} package version missing`);
      packageVersions.set(spec.packageName, packageJson.version);
      packageJsonByRepo.set(spec.id, packageJson);
    }

    if (!options.skipBuild) {
      for (const spec of REPOS) {
        const repoPath = resolve(WORKSPACE_ROOT, spec.relativePath);
        await runRequired(commands, `${spec.id}:build`, ["bun", "run", "build"], { cwd: repoPath, env: isolatedEnv(tmp, spec.id) });
      }
    }

    const tarballs: string[] = [];
    for (const spec of REPOS) {
      const repoPath = resolve(WORKSPACE_ROOT, spec.relativePath);
      const localPackageJson = packageJsonByRepo.get(spec.id)!;
      const tarball = await packRepo(commands, spec, repoPath, packsDir);
      const files = await listTarball(commands, spec.id, tarball);
      const missing = spec.requiredFiles.filter((file) => !files.includes(file));
      if (missing.length > 0) {
        throw new Error(`${spec.id} packed artifact missing required files: ${missing.join(", ")}`);
      }

      const packedPackageJson = await readPackedPackageJson(commands, spec.id, tarball);
      assert(packedPackageJson.name === spec.packageName, `${spec.id} packed package name mismatch`);
      assert(packedPackageJson.version === localPackageJson.version, `${spec.id} packed version mismatch`);

      const dependencyWarnings = getDependencyWarnings(spec, localPackageJson, packageVersions);
      warnings.push(...dependencyWarnings);
      repos.push({
        id: spec.id,
        path: repoPath,
        package_name: spec.packageName,
        version: localPackageJson.version!,
        packed_tarball: tarball,
        required_files: {
          checked: spec.requiredFiles,
          missing,
        },
        dependency_warnings: dependencyWarnings,
        installed_versions: [],
      });
      tarballs.push(tarball);
    }

    mkdirSync(appDir, { recursive: true });
    writeFileSync(join(appDir, "package.json"), `${JSON.stringify({ type: "module", private: true }, null, 2)}\n`);
    await runRequired(commands, "temp-app:npm-install", ["npm", "install", "--omit=dev", "--ignore-scripts", "--no-audit", "--no-fund", ...tarballs], {
      cwd: appDir,
      env: isolatedEnv(tmp, "install"),
    });

    const installedByName = collectTargetInstallations(appDir, REPOS.map((repo) => repo.packageName));
    for (const repo of repos) {
      const installed = installedByName.get(repo.package_name) ?? [];
      repo.installed_versions = installed;
      if (!installed.some((entry) => entry.top_level && entry.version === repo.version)) {
        throw new Error(`${repo.package_name}@${repo.version} is not installed at the temp app top level`);
      }
      const mismatched = installed.filter((entry) => entry.version !== repo.version);
      if (mismatched.length > 0) {
        const message = `${repo.package_name} has non-local nested install(s): ${mismatched.map((entry) => `${entry.version} at ${entry.path}`).join("; ")}`;
        if (options.strictDependencies) throw new Error(message);
        repo.dependency_warnings.push(message);
        warnings.push(message);
      }
    }

    await runImportChecks(commands, appDir);
    await runBinChecks(commands, appDir, tmp);
    await runStatusChecks(commands, appDir, tmp);
    await smokeComputerServe(commands, appDir, tmp);
    await smokeBrowserServe(commands, appDir, tmp);
    await smokeTodosServe(commands, appDir, tmp);
    await runMachinesConsumerConformance(commands, appDir, tmp);
  } catch (error) {
    failures.push(error instanceof Error ? error.message : String(error));
  } finally {
    const report = buildReport({
      startedAt,
      options,
      tempApp: appDir,
      repos,
      commands,
      warnings,
      failures,
    });
    const json = `${JSON.stringify(report, null, 2)}\n`;
    if (options.writePath) {
      mkdirSync(dirname(options.writePath), { recursive: true });
      writeFileSync(options.writePath, json);
    }
    process.stdout.write(json);
    if (!options.keepTemp) rmSync(tmp, { recursive: true, force: true });
  }

  if (failures.length > 0 || commands.some((command) => command.status === "failed")) {
    process.exit(1);
  }
}

async function packRepo(commands: CommandReport[], spec: RepoSpec, repoPath: string, packsDir: string): Promise<string> {
  const result = await runRequired(commands, `${spec.id}:npm-pack`, ["npm", "pack", "--json", "--pack-destination", packsDir], { cwd: repoPath });
  const parsed = JSON.parse(result.stdout) as Array<{ filename?: string }>;
  const filename = parsed[0]?.filename;
  assert(filename, `${spec.id} npm pack did not return a filename`);
  const tarball = join(packsDir, filename);
  assert(existsSync(tarball), `${spec.id} npm pack did not create ${tarball}`);
  return tarball;
}

async function listTarball(commands: CommandReport[], repoId: string, tarball: string): Promise<string[]> {
  const result = await runRequired(commands, `${repoId}:tar-list`, ["tar", "-tf", tarball]);
  return result.stdout.split("\n").map((line) => line.trim()).filter(Boolean);
}

async function readPackedPackageJson(commands: CommandReport[], repoId: string, tarball: string): Promise<PackageJson> {
  const result = await runRequired(commands, `${repoId}:packed-package-json`, ["tar", "-xOf", tarball, "package/package.json"]);
  return JSON.parse(result.stdout) as PackageJson;
}

function getDependencyWarnings(spec: RepoSpec, packageJson: PackageJson, versions: Map<string, string>): string[] {
  const warnings: string[] = [];
  const dependencyGroups = [
    packageJson.dependencies ?? {},
    packageJson.optionalDependencies ?? {},
    packageJson.peerDependencies ?? {},
  ];
  for (const dependencies of dependencyGroups) {
    for (const [name, range] of Object.entries(dependencies)) {
      const localVersion = versions.get(name);
      if (!localVersion) continue;
      if (range !== localVersion) {
        warnings.push(`${spec.id} declares ${name}@${range}; local tarball under test is ${localVersion}`);
      }
    }
  }
  return warnings;
}

async function runImportChecks(commands: CommandReport[], appDir: string): Promise<void> {
  for (const spec of REPOS) {
    for (const check of spec.importChecks) {
      await runRequired(
        commands,
        check.id,
        ["bun", "-e", `import(${JSON.stringify(check.specifier)}).then((m)=>{ ${check.assertion}; })`],
        { cwd: appDir },
      );
    }
  }
}

async function runBinChecks(commands: CommandReport[], appDir: string, tmp: string): Promise<void> {
  for (const spec of REPOS) {
    for (const check of spec.binChecks) {
      assertLocalBin(appDir, check.bin);
      await runRequired(commands, check.id, [binPath(appDir, check.bin), ...check.args], {
        cwd: appDir,
        expect: replaceVersionExpectation(check.expect, spec.packageName),
        env: isolatedEnv(tmp, check.envProfile ?? spec.id),
        allowExitCodes: check.allowExitCodes,
      });
    }
  }
}

async function runStatusChecks(commands: CommandReport[], appDir: string, tmp: string): Promise<void> {
  for (const spec of REPOS) {
    for (const check of spec.statusChecks) {
      assertLocalBin(appDir, check.bin);
      await runRequired(commands, check.id, [binPath(appDir, check.bin), ...check.args], {
        cwd: appDir,
        expect: check.expect,
        env: isolatedEnv(tmp, check.envProfile ?? spec.id),
        allowExitCodes: check.allowExitCodes,
      });
    }
  }
}

async function smokeComputerServe(commands: CommandReport[], appDir: string, tmp: string): Promise<void> {
  assertLocalBin(appDir, "computer-serve");
  const port = 19_450 + Math.floor(Math.random() * 400);
  const dataRoot = join(tmp, "computer-serve");
  const proc = Bun.spawn([binPath(appDir, "computer-serve")], {
    cwd: appDir,
    stdout: "pipe",
    stderr: "pipe",
    env: {
      ...process.env,
      ...isolatedEnv(dataRoot, "computer"),
      COMPUTER_HOST: "127.0.0.1",
      COMPUTER_PORT: String(port),
      COMPUTER_ALLOW_UNAUTHENTICATED: "1",
    },
  });
  const startedAt = Date.now();
  const stdout = new Response(proc.stdout).text();
  const stderr = new Response(proc.stderr).text();
  try {
    const response = await waitForHttpJson(`http://127.0.0.1:${port}/health`);
    assert(response.status === "ok" && response.name === "computer", `computer-serve health mismatch: ${JSON.stringify(response)}`);
    commands.push({
      id: "computer-serve-health",
      command: `${binPath(appDir, "computer-serve")} [health]`,
      cwd: appDir,
      status: "passed",
      exit_code: null,
      duration_ms: Date.now() - startedAt,
      stdout_tail: "",
      stderr_tail: "",
    });
  } catch (error) {
    commands.push({
      id: "computer-serve-health",
      command: `${binPath(appDir, "computer-serve")} [health]`,
      cwd: appDir,
      status: "failed",
      exit_code: null,
      duration_ms: Date.now() - startedAt,
      stdout_tail: "",
      stderr_tail: error instanceof Error ? error.message : String(error),
    });
    throw error;
  } finally {
    proc.kill();
    await proc.exited.catch(() => undefined);
    await Promise.all([stdout, stderr]).catch(() => undefined);
  }
}

async function smokeBrowserServe(commands: CommandReport[], appDir: string, tmp: string): Promise<void> {
  assertLocalBin(appDir, "browser-serve");
  const port = 19_700 + Math.floor(Math.random() * 400);
  const dataRoot = join(tmp, "browser-serve");
  const proc = Bun.spawn([binPath(appDir, "browser-serve")], {
    cwd: appDir,
    stdout: "pipe",
    stderr: "pipe",
    env: {
      ...process.env,
      ...isolatedEnv(dataRoot, "browser"),
      BROWSER_SERVER_PORT: String(port),
      BROWSER_ALLOW_UNAUTHENTICATED: "1",
    },
  });
  const startedAt = Date.now();
  const stdout = new Response(proc.stdout).text();
  const stderr = new Response(proc.stderr).text();
  try {
    const response = await waitForHttpJson(`http://127.0.0.1:${port}/health`);
    assert(response.status === "ok", `browser-serve health mismatch: ${JSON.stringify(response)}`);
    commands.push({
      id: "browser-serve-health",
      command: `${binPath(appDir, "browser-serve")} [health]`,
      cwd: appDir,
      status: "passed",
      exit_code: null,
      duration_ms: Date.now() - startedAt,
      stdout_tail: "",
      stderr_tail: "",
    });
  } catch (error) {
    commands.push({
      id: "browser-serve-health",
      command: `${binPath(appDir, "browser-serve")} [health]`,
      cwd: appDir,
      status: "failed",
      exit_code: null,
      duration_ms: Date.now() - startedAt,
      stdout_tail: "",
      stderr_tail: error instanceof Error ? error.message : String(error),
    });
    throw error;
  } finally {
    proc.kill();
    await proc.exited.catch(() => undefined);
    await Promise.all([stdout, stderr]).catch(() => undefined);
  }
}

async function smokeTodosServe(commands: CommandReport[], appDir: string, tmp: string): Promise<void> {
  assertLocalBin(appDir, "todos-serve");
  const port = 19_600 + Math.floor(Math.random() * 400);
  await runRequired(
    commands,
    "todos-serve-startup",
    ["timeout", "3", binPath(appDir, "todos-serve"), `--port=${port}`, "--host", "127.0.0.1", "--no-open"],
    {
      cwd: appDir,
      expect: "Todos Dashboard running at",
      env: isolatedEnv(tmp, "todos"),
      allowExitCodes: [0, SERVER_TIMEOUT_EXIT],
    },
  );
}

async function runMachinesConsumerConformance(commands: CommandReport[], appDir: string, tmp: string): Promise<void> {
  assertLocalBin(appDir, "machines");
  const scriptPath = join(appDir, "node_modules", "@hasna", "machines", "scripts", "consumer-conformance.mjs");
  assert(existsSync(scriptPath), "installed @hasna/machines missing consumer-conformance.mjs");
  await runRequired(commands, "machines-consumer-conformance", [
    "bun",
    scriptPath,
    "--package-dir",
    join(appDir, "node_modules", "@hasna", "machines"),
    "--cli-command",
    binPath(appDir, "machines"),
  ], {
    cwd: appDir,
    expect: "machines consumer conformance: ok",
    env: isolatedEnv(tmp, "machines"),
  });
}

async function waitForHttpJson(url: string): Promise<Record<string, unknown>> {
  const deadline = Date.now() + 5_000;
  let lastError: unknown;
  while (Date.now() < deadline) {
    try {
      const response = await fetch(url);
      if (response.ok) return await response.json() as Record<string, unknown>;
      lastError = new Error(`HTTP ${response.status}`);
    } catch (error) {
      lastError = error;
    }
    await Bun.sleep(100);
  }
  throw lastError instanceof Error ? lastError : new Error(`${url} timed out`);
}

async function runRequired(
  commands: CommandReport[],
  id: string,
  command: string[],
  options: { cwd?: string; env?: Record<string, string | undefined>; expect?: string; allowExitCodes?: number[] } = {},
): Promise<{ stdout: string; stderr: string; exitCode: number }> {
  const execution = await runCommand(id, command, options);
  const { stdout, stderr, ...report } = execution;
  commands.push(report);
  if (report.status !== "passed") {
    throw new Error(`Command failed: ${id}: ${report.command}\n${report.stdout_tail}\n${report.stderr_tail}`);
  }
  return {
    stdout,
    stderr,
    exitCode: report.exit_code ?? 0,
  };
}

async function runCommand(
  id: string,
  command: string[],
  options: { cwd?: string; env?: Record<string, string | undefined>; expect?: string; allowExitCodes?: number[] } = {},
): Promise<CommandExecution> {
  const startedAt = Date.now();
  const proc = Bun.spawn(command, {
    cwd: options.cwd,
    stdout: "pipe",
    stderr: "pipe",
    env: {
      ...process.env,
      ...options.env,
      CI: process.env.CI ?? "1",
    },
  });
  const [stdout, stderr, exitCode] = await Promise.all([
    new Response(proc.stdout).text(),
    new Response(proc.stderr).text(),
    proc.exited,
  ]);
  const allowed = options.allowExitCodes ?? [0];
  const outputMatches = !options.expect || stdout.includes(options.expect) || stderr.includes(options.expect);
  return {
    id,
    command: shellQuote(command),
    cwd: options.cwd ?? process.cwd(),
    status: allowed.includes(exitCode) && outputMatches ? "passed" : "failed",
    exit_code: exitCode,
    duration_ms: Date.now() - startedAt,
    stdout_tail: tail(stdout),
    stderr_tail: outputMatches ? tail(stderr) : tail(`${stderr}\nExpected output to include ${JSON.stringify(options.expect)}.`),
    stdout,
    stderr,
  };
}

function isolatedEnv(tmp: string, profile: string): Record<string, string> {
  const root = join(tmp, "env", profile);
  mkdirSync(root, { recursive: true });
  return {
    HOME: join(root, "home"),
    XDG_CONFIG_HOME: join(root, "config"),
    XDG_CACHE_HOME: join(root, "cache"),
    XDG_DATA_HOME: join(root, "data"),
    COMPUTER_DATA_DIR: join(root, "computer"),
    COMPUTER_DB_PATH: join(root, "computer", "computer.db"),
    COMPUTER_ALLOW_UNAUTHENTICATED: "1",
    BROWSER_DATA_DIR: join(root, "browser"),
    BROWSER_DB_PATH: join(root, "browser", "browser.db"),
    BROWSER_ALLOW_UNAUTHENTICATED: "1",
    BROWSER_STORAGE_MODE: "",
    HASNA_BROWSER_STORAGE_MODE: "",
    HASNA_MACHINES_DIR: join(root, "machines"),
    HASNA_MACHINES_DB_PATH: join(root, "machines", "machines.db"),
    HASNA_MACHINES_MANIFEST_PATH: join(root, "machines", "machines.json"),
    HASNA_MACHINES_NOTIFICATIONS_PATH: join(root, "machines", "notifications.json"),
    HASNA_MACHINES_MACHINE_ID: "packed-cross-repo-local",
    TODOS_DB_PATH: join(root, "todos", "todos.db"),
    HASNA_TODOS_DB_PATH: join(root, "todos", "todos.db"),
    HASNA_TODOS_ARTIFACTS_DIR: join(root, "todos", "artifacts"),
    TODOS_AUTO_PROJECT: "false",
    HASNA_TODOS_STORAGE_MODE: "",
    HASNA_TODOS_DATABASE_URL: "",
    TODOS_DATABASE_URL: "",
  };
}

function assertLocalBin(appDir: string, name: string): void {
  const path = binPath(appDir, name);
  assert(existsSync(path), `temp app missing local bin ${name}`);
  const stats = statSync(path);
  assert(stats.isFile() || stats.isSymbolicLink(), `temp app bin is not a file or symlink: ${path}`);
}

function binPath(appDir: string, name: string): string {
  return join(appDir, "node_modules", ".bin", name);
}

function replaceVersionExpectation(expectation: string | undefined, packageName: string): string | undefined {
  if (!expectation) return undefined;
  if (!expectation.endsWith(".")) return expectation;
  const spec = REPOS.find((repo) => repo.packageName === packageName);
  if (!spec) return expectation;
  const packageJson = readJson<PackageJson>(join(resolve(WORKSPACE_ROOT, spec.relativePath), "package.json"));
  return packageJson.version;
}

function collectTargetInstallations(appDir: string, names: string[]): Map<string, InstalledPackage[]> {
  const targets = new Set(names);
  const found = new Map<string, InstalledPackage[]>();
  const visited = new Set<string>();

  function walkPackageDir(packageDir: string): void {
    const nodeModules = join(packageDir, "node_modules");
    if (!existsSync(nodeModules) || visited.has(nodeModules)) return;
    visited.add(nodeModules);
    for (const packageDirEntry of listPackageDirs(nodeModules)) {
      const packageJsonPath = join(packageDirEntry, "package.json");
      if (existsSync(packageJsonPath)) {
        const packageJson = readJson<PackageJson>(packageJsonPath);
        if (packageJson.name && packageJson.version && targets.has(packageJson.name)) {
          const entries = found.get(packageJson.name) ?? [];
          entries.push({
            name: packageJson.name,
            version: packageJson.version,
            path: packageDirEntry,
            top_level: dirname(dirname(packageDirEntry)) === join(appDir, "node_modules"),
          });
          found.set(packageJson.name, entries);
        }
        walkPackageDir(packageDirEntry);
      }
    }
  }

  walkPackageDir(appDir);
  for (const entries of found.values()) {
    entries.sort((left, right) => left.path.localeCompare(right.path));
  }
  return found;
}

function listPackageDirs(nodeModules: string): string[] {
  const dirs: string[] = [];
  for (const entry of readdirSync(nodeModules, { withFileTypes: true })) {
    if (!entry.isDirectory() && !entry.isSymbolicLink()) continue;
    const entryPath = join(nodeModules, entry.name);
    if (entry.name.startsWith("@")) {
      for (const scoped of readdirSync(entryPath, { withFileTypes: true })) {
        if (scoped.isDirectory() || scoped.isSymbolicLink()) dirs.push(join(entryPath, scoped.name));
      }
    } else {
      dirs.push(entryPath);
    }
  }
  return dirs;
}

function buildReport(input: {
  startedAt: number;
  options: Options;
  tempApp: string | null;
  repos: RepoReport[];
  commands: CommandReport[];
  warnings: string[];
  failures: string[];
}): PackedReport {
  const commandsFailed = input.commands.filter((command) => command.status === "failed").length;
  return {
    schema_version: "open-computer.packed-cross-repo-smoke.v1",
    generated_at: new Date().toISOString(),
    workspace_root: WORKSPACE_ROOT,
    temp_app: input.options.keepTemp ? input.tempApp : null,
    options: {
      skip_build: input.options.skipBuild,
      keep_temp: input.options.keepTemp,
      strict_dependencies: input.options.strictDependencies,
    },
    environment: {
      bun: Bun.version,
      node: process.version,
      platform: process.platform,
      arch: process.arch,
    },
    repos: input.repos,
    commands: input.commands,
    warnings: input.warnings,
    failures: input.failures,
    summary: {
      status: input.failures.length === 0 && commandsFailed === 0 ? "passed" : "failed",
      repos: REPOS.length,
      packed: input.repos.filter((repo) => repo.packed_tarball).length,
      commands_passed: input.commands.filter((command) => command.status === "passed").length,
      commands_failed: commandsFailed,
      warnings: input.warnings.length,
      duration_ms: Date.now() - input.startedAt,
    },
  };
}

function parseArgs(args: string[]): Options {
  const options: Options = {
    help: false,
    keepTemp: false,
    skipBuild: false,
    strictDependencies: false,
    writePath: null,
  };
  for (let index = 0; index < args.length; index += 1) {
    const arg = args[index];
    if (arg === "--help" || arg === "-h") {
      options.help = true;
    } else if (arg === "--keep-temp") {
      options.keepTemp = true;
    } else if (arg === "--skip-build") {
      options.skipBuild = true;
    } else if (arg === "--strict-dependencies") {
      options.strictDependencies = true;
    } else if (arg === "--write") {
      const next = args[index + 1];
      if (!next) throw new Error("--write requires a path");
      options.writePath = resolve(next);
      index += 1;
    } else {
      throw new Error(`Unknown argument: ${arg}`);
    }
  }
  return options;
}

function printHelp(): void {
  console.log(`Usage: bun run scripts/verify-packed-cross-repo.ts [options]

Packs open-computer, open-browser, open-machines, and open-todos into tarballs,
installs them together in a clean temp app, imports key exports, runs local bins,
and smokes local-only status/server commands without global package CLIs.

Options:
  --skip-build             Reuse existing dist outputs instead of building each repo first.
  --strict-dependencies    Fail when nested target package versions differ from local tarballs.
  --write <path>           Write the JSON report to a file as well as stdout.
  --keep-temp              Keep the temp app and include its path in the report.
  -h, --help               Show this help text.
`);
}

function readJson<T>(path: string): T {
  return JSON.parse(readFileSync(path, "utf8")) as T;
}

function shellQuote(command: string[]): string {
  return command.map((part) => /^[A-Za-z0-9_./:=@-]+$/.test(part) ? part : JSON.stringify(part)).join(" ");
}

function tail(value: string): string {
  if (value.length <= OUTPUT_TAIL_BYTES) return value;
  return value.slice(value.length - OUTPUT_TAIL_BYTES);
}

function assert(condition: unknown, message: string): asserts condition {
  if (!condition) throw new Error(message);
}

main().catch((error) => {
  console.error(error instanceof Error ? error.stack ?? error.message : String(error));
  process.exit(1);
});
