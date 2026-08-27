import { spawn, spawnSync } from "node:child_process";
import { existsSync } from "node:fs";
import { mkdtemp, mkdir, readFile, rm, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";

type PackageJson = {
  name: string;
  types?: string;
  exports?: Record<string, unknown>;
};

type PackEntry = {
  filename: string;
  files: Array<{ path: string }>;
};

const root = process.cwd();

function normalizePackagePath(path: string): string {
  return path.replace(/^\.\//, "");
}

function run(command: string, args: string[], options: { cwd?: string } = {}): string {
  const result = spawnSync(command, args, {
    cwd: options.cwd ?? root,
    encoding: "utf8",
    stdio: ["ignore", "pipe", "pipe"],
  });

  if (result.status !== 0) {
    const rendered = [result.stdout, result.stderr].filter(Boolean).join("\n");
    throw new Error(`Command failed: ${command} ${args.join(" ")}\n${rendered}`);
  }

  return result.stdout;
}

async function readPackageJson(path: string): Promise<PackageJson> {
  return JSON.parse(await readFile(path, "utf8")) as PackageJson;
}

function collectExportTypes(value: unknown, paths: Set<string>): void {
  if (!value || typeof value !== "object" || Array.isArray(value)) return;
  const record = value as Record<string, unknown>;
  if (typeof record.types === "string") paths.add(normalizePackagePath(record.types));
  for (const nested of Object.values(record)) collectExportTypes(nested, paths);
}

function collectRequiredTypePaths(pkg: PackageJson): string[] {
  const paths = new Set<string>();
  if (pkg.types) paths.add(normalizePackagePath(pkg.types));
  if (pkg.exports) collectExportTypes(pkg.exports, paths);
  return [...paths].sort();
}

function assertPackedTypes(pkg: PackageJson, pack: PackEntry): void {
  const packedPaths = new Set(pack.files.map((file) => file.path));
  const missing = collectRequiredTypePaths(pkg).filter((path) => !packedPaths.has(path));

  if (missing.length > 0) {
    throw new Error(`Packed package is missing declaration files referenced by package.json: ${missing.join(", ")}`);
  }
}

function runTsc(args: string[], cwd: string): void {
  const tsc = join(root, "node_modules", ".bin", process.platform === "win32" ? "tsc.cmd" : "tsc");
  run(tsc, args, { cwd });
}

async function validateConsumerImports(pkg: PackageJson): Promise<void> {
  const tempRoot = join(root, "temp");
  await mkdir(tempRoot, { recursive: true });
  const workspace = await mkdtemp(join(tempRoot, "hasna-hooks-pack-"));
  try {
    const tarballJson = run("npm", ["pack", "--json", "--ignore-scripts", "--dry-run=false", "--pack-destination", workspace]);
    const [tarball] = JSON.parse(tarballJson) as PackEntry[];
    if (!tarball?.filename) throw new Error("npm pack did not return a tarball filename");

    const packageDir = join(workspace, "consumer", "node_modules", "@hasna", "hooks");
    await mkdir(packageDir, { recursive: true });
    run("tar", ["-xzf", join(workspace, tarball.filename), "-C", packageDir, "--strip-components=1"]);

    const consumerDir = join(workspace, "consumer");
    await writeFile(join(consumerDir, "package.json"), `${JSON.stringify({ type: "module" }, null, 2)}\n`);
    const consumerFile = join(consumerDir, "consumer.ts");
    await writeFile(
      consumerFile,
      [
        `import { HOOKS, type HookInput } from "${pkg.name}";`,
        `import { getStorageStatus, type StorageStatus } from "${pkg.name}/storage";`,
        "",
        "const input: HookInput = { cwd: process.cwd() };",
        "const hookCount: number = HOOKS.length;",
        "const status: StorageStatus = getStorageStatus();",
        "void input;",
        "void hookCount;",
        "void status;",
        "",
      ].join("\n"),
    );

    runTsc([
      "--noEmit",
      "--target",
      "ES2022",
      "--module",
      "ESNext",
      "--moduleResolution",
      "Bundler",
      "--skipLibCheck",
      "--strict",
      "--types",
      "bun-types",
      consumerFile,
    ], dirname(consumerFile));

    runTsc([
      "--noEmit",
      "--target",
      "ES2022",
      "--module",
      "NodeNext",
      "--moduleResolution",
      "NodeNext",
      "--strict",
      "--types",
      "bun-types",
      consumerFile,
    ], dirname(consumerFile));
  } finally {
    await rm(workspace, { force: true, recursive: true });
  }
}

async function main(): Promise<void> {
  const pkg = await readPackageJson(join(root, "package.json"));
  const packJson = run("npm", ["pack", "--dry-run", "--json", "--ignore-scripts"]);
  const [pack] = JSON.parse(packJson) as PackEntry[];
  if (!pack) throw new Error("npm pack --dry-run did not return package metadata");

  assertPackedTypes(pkg, pack);
  await validateConsumerImports(pkg);
  await validateExtractedSmoke(pkg);

  console.log("Package validation passed: packed declarations are present, Bundler/NodeNext TypeScript consumer imports resolve, and the extracted tarball smoke-tests CLI help, serve /health, MCP startup, SDK import and one bundled-hook run (P3-17).");
}

/**
 * P3-17: smoke-test the EXTRACTED tarball, not the source tree — a package
 * that builds and type-checks in-repo can still ship broken bins (wrong
 * output dir, missing files, unresolvable imports once the tarball layout
 * applies).
 *
 * Lanes: CLI help, serve /health, MCP stdio startup (initialize handshake),
 * a runtime SDK import, and one bundled-hook run with an isolated data dir.
 */
async function validateExtractedSmoke(pkg: PackageJson): Promise<void> {
  const tempRoot = join(root, "temp");
  await mkdir(tempRoot, { recursive: true });
  const workspace = await mkdtemp(join(tempRoot, "hasna-hooks-smoke-"));
  try {
    const tarballJson = run("npm", ["pack", "--json", "--ignore-scripts", "--pack-destination", workspace]);
    const [tarball] = JSON.parse(tarballJson) as PackEntry[];
    if (!tarball?.filename) throw new Error("npm pack did not return a tarball filename");

    const packageDir = join(workspace, "smoke", "node_modules", "@hasna", "hooks");
    await mkdir(packageDir, { recursive: true });
    run("tar", ["-xzf", join(workspace, tarball.filename), "-C", packageDir, "--strip-components=1"]);

    const smokeDir = join(workspace, "smoke");
    await writeFile(join(smokeDir, "package.json"), `${JSON.stringify({ type: "module" }, null, 2)}\n`);

    const dataDir = join(workspace, "data");
    const binIndex = join(packageDir, "bin", "index.js");
    const binServe = join(packageDir, "bin", "serve.js");
    const binMcp = join(packageDir, "bin", "mcp.js");
    if (!existsSync(binIndex)) throw new Error(`packed tarball is missing bin/index.js (CLI bin)`);
    if (!existsSync(binServe)) throw new Error(`packed tarball is missing bin/serve.js (serve bin)`);
    if (!existsSync(binMcp)) throw new Error(`packed tarball is missing bin/mcp.js (hooks-mcp bin)`);

    const env = {
      ...process.env,
      HASNA_HOOKS_DATA_DIR: dataDir,
      HASNA_HOOKS_DB_PATH: join(dataDir, "hooks.db"),
      NO_COLOR: "1",
    };

    // 1. CLI help.
    const help = spawnSync("bun", ["run", binIndex, "--help"], { cwd: smokeDir, env, encoding: "utf8" });
    if (help.status !== 0) throw new Error(`packed CLI --help failed: ${help.stderr}`);
    if (!/Usage:/.test(help.stdout)) throw new Error("packed CLI --help produced no usage output");

    // 2. serve /health on an ephemeral port.
    const port = 39000 + Math.floor(Math.random() * 1000);
    const serveProc = spawn("bun", ["run", binServe, "--port", String(port)], {
      cwd: smokeDir,
      env,
      stdio: ["ignore", "ignore", "pipe"],
    });
    try {
      let health: string | null = null;
      for (let attempt = 0; attempt < 40; attempt++) {
        const res = spawnSync("curl", ["-s", `http://127.0.0.1:${port}/health`], { encoding: "utf8", timeout: 3000 });
        if (res.status === 0 && res.stdout.includes("ok")) { health = res.stdout; break; }
        await new Promise((r) => setTimeout(r, 150));
      }
      if (!health) throw new Error(`packed serve /health did not respond on port ${port}`);
      const parsed = JSON.parse(health) as { name?: string };
      if (parsed.name !== "hooks-registry") throw new Error(`packed serve /health returned unexpected payload: ${health}`);
    } finally {
      serveProc.kill("SIGTERM");
      await new Promise((r) => setTimeout(r, 100));
    }

    // 3. MCP stdio startup from the STANDALONE hooks-mcp bin: an initialize
    // handshake must get a response (release-review P1-3: previously only
    // the `hooks mcp` CLI subcommand was smoked; the standalone bin must
    // work from the packed tarball too).
    const mcpProc = spawn("bun", ["run", binMcp, "--stdio"], {
      cwd: smokeDir,
      env,
      stdio: ["pipe", "pipe", "pipe"],
    });
    let mcpOk = false;
    try {
      mcpProc.stdin?.write(JSON.stringify({
        jsonrpc: "2.0",
        id: 1,
        method: "initialize",
        params: { protocolVersion: "2024-11-05", capabilities: {}, clientInfo: { name: "pack-smoke", version: "0.0.0" } },
      }) + "\n");
      const readTimeout = new Promise<string>((_, reject) => setTimeout(() => reject(new Error("MCP initialize timed out")), 8000));
      const out = await Promise.race([new Promise<string>((resolve) => {
        let acc = "";
        const onData = (chunk: Uint8Array) => {
          acc += new TextDecoder().decode(chunk);
          if (acc.includes('"result"')) resolve(acc);
        };
        mcpProc.stdout!.on("data", onData);
      }), readTimeout]);
      if (!out.includes('"result"')) throw new Error("MCP initialize handshake got no result");
      mcpOk = true;
    } finally {
      mcpProc.kill("SIGTERM");
      await new Promise((r) => setTimeout(r, 100));
    }
    if (!mcpOk) throw new Error("MCP startup smoke failed");

    // 4. Runtime SDK import from the extracted package. The index re-exports
    // storage, which loads the pg adapter, so pg must resolve: link it from
    // the workspace root (bun resolves the symlink target's realpath).
    const smokeNodeModules = join(smokeDir, "node_modules");
    await mkdir(smokeNodeModules, { recursive: true });
    try {
      await Bun.$`ln -sf ${join(root, "node_modules", "pg")} ${join(smokeNodeModules, "pg")}`.quiet();
    } catch {
      // pg link is best-effort; the import below will fail loudly if needed.
    }
    const sdkSmoke = join(smokeDir, "sdk-smoke.ts");
    await writeFile(sdkSmoke, `import { HOOKS, getStorageStatus } from "@hasna/hooks";\nimport { getStorageStatus as ss } from "@hasna/hooks/storage";\nimport { getStorageStatus as sdkSs } from "@hasna/hooks/sdk";\nconsole.log(JSON.stringify({ count: HOOKS.length, backend: getStorageStatus().backend, ss: ss().backend, sdk: sdkSs().backend }));\n`);
    const sdk = spawnSync("bun", ["run", sdkSmoke], { cwd: smokeDir, env, encoding: "utf8", timeout: 20000 });
    if (sdk.status !== 0) throw new Error(`packed SDK import failed: ${sdk.stderr}`);
    const sdkOut = JSON.parse(sdk.stdout.trim()) as { count: number; backend: string };
    if (typeof sdkOut.count !== "number" || sdkOut.count <= 0) throw new Error(`packed SDK import returned count ${sdkOut.count}`);

    // 5. One bundled-hook run from the packed artifact (isolated data dir;
    // first run self-trusts, then executes).
    const runRes = spawnSync("bun", ["run", binIndex, "run", "gitguard"], {
      cwd: smokeDir,
      env,
      encoding: "utf8",
      input: JSON.stringify({ hook_event_name: "PreToolUse", tool_name: "Bash", tool_input: { command: "echo smoke" } }),
      timeout: 20000,
    });
    if (runRes.status !== 0) throw new Error(`packed bundled-hook run failed (exit ${runRes.status}): ${runRes.stderr}`);
    if (!/decision/.test(runRes.stdout)) throw new Error(`packed bundled-hook run produced no hook decision: ${runRes.stdout.slice(0, 200)}`);
  } finally {
    await rm(workspace, { force: true, recursive: true });
  }
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : error);
  process.exit(1);
});
