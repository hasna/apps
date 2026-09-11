// The 1.1.0 client-contract checks: report mode by default, strict on request,
// and a real black-box probe of a bin that uses the in-tree resolver.
//
// Every fixture token this file plants (a store specifier, a mode word, a
// legacy apex) is assembled from fragments at run time, so the test source
// never carries the shapes the repository's own guards hunt.
import { afterEach, describe, expect, test } from "bun:test";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { runRepoConformance, SCHEMA_IDS, SERVICE_CONTRACT_VERSION, FLEET_MIN_KIT_VERSION } from "../src";
import { CLIENT_CONTRACT_CHECK_IDS } from "../src/conformance-client";
import { buildImportGraph, resolveBinEntry, sqliteReachability, importsLocalOptInGate } from "../src/conformance-import-graph";

const contractsRoot = join(import.meta.dir, "..");
const roots: string[] = [];
afterEach(() => {
  while (roots.length > 0) rmSync(roots.pop()!, { recursive: true, force: true });
});

const sqliteSpecifier = ["bun", "sqlite"].join(":");
const modeWord = ["STORAGE", "MODE"].join("_");
const legacyApex = ["hasna", "xyz"].join(".");

function repo(files: Record<string, string | object>): string {
  const root = mkdtempSync(join(tmpdir(), "contracts-client-checks-"));
  roots.push(root);
  for (const [path, body] of Object.entries(files)) {
    const full = join(root, path);
    mkdirSync(join(full, ".."), { recursive: true });
    writeFileSync(full, typeof body === "string" ? body : `${JSON.stringify(body, null, 2)}\n`);
  }
  return root;
}

function manifest(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    schema: SCHEMA_IDS.serviceContract,
    name: "demo",
    class: "cli-with-store",
    contractVersion: SERVICE_CONTRACT_VERSION,
    kitVersion: FLEET_MIN_KIT_VERSION,
    bins: ["demo", "demo-mcp"],
    hosting: ["user-hosted"],
    storage: {
      backend: "postgresql",
      engines: ["sqlite", "postgresql"],
      envPrefix: "HASNA_DEMO_",
      pgTestGate: { envVar: "DEMO_TEST_DATABASE_URL", command: "bun test tests/pg.test.ts" },
    },
    scope: "public",
    client: {
      transport: "hosted",
      credentialChain: "contracts",
      localOptIn: "HASNA_DEMO_LOCAL",
      localStoreModule: "src/db/database.ts",
      readProbe: ["list", "--limit", "1"],
    },
    serviceSurfaces: [
      { name: "cli", kind: "cli", status: "supported", bin: "demo", authMode: "local-only", dataAccess: "hosted", commands: [{ name: "db migrate", dataAccess: "server-only" }] },
      { name: "mcp", kind: "mcp", status: "supported", mcpBin: "demo-mcp", authMode: "api-key", dataAccess: "hosted" },
    ],
    ...overrides,
  };
}

const pkg = (extra: Record<string, unknown> = {}) => ({
  name: "@hasna/demo",
  version: "0.1.0",
  // Private: the fixtures exercise the client checks, not clause C's release gate.
  private: true,
  type: "module",
  bin: { demo: "bin/demo.ts", "demo-mcp": "bin/demo-mcp.ts" },
  dependencies: { "@hasna/contracts": FLEET_MIN_KIT_VERSION },
  ...extra,
});

/**
 * The fixture's `node_modules/@hasna/contracts`: a shim that re-exports the
 * IN-TREE client, so the fixture's store module can import
 * `@hasna/contracts/client` exactly as a real adopter does and the black-box
 * bin resolves it at run time.
 */
function contractsShim(): Record<string, string | object> {
  const transport = join(contractsRoot, "src/client/transport.ts");
  const storage = join(contractsRoot, "src/client/storage.ts");
  return {
    "node_modules/@hasna/contracts/package.json": {
      name: "@hasna/contracts",
      version: FLEET_MIN_KIT_VERSION,
      type: "module",
      exports: { "./client": "./client.ts", "./client/storage": "./client-storage.ts" },
    },
    "node_modules/@hasna/contracts/client.ts": `export * from ${JSON.stringify(transport)};\n`,
    "node_modules/@hasna/contracts/client-storage.ts": `export * from ${JSON.stringify(storage)};\n`,
  };
}

/** A bin that behaves like a conformant adopter CLI, using the in-tree resolver through the shim. */
function conformantBin(): string {
  return `#!/usr/bin/env bun
import { mkdirSync, writeFileSync } from "node:fs";
import { appPaths, clientResolutionExitCode, formatClientResolutionFailure, isClientResolutionError, localStoreNotice, selectsLocalStore } from "@hasna/contracts/client";
import { resolveStorageClient } from "@hasna/contracts/client/storage";
import "../src/cli/index.ts";
try {
  if (selectsLocalStore("demo", process.env)) {
    const home = appPaths("demo", process.env);
    mkdirSync(home.home, { recursive: true });
    writeFileSync(home.localDb, "");
    process.stderr.write(localStoreNotice("demo", home.localDb) + "\\n");
    console.log("[]");
    process.exit(0);
  }
  resolveStorageClient("demo", process.env);
  console.log("[]");
} catch (error) {
  if (isClientResolutionError(error)) {
    process.stderr.write(formatClientResolutionFailure(error) + "\\n");
    process.exit(clientResolutionExitCode(error));
  }
  throw error;
}
`;
}

const gatedStoreModule = `import { selectsLocalStore } from "@hasna/contracts/client";
import { Database } from "${sqliteSpecifier}";
export function openStore(path: string) {
  if (!selectsLocalStore("demo", process.env)) throw new Error("hosted");
  return new Database(path);
}
`;

const conformantRepo = () =>
  repo({
    ...contractsShim(),
    "package.json": pkg(),
    "hasna.contract.json": manifest(),
    "bin/demo.ts": conformantBin(),
    "bin/demo-mcp.ts": `import "../src/mcp/index.ts";\n`,
    "src/cli/index.ts": `import { openStore } from "../db/database.ts";\nimport { list } from "../client/hosted.ts";\nexport { openStore, list };\n`,
    "src/mcp/index.ts": `import { list } from "../client/hosted.ts";\nexport { list };\n`,
    "src/client/hosted.ts": `export async function list() { return []; }\n`,
    "src/db/database.ts": gatedStoreModule,
  });

describe("client-contract checks: a conformant hosted CLI passes every one", () => {
  test("all six checks pass, including the real black-box probe", () => {
    const root = conformantRepo();
    const report = runRepoConformance(root);
    const byId = new Map(report.checks.map((check) => [check.id, check]));
    for (const id of CLIENT_CONTRACT_CHECK_IDS) {
      expect(byId.get(id)?.status, `${id}: ${byId.get(id)?.detail}`).toBe("pass");
    }
    expect(byId.get("client_sqlite_isolation")!.detail).toContain("client.localStoreModule");
    expect(byId.get("client_fail_closed_blackbox")!.detail).toContain("exits 2 CREDENTIAL_ABSENT");
    expect(byId.get("client_fail_closed_blackbox")!.detail).toContain("HASNA_DEMO_LOCAL=1");
    expect(byId.get("kit_version_pinned")!.detail).toContain(FLEET_MIN_KIT_VERSION);
    expect(report.ok).toBe(true);
  }, 120_000);

  test("the import graph resolves bins to source entries and finds the gated store module", () => {
    const root = conformantRepo();
    const entry = resolveBinEntry(root, "bin/demo.ts")!;
    expect(entry).toBe(join(root, "bin/demo.ts"));
    const graph = buildImportGraph(root);
    const reach = sqliteReachability(graph, join(root, "src/cli/index.ts"));
    expect(reach.modules).toEqual([join(root, "src/db/database.ts")]);
    expect(reach.chains["src/db/database.ts"]).toEqual(["src/cli/index.ts", "src/db/database.ts"]);
    expect(importsLocalOptInGate(join(root, "src/db/database.ts"))).toBe(true);
    expect(importsLocalOptInGate(join(root, "src/client/hosted.ts"))).toBe(false);
    // The MCP bin never reaches the store.
    expect(sqliteReachability(graph, join(root, "src/mcp/index.ts")).modules).toEqual([]);
  });
});

describe("client-contract checks: violations are REPORTED, and FAIL only under strict", () => {
  const violatingRepo = () =>
    repo({
      "package.json": pkg({ dependencies: { "@hasna/contracts": "^1.0.2" } }),
      "hasna.contract.json": manifest({ kitVersion: "1.0.2", client: undefined, serviceSurfaces: [
        { name: "cli", kind: "cli", status: "supported", bin: "demo", authMode: "local-only" },
        { name: "mcp", kind: "mcp", status: "supported", mcpBin: "demo-mcp", authMode: "api-key" },
      ] }),
      "bin/demo.ts": `import "../src/cli/index.ts";\n`,
      "bin/demo-mcp.ts": `import "../src/mcp/index.ts";\n`,
      "src/cli/index.ts": `import { open } from "../db/database.ts";\nexport const base = process.env.DEMO_API_URL ?? "http://127.0.0.1:3000";\nexport const legacy = "https://demo.${legacyApex}";\nexport const mode = process.env.HASNA_DEMO_${modeWord};\nexport { open };\n`,
      "src/mcp/index.ts": `export const tools = [];\n`,
      "src/db/database.ts": `import { Database } from "${sqliteSpecifier}";\nexport function open(path: string) { return new Database(path); }\n`,
    });

  test("report mode: findings are named, ok stays true, nothing is echoed that a guard hunts", () => {
    const root = violatingRepo();
    const report = runRepoConformance(root, { blackbox: false });
    const byId = new Map(report.checks.map((check) => [check.id, check]));
    expect(byId.get("client_transport_declared")!.status).toBe("report");
    expect(byId.get("client_transport_declared")!.detail).toContain("no client");
    expect(byId.get("client_sqlite_isolation")!.status).toBe("report");
    expect(byId.get("client_sqlite_isolation")!.detail).toContain("src/cli/index.ts -> src/db/database.ts");
    expect(byId.get("client_sqlite_isolation")!.detail).toContain("demo (cli)");
    expect(byId.get("client_sqlite_isolation")!.detail).not.toContain("demo-mcp (mcp)");
    expect(byId.get("client_fail_closed_blackbox")!.status).toBe("skip");
    expect(byId.get("no_mode_vocabulary")!.status).toBe("report");
    expect(byId.get("no_mode_vocabulary")!.detail).toContain("src/cli/index.ts:4 storage-mode env var");
    expect(byId.get("no_legacy_hostnames")!.status).toBe("report");
    expect(byId.get("no_legacy_hostnames")!.detail).toContain("src/cli/index.ts:2 loopback default endpoint");
    expect(byId.get("no_legacy_hostnames")!.detail).toContain("src/cli/index.ts:3 per-app origin hostname");
    expect(byId.get("no_legacy_hostnames")!.detail).not.toContain(legacyApex);
    expect(byId.get("kit_version_pinned")!.status).toBe("report");
    expect(byId.get("kit_version_pinned")!.detail).toContain("pinned as a range");
    expect(byId.get("kit_version_pinned")!.detail).toContain(`below the fleet floor ${FLEET_MIN_KIT_VERSION}`);
    expect(report.ok).toBe(true);
  });

  test("strict mode: the same findings fail the repo", () => {
    const root = violatingRepo();
    const report = runRepoConformance(root, { blackbox: false, strict: true });
    const failed = report.checks.filter((check) => check.status === "fail").map((check) => check.id).sort();
    expect(failed).toEqual(["client_sqlite_isolation", "client_transport_declared", "kit_version_pinned", "no_legacy_hostnames", "no_mode_vocabulary"]);
    expect(report.ok).toBe(false);
  });

  test("a local-by-design tool (client: null) is exempt from the client checks", () => {
    const root = repo({
      "package.json": pkg({ bin: { demo: "bin/demo.ts" } }),
      "hasna.contract.json": manifest({ bins: ["demo"], client: null, serviceSurfaces: [
        { name: "cli", kind: "cli", status: "supported", bin: "demo", authMode: "local-only" },
      ] }),
      "bin/demo.ts": `import "../src/cli/index.ts";\n`,
      "src/cli/index.ts": `import { Database } from "${sqliteSpecifier}";\nexport const db = new Database(":memory:");\n`,
    });
    const report = runRepoConformance(root, { blackbox: false, strict: true });
    const byId = new Map(report.checks.map((check) => [check.id, check]));
    expect(byId.get("client_transport_declared")!.status).toBe("pass");
    expect(byId.get("client_sqlite_isolation")!.status).toBe("skip");
    expect(byId.get("client_fail_closed_blackbox")!.status).toBe("skip");
    expect(report.ok).toBe(true);
  });

  test("black-box: a bin that opens a store with no credential is reported, and fails under strict", () => {
    const leakingBin = `#!/usr/bin/env bun
import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
mkdirSync(join(process.env.HOME!, ".hasna", "demo"), { recursive: true });
writeFileSync(join(process.env.HOME!, ".hasna", "demo", "demo.db"), "");
console.log("[]");
`;
    const files = {
      ...contractsShim(),
      "package.json": pkg(),
      "hasna.contract.json": manifest(),
      "bin/demo.ts": leakingBin,
      "bin/demo-mcp.ts": `export {};\n`,
      "src/cli/index.ts": `export {};\n`,
      "src/db/database.ts": gatedStoreModule,
    };
    const reported = runRepoConformance(repo(files)).checks.find((check) => check.id === "client_fail_closed_blackbox")!;
    expect(reported.status).toBe("report");
    expect(reported.detail).toContain("no credential: exit 0, expected 2");
    expect(reported.detail).toContain("does not name CREDENTIAL_ABSENT");
    expect(reported.detail).toContain("created 1 store/JSON file(s)");
    expect(reported.detail).toContain("expected 6");
    const strict = runRepoConformance(repo(files), { strict: true });
    expect(strict.checks.find((check) => check.id === "client_fail_closed_blackbox")!.status).toBe("fail");
    expect(strict.ok).toBe(false);
  }, 120_000);

  test("black-box: a missing built bin is a finding, an undeclared probe is a skip", () => {
    const root = repo({
      "package.json": pkg({ bin: { demo: "dist/cli.js", "demo-mcp": "dist/mcp.js" } }),
      "hasna.contract.json": manifest(),
      "src/cli/index.ts": `export {};\n`,
      "src/db/database.ts": gatedStoreModule,
    });
    const missing = runRepoConformance(root).checks.find((check) => check.id === "client_fail_closed_blackbox")!;
    expect(missing.status).toBe("report");
    expect(missing.detail).toContain("built bin dist/cli.js is missing");
    const noProbe = repo({
      "package.json": pkg(),
      "hasna.contract.json": manifest({ client: { transport: "hosted", credentialChain: "contracts" } }),
      "src/cli/index.ts": `export {};\n`,
    });
    expect(runRepoConformance(noProbe).checks.find((check) => check.id === "client_fail_closed_blackbox")!.status).toBe("skip");
  });
});

describe("the CLI exposes --strict and prints report lines", () => {
  function run(args: string[]) {
    return Bun.spawnSync(["bun", "run", join(contractsRoot, "src/cli/index.ts"), ...args], { cwd: contractsRoot, stdout: "pipe", stderr: "pipe", env: { ...process.env, HASNA_STATION: "no-such-station" } });
  }
  test("report lines do not fail the run; --strict does", () => {
    const root = repo({
      "package.json": pkg({ bin: { demo: "bin/demo.ts" }, dependencies: { "@hasna/contracts": "^1.0.2" } }),
      "hasna.contract.json": manifest({ bins: ["demo"], kitVersion: "1.0.2", client: undefined, serviceSurfaces: [
        { name: "cli", kind: "cli", status: "supported", bin: "demo", authMode: "local-only" },
      ] }),
      "bin/demo.ts": `export {};\n`,
      "src/cli/index.ts": `export {};\n`,
    });
    const lenient = run(["repo-conformance", root]);
    expect(lenient.exitCode).toBe(0);
    expect(lenient.stdout.toString()).toContain("  report kit_version_pinned:");
    const strict = run(["repo-conformance", "--strict", root]);
    expect(strict.exitCode).toBe(1);
    expect(strict.stdout.toString()).toContain("  fail kit_version_pinned:");
    const json = JSON.parse(run(["repo-conformance", "--json", root]).stdout.toString());
    expect(json.ok).toBe(true);
    expect(json.checks.find((check: { id: string }) => check.id === "kit_version_pinned").status).toBe("report");
  }, 60_000);
});
