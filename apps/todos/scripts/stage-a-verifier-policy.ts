export type OutputComparisonRule = "duration-tokens" | "namespace-inode";
export const CANONICAL_COMMAND_DEADLINE_MS = 300_000;
export const CANONICAL_COMMAND_OUTPUT_LIMIT_BYTES = 64 * 1024 * 1024;

export interface CanonicalCommandPolicy {
  label: string;
  argv: readonly string[];
  env: Readonly<Record<string, string>>;
  stdin: "ignore";
  deadlineMs: number;
  outputLimitBytes: number;
  expectedExit: number;
  expectedAuthorityFloor: number;
  preloads: readonly string[];
  inputs: readonly string[];
  outputComparisonRules: readonly OutputComparisonRule[];
}

export const CANONICAL_BASE_ENVIRONMENT = Object.freeze({
  PATH: "/opt/bin:/bin",
  HOME: "/srv",
  TMPDIR: "/tmp",
  LANG: "C.UTF-8",
  LC_ALL: "C",
  CI: "1",
  NO_COLOR: "1",
  BUN_RUNTIME_TRANSPILER_CACHE_PATH: "0",
  BUN_TMPDIR: "/tmp",
  BUN_INSTALL: "/tmp/bun-install",
  BUN_INSTALL_CACHE_DIR: "/tmp/bun-install-cache",
  XDG_CACHE_HOME: "/tmp/xdg-cache",
  HASNA_TODOS_STORAGE_MODE: "remote",
  TODOS_STORAGE_MODE: "remote",
  TODOS_DB_PATH: "/srv/tripwire.db",
  HASNA_TODOS_DB_PATH: "/srv/tripwire.db",
  TODOS_AUTO_PROJECT: "false",
});

const importExpression = [
  'process.argv[1]="stage-a-provenance-import";',
  "const first=await import(process.env.STAGE_A_TARGET);",
  "const second=await import(process.env.STAGE_A_TARGET);",
  'if(first!==second) throw new Error("warm import identity mismatch");',
  'console.log("STAGE_A_PROVENANCE_IMPORT_OK");',
].join("");

const networkProbeExpression = [
  'import { fstatSync, readFileSync, readlinkSync, readdirSync } from "node:fs";',
  'const namespace=readlinkSync("/proc/self/ns/net");',
  'const interfaces=readFileSync("/proc/net/dev","utf8").split("\\n").slice(2).map((line)=>line.split(":")[0]?.trim()).filter(Boolean);',
  'const routes=readFileSync("/proc/net/route","utf8").trim().split("\\n").slice(1).filter(Boolean);',
  'let socketFds=0; let directoryFds=0; for(const fd of readdirSync("/proc/self/fd")){ try { if(readlinkSync(`/proc/self/fd/${fd}`).startsWith("socket:[")) socketFds+=1; if(fstatSync(Number(fd)).isDirectory()) directoryFds+=1; } catch {} }',
  'let routeError=""; try { const socket=await Bun.connect({hostname:"192.0.2.1",port:9,socket:{data(){}}}); socket.end(); } catch(error) { routeError=(error instanceof Error?error.message:String(error)).replace(/[\\r\\n]+/g," "); }',
  'console.log(`namespace=${namespace}`); console.log(`interfaces=${interfaces.join(",")}`); console.log(`routes=${routes.length}`); console.log(`socket_fds=${socketFds}`); console.log(`directory_fds=${directoryFds}`); console.log(`route_error=${routeError}`);',
  'process.exit(routeError.length>0?1:2);',
].join("");

function policy(
  label: string,
  argv: readonly string[],
  expectedExit = 0,
  expectedAuthorityFloor = 0,
  env: Readonly<Record<string, string>> = CANONICAL_BASE_ENVIRONMENT,
  preloads: readonly string[] = [],
  inputs: readonly string[] = [],
  outputComparisonRules: readonly OutputComparisonRule[] = [],
): CanonicalCommandPolicy {
  return Object.freeze({
    label,
    argv: Object.freeze([...argv]),
    env: Object.freeze({ ...env }),
    stdin: "ignore" as const,
    deadlineMs: CANONICAL_COMMAND_DEADLINE_MS,
    outputLimitBytes: CANONICAL_COMMAND_OUTPUT_LIMIT_BYTES,
    expectedExit,
    expectedAuthorityFloor,
    preloads: Object.freeze([...preloads]),
    inputs: Object.freeze([...inputs]),
    outputComparisonRules: Object.freeze([...outputComparisonRules]),
  });
}

export const DEPENDENCY_INSTALL_POLICY = policy(
  "offline frozen dependency closure",
  [
    "/opt/bin/bun", "install", "--frozen-lockfile", "--ignore-scripts",
    "--backend=copyfile", "--linker=hoisted", "--cache-dir=/cache", "--no-progress",
  ],
  0,
  0,
  { ...CANONICAL_BASE_ENVIRONMENT, BUN_INSTALL_CACHE_DIR: "/cache" },
  [],
  ["workspace/package.json", "workspace/bun.lock", "workspace/dashboard/package.json"],
  ["duration-tokens"],
);

export const NETWORK_PROBE_POLICY = policy(
  "network namespace denial probe",
  ["/opt/bin/bun", "-e", networkProbeExpression],
  1,
  0,
  CANONICAL_BASE_ENVIRONMENT,
  [],
  [],
  ["namespace-inode"],
);

const sourceImportPreload = "/mnt/src/test/stage-a-import-tripwire-preload.ts";
const sourceEntrypointPreload = "/mnt/src/test/stage-a-entrypoint-preload.ts";
const sourceImports = [
  ["source root cold/warm import", "src/index.ts"],
  ["source contracts cold/warm import", "src/contracts.ts"],
  ["source MCP public cold/warm import", "src/mcp.ts"],
  ["source MCP constructor cold/warm import", "src/mcp/index.ts"],
  ["source MCP HTTP cold/warm import", "src/mcp/http.ts"],
  ["source registry cold/warm import", "src/registry.ts"],
  ["source SDK cold/warm import", "src/sdk/index.ts"],
  ["source storage cold/warm import", "src/storage.ts"],
  ["source direct storage cold/warm import", "src/storage/index.ts"],
  ["built root cold/warm import", "dist/index.js"],
  ["built contracts cold/warm import", "dist/contracts.js"],
  ["built MCP public cold/warm import", "dist/mcp.js"],
  ["built MCP constructor cold/warm import", "dist/mcp/index.js"],
  ["built MCP HTTP cold/warm import", "dist/mcp/http.js"],
  ["built registry cold/warm import", "dist/registry.js"],
  ["built SDK cold/warm import", "dist/sdk/index.js"],
  ["built storage cold/warm import", "dist/storage.js"],
  ["built direct storage cold/warm import", "dist/storage/index.js"],
] as const;
const sourceEntries = [
  ["source CLI metadata", "src/cli/index.tsx", ["--help"], 0, 0],
  ["source CLI containment", "src/cli/index.tsx", ["--json", "list"], 1, 1],
  ["source MCP containment", "src/mcp/index.ts", [], 1, 1],
  ["source server containment", "src/server/index.ts", [], 1, 1],
  ["built CLI metadata", "dist/cli/index.js", ["--help"], 0, 0],
  ["built CLI containment", "dist/cli/index.js", ["--json", "list"], 1, 1],
  ["built MCP containment", "dist/mcp/index.js", [], 1, 1],
  ["built server containment", "dist/server/index.js", [], 1, 1],
] as const;

export const SOURCE_REPLAY_POLICY: readonly CanonicalCommandPolicy[] = Object.freeze([
  policy(
    "generated SDK stability",
    ["/opt/bin/bun", "run", "generate:sdk"],
    0,
    0,
    CANONICAL_BASE_ENVIRONMENT,
    [],
    ["workspace/scripts/generate-sdk.ts", "workspace/src/server/openapi.ts"],
  ),
  policy(
    "install-free build",
    ["/opt/bin/bun", "run", "build:server"],
    0,
    0,
    CANONICAL_BASE_ENVIRONMENT,
    [],
    ["workspace/package.json", "workspace/bun.lock"],
    ["duration-tokens"],
  ),
  policy(
    "declaration build",
    ["/opt/bin/bun", "/mnt/node_modules/typescript/bin/tsc", "--emitDeclarationOnly", "--outDir", "dist"],
    0,
    0,
    CANONICAL_BASE_ENVIRONMENT,
    [],
    ["workspace/node_modules/typescript/bin/tsc", "workspace/node_modules/typescript/package.json", "workspace/tsconfig.json"],
    ["duration-tokens"],
  ),
  ...sourceImports.map(([label, target]) => policy(
    label,
    ["/opt/bin/bun", "--preload", sourceImportPreload, "-e", importExpression],
    0,
    0,
    {
      ...CANONICAL_BASE_ENVIRONMENT,
      STAGE_A_TARGET: `file:///mnt/${target}`,
      STAGE_A_TRIPWIRE_IMPORTS: "1",
    },
    ["workspace/src/test/stage-a-import-tripwire-preload.ts"],
    ["workspace/src/test/stage-a-import-tripwire-preload.ts", `workspace/${target}`],
  )),
  ...sourceEntries.map(([label, entry, args, expectedExit, expectedAuthorityFloor]) => policy(
    label,
    ["/opt/bin/bun", "--preload", sourceEntrypointPreload, `/mnt/${entry}`, ...args],
    expectedExit,
    expectedAuthorityFloor,
    { ...CANONICAL_BASE_ENVIRONMENT, STAGE_A_TRIPWIRE_IMPORTS: "1" },
    ["workspace/src/test/stage-a-entrypoint-preload.ts"],
    ["workspace/src/test/stage-a-entrypoint-preload.ts", `workspace/${entry}`],
  )),
]);

const artifactImportPreload = "/mnt/verification/import-preload.ts";
const artifactEntrypointPreload = "/mnt/verification/entrypoint-preload.ts";
export const ARTIFACT_REPLAY_POLICY: readonly CanonicalCommandPolicy[] = Object.freeze([
  ...sourceImports.slice(9).map(([label, target]) => policy(
    `extracted artifact ${label}`,
    ["/opt/bin/bun", "--preload", artifactImportPreload, "-e", importExpression],
    0,
    0,
    {
      ...CANONICAL_BASE_ENVIRONMENT,
      STAGE_A_TARGET: `file:///mnt/${target}`,
      STAGE_A_TRIPWIRE_IMPORTS: "1",
    },
    ["artifact/verification/import-preload.ts"],
    ["artifact/verification/import-preload.ts", `artifact/${target}`],
  )),
  ...sourceEntries.slice(4).map(([label, entry, args, expectedExit, expectedAuthorityFloor]) => policy(
    `extracted artifact ${label}`,
    ["/opt/bin/bun", "--preload", artifactEntrypointPreload, `/mnt/${entry}`, ...args],
    expectedExit,
    expectedAuthorityFloor,
    { ...CANONICAL_BASE_ENVIRONMENT, STAGE_A_TRIPWIRE_IMPORTS: "1" },
    ["artifact/verification/entrypoint-preload.ts"],
    ["artifact/verification/entrypoint-preload.ts", `artifact/${entry}`],
  )),
]);

function canonicalObject(value: Record<string, unknown>): string {
  return JSON.stringify(Object.fromEntries(Object.entries(value).sort(([left], [right]) => left.localeCompare(right))));
}

function identityPaths(value: unknown): string[] {
  if (!Array.isArray(value)) throw new Error("command identity list is missing");
  return value.map((entry) => {
    if (!entry || typeof entry !== "object" || typeof (entry as { path?: unknown }).path !== "string") {
      throw new Error("command identity path is invalid");
    }
    return (entry as { path: string }).path;
  });
}

export function assertCommandRecordMatchesPolicy(
  record: unknown,
  policyValue: CanonicalCommandPolicy,
  label = policyValue.label,
): void {
  if (!record || typeof record !== "object") throw new Error(`${label}: command record is missing`);
  const value = record as Record<string, any>;
  if (value.label !== policyValue.label) throw new Error(`${label}: label differs from verifier policy`);
  if (JSON.stringify(value.argv) !== JSON.stringify(policyValue.argv)) throw new Error(`${label}: argv differs from verifier policy`);
  if (canonicalObject(value.env ?? {}) !== canonicalObject(policyValue.env)) throw new Error(`${label}: env differs from verifier policy`);
  if (value.stdin !== policyValue.stdin) throw new Error(`${label}: stdin differs from verifier policy`);
  if (value.deadline_ms !== policyValue.deadlineMs) throw new Error(`${label}: deadline differs from verifier policy`);
  if (value.output_limit_bytes !== policyValue.outputLimitBytes) throw new Error(`${label}: output limit differs from verifier policy`);
  if (value.termination !== "exit" || value.timed_out !== false || value.output_limited !== false) {
    throw new Error(`${label}: termination outcome differs from verifier policy`);
  }
  if (value.expected_exit !== policyValue.expectedExit) throw new Error(`${label}: expected exit differs from verifier policy`);
  if (value.expected_authority_floor_occurrences !== policyValue.expectedAuthorityFloor) {
    throw new Error(`${label}: authority floor differs from verifier policy`);
  }
  if (JSON.stringify(identityPaths(value.preloads)) !== JSON.stringify(policyValue.preloads)) {
    throw new Error(`${label}: preloads differ from verifier policy`);
  }
  if (JSON.stringify(identityPaths(value.inputs)) !== JSON.stringify(policyValue.inputs)) {
    throw new Error(`${label}: inputs differ from verifier policy`);
  }
  const expectedComparison = policyValue.outputComparisonRules.length
    ? { mode: "normalized-text-v1", rules: policyValue.outputComparisonRules }
    : { mode: "exact-bytes", rules: [] };
  if (JSON.stringify(value.output_comparison) !== JSON.stringify(expectedComparison)) {
    throw new Error(`${label}: output comparison differs from verifier policy`);
  }
}

export function assertArchiveExtractionClosed(
  entries: readonly Array<{ path: string; type: string }>,
): void {
  const paths = new Map<string, string>();
  for (const entry of entries) {
    if (!entry.path || entry.path.startsWith("/") || entry.path.includes("\\") || entry.path.includes("\0")) {
      throw new Error(`unsafe archive path: ${entry.path}`);
    }
    if (paths.has(entry.path)) throw new Error(`duplicate archive path: ${entry.path}`);
    paths.set(entry.path, entry.type);
  }
  for (const entry of entries) {
    const parts = entry.path.split("/");
    for (let index = 1; index < parts.length; index += 1) {
      const parent = parts.slice(0, index).join("/");
      if (paths.get(parent) !== "directory") {
        throw new Error(`archive extraction parent is not explicit: ${parent} for ${entry.path}`);
      }
    }
  }
}
