import { afterEach, describe, expect, test } from "bun:test";
import { cpSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import packageJson from "../package.json";
import {
  createBunPackageIsolatedTempDir,
  projectExternalBunDuplicatePackageWarning,
} from "./test/bun-fixture-isolation.js";

const root = join(import.meta.dir, "..");

// Why this file exists, and why every other test in this repo is blind to it.
//
// The runner stage of the Dockerfile ships `dist` and nothing else — no
// node_modules, no package.json, no bun.lock. Any bare specifier still present
// in dist/server/index.js is therefore NOT resolved from the locked dependency
// tree at run time. Bun's auto-install resolves it by DOWNLOADING THE PACKAGE
// FROM THE PUBLIC NPM REGISTRY AT THE `latest` TAG, on every container start.
//
// That is how @hasna/todos 0.13.9 died in production on 2026-08-01: the server
// bundle statically imported "@hasna/contracts/mode", the container fetched
// @hasna/contracts@0.8.7 (npm `latest`, published that morning) instead of the
// locked 0.5.2, and 0.8.7 had dropped the ./mode export. The identical bundle
// had booted fine the day before against an earlier `latest`.
//
// Every existing test passes in a tree where node_modules is present, so the
// specifier always resolves and the defect is invisible. The only test that can
// see it is one that reconstructs the runner's filesystem — a directory with
// the bundle and NO node_modules above it — with auto-install disabled and an
// empty package cache, so a network fetch cannot paper over a missing module.
//
// Both halves below carry their own positive control: a deliberately
// externalized build of the same entrypoint that MUST be rejected by the same
// harness. Without that control this test would keep passing if the harness
// itself broke, which is the exact failure mode it was written to catch.

const SERVER_ENTRY = "src/server/index.ts";
const EXTERNALIZE_CONTRACTS = "--external '@hasna/contracts' --external '@hasna/contracts/*'";
const serverFixtureRoots: string[] = [];

afterEach(() => {
  for (const path of serverFixtureRoots.splice(0)) {
    rmSync(path, { recursive: true, force: true });
  }
});

function serverFixtureRoot(prefix: string): string {
  const path = createBunPackageIsolatedTempDir(prefix);
  serverFixtureRoots.push(path);
  return path;
}

/**
 * The literal `bun build` invocation for the server bundle, taken from the
 * build:server script rather than copied. If someone re-adds an --external flag
 * to the real build, this test builds WITH it and fails — which is the point.
 */
function serverBuildCommand(): string {
  const script = packageJson.scripts["build:server"];
  const segments = script.split("&&").map((segment) => segment.trim());
  const matches = segments.filter((segment) => segment.startsWith(`bun build ${SERVER_ENTRY} `));

  expect(matches).toHaveLength(1);
  expect(matches[0]).toContain("--outdir dist/server");

  return matches[0]!;
}

function build(outDir: string, extraFlags = ""): void {
  const command = `${serverBuildCommand().replace("--outdir dist/server", `--outdir ${JSON.stringify(outDir)}`)} ${extraFlags}`;
  const built = Bun.spawnSync(["sh", "-c", command], { cwd: root, stdout: "pipe", stderr: "pipe" });

  expect(built.stderr.toString() + built.stdout.toString()).not.toContain("error:");
  expect(built.exitCode).toBe(0);
}

/**
 * Reconstruct the runner image's filesystem: WORKDIR /app holding dist and the
 * standalone contracts CLI, with no dependency tree anywhere above it. The
 * bunfig mirrors what the image itself now ships, so the harness and production
 * agree on whether auto-install may rescue a missing module.
 */
function runnerRoot(bundle: string): { app: string; cache: string; home: string } {
  const base = serverFixtureRoot("todos-runner-");
  const app = join(base, "app");
  const cache = join(base, "cache");
  const home = join(base, "home");

  mkdirSync(join(app, "dist", "server"), { recursive: true });
  mkdirSync(join(app, "bin"), { recursive: true });
  mkdirSync(cache, { recursive: true });
  mkdirSync(home, { recursive: true });

  cpSync(bundle, join(app, "dist", "server", "index.js"));
  cpSync(
    join(root, "node_modules", "@hasna", "contracts", "dist", "cli", "index.js"),
    join(app, "bin", "contracts-cli.js"),
  );
  writeFileSync(join(app, "bunfig.toml"), readFileSync(join(root, "docker", "runner-bunfig.toml")));

  return { app, cache, home };
}

function runnerEnv(
  app: string,
  cache: string,
  home: string,
  options: { unreachableRegistry?: boolean } = {},
): Record<string, string> {
  // Deliberately NOT process.env: the host's package cache, registry token and
  // TODOS_* credentials must not reach a harness whose whole purpose is to
  // observe what the container can resolve on its own.
  const env: Record<string, string> = {
    PATH: "/usr/bin:/bin",
    HOME: home,
    BUN_INSTALL_CACHE_DIR: cache,
    NODE_ENV: "production",
    HOST: "127.0.0.1",
    PORT: "0",
    APP_DIR: app,
  };

  if (options.unreachableRegistry) {
    // The acceptance property is "the container boots with the registry
    // unreachable". A real network namespace would be the faithful expression
    // of that, but unprivileged `unshare -rn` is denied on the fleet's stations
    // (/proc/self/uid_map: Operation not permitted), so this points the
    // resolver at a dead endpoint instead. It is weaker than --network none —
    // it blocks the registry, not all egress — and it is stated here rather
    // than dressed up, because a test that overclaims its isolation is how the
    // container came to be trusted in the first place.
    env.BUN_CONFIG_REGISTRY = "http://127.0.0.1:1/";
    env.NPM_CONFIG_REGISTRY = "http://127.0.0.1:1/";
  }

  return env;
}

/** Every bare specifier the bundle still needs, and where each one resolves. */
function unresolvableSpecifiers(app: string, cache: string, home: string): string[] {
  const probe = `
    const src = await Bun.file(process.env.APP_DIR + "/dist/server/index.js").text();
    const specs = new Set();
    for (const m of src.matchAll(/^import\\s+(?:[^;\\n]*?\\s+from\\s+)?"([^"]+)";?$/gm)) specs.add(m[1]);
    for (const m of src.matchAll(/(?<![.\\w])import\\(\\s*"([^"]+)"\\s*\\)/g)) specs.add(m[1]);
    // require() too. Omitting it is not a small gap: ajv emits require() calls
    // inside generated validator code, so a probe that scans only import forms
    // returns a CLEAN [] over a bundle with five unresolvable specifiers in it.
    for (const m of src.matchAll(/(?<![.\\w])require\\(\\s*"([^"]+)"\\s*\\)/g)) specs.add(m[1]);
    const from = process.env.APP_DIR + "/dist/server/";
    const bad = [];
    for (const spec of specs) {
      if (spec.startsWith(".") || spec.startsWith("/")) continue;
      let resolved;
      try { resolved = Bun.resolveSync(spec, from); } catch { bad.push(spec + " (unresolvable)"); continue; }
      if (resolved.startsWith("node:") || resolved.startsWith("bun:")) continue;
      // Resolved to a real file: it must live inside the image. Normalize any
      // host-only resolution to the runner's actual view (unresolvable), rather
      // than making the result depend on an ambient /tmp/node_modules created by
      // another concurrently running test.
      if (!resolved.startsWith(process.env.APP_DIR)) bad.push(spec + " (unresolvable)");
    }
    console.log(JSON.stringify(bad));
  `;

  const probed = Bun.spawnSync([process.execPath, "-e", probe], {
    cwd: app,
    env: runnerEnv(app, cache, home),
    stdout: "pipe",
    stderr: "pipe",
  });

  const projectedStderr = projectExternalBunDuplicatePackageWarning(probed.stderr.toString());
  expect(projectedStderr.stderr).toBe("");
  expect(probed.exitCode).toBe(0);

  return JSON.parse(probed.stdout.toString().trim());
}

/** Actually start the bundle the way the image's CMD does. */
function bootStderr(
  app: string,
  cache: string,
  home: string,
  options: { unreachableRegistry?: boolean } = {},
  args: string[] = [],
): string {
  const booted = Bun.spawnSync([process.execPath, "dist/server/index.js", ...args], {
    cwd: app,
    env: runnerEnv(app, cache, home, options),
    stdout: "pipe",
    stderr: "pipe",
    timeout: 60_000,
  });

  return booted.stderr.toString() + booted.stdout.toString();
}

/**
 * Specifiers that are bare in the bundle, unresolvable in the runner, and known.
 *
 * ajv's code generator emits `require()` calls into the validator source it
 * builds, and the bundler cannot follow them, so they survive bundling. They
 * predate the self-contained work — an externalized build carries the identical
 * five — and they are NOT reached by ordinary traffic: measured in a
 * `--network none` container, POST /api/tasks returns 201 and GET /api/tasks
 * returns 200 with no module error in the log.
 *
 * They are pinned here rather than globbed as `ajv/*` so that a NEW unresolvable
 * specifier — including a new ajv subpath nobody has looked at — fails this test
 * instead of being absorbed by a pattern.
 *
 * This matters more now than it did before `bunfig.toml` disabled auto-install.
 * Previously an unresolvable specifier was silently fetched from npm; now it is
 * a hard startup failure. That is the right trade, and it means the set below is
 * the exact list of ways this bundle could still fail to boot if a code path
 * ever reaches one of them.
 */
const KNOWN_UNRESOLVED_IN_RUNNER = [
  "ajv-formats/dist/formats (unresolvable)",
  "ajv/dist/runtime/equal (unresolvable)",
  "ajv/dist/runtime/ucs2length (unresolvable)",
  "ajv/dist/runtime/uri (unresolvable)",
  "ajv/dist/runtime/validation_error (unresolvable)",
];

describe("server bundle is self-contained in the runner image", () => {
  test("no bare specifier survives that the image cannot resolve on its own", () => {
    const outDir = serverFixtureRoot("todos-bundle-");
    build(outDir);
    const { app, cache, home } = runnerRoot(join(outDir, "index.js"));

    const unresolved = unresolvableSpecifiers(app, cache, home);
    // Nothing from @hasna may survive — that is the class this file exists for,
    // and it is asserted exactly rather than folded into the allowlist.
    expect(unresolved.filter((s) => s.startsWith("@hasna/"))).toEqual([]);
    expect([...unresolved].sort()).toEqual(KNOWN_UNRESOLVED_IN_RUNNER);
  });

  test("POSITIVE CONTROL: the same harness rejects an externalized bundle", () => {
    // If this ever passes an externalized build, the check above is vacuous and
    // proves nothing about the shipped image.
    const outDir = serverFixtureRoot("todos-bundle-external-");
    build(outDir, EXTERNALIZE_CONTRACTS);
    const { app, cache, home } = runnerRoot(join(outDir, "index.js"));

    const bad = unresolvableSpecifiers(app, cache, home);
    expect(bad.length).toBeGreaterThan(0);
    expect(bad.join("\n")).toContain("@hasna/contracts");
  });

  test("the bundle boots past module resolution in a runner-shaped filesystem", () => {
    const outDir = serverFixtureRoot("todos-boot-");
    build(outDir);
    const { app, cache, home } = runnerRoot(join(outDir, "index.js"));

    // It must still fail closed on the missing credential — that is the
    // application refusing to serve, which means every module already loaded.
    const output = bootStderr(app, cache, home);
    expect(output).not.toContain("Cannot find module");
    expect(output).toContain("refusing to start");
  });

/**
 * The throwing `@hasna/contracts` stub the positive controls plant in the
 * runner's own node_modules.
 *
 * Every name the bundle can import must exist as a NAMED EXPORT here, even
 * though the module throws on evaluation. A bare `throw` is not enough: an ESM
 * import of a name the module does not export is a LINK-time SyntaxError that
 * fires before any module body runs, so the control would fail with
 * "Export named 'x' not found" instead of the RUNNER_STUB message it asserts —
 * red for the right reason but unreadable, and indistinguishable from a real
 * regression. Keep this list in step with what the runtime imports from
 * @hasna/contracts and its subpaths.
 */
const RUNNER_STUB_SOURCE = [
  'const stub = () => { throw new Error("RUNNER_STUB: @hasna/contracts must not resolve in the runner image"); };',
  "export const verifyApiKey = stub;",
  "export const ApiKeyStore = class {};",
  "export const resolveStorageClient = stub;",
  "export const createHasnaStorageClient = stub;",
  "export const resolveClientTransport = stub;",
  "export const createClientTransport = stub;",
  "export const resolveCredential = stub;",
  "export const clientTransportEnvKeys = stub;",
  "export const credentialOverrideEnvKey = stub;",
  "export const credentialPointerEnvKey = stub;",
  'export const CREDENTIAL_PROFILE_ENV_KEY = "HASNA_PROFILE";',
  "export class ClientTransportConfigurationError extends Error {}",
  "export class CredentialResolutionError extends Error {}",
  'throw new Error("RUNNER_STUB: @hasna/contracts must not resolve in the runner image");',
].join("\n") + "\n";

  test("POSITIVE CONTROL: an externalized bundle cannot boot in that filesystem", () => {
    const outDir = serverFixtureRoot("todos-boot-external-");
    build(outDir, EXTERNALIZE_CONTRACTS);
    const { app, cache, home } = runnerRoot(join(outDir, "index.js"));

    // The normal serve flow refuses on the missing credential before any
    // module that imports @hasna/contracts loads (the migration path is the
    // only boot-time consumer), so the control boots the MIGRATE path, which
    // loads the externalized contracts import before anything else can run.
    // A throwing contracts stub at the runner's own node_modules makes the
    // outcome deterministic in any environment: the nearest node_modules wins
    // over ambient ancestor directories (e.g. /tmp/node_modules left by
    // concurrently running tests), so the externalized bundle must load the
    // stub and die, while a self-contained bundle never touches it.
    mkdirSync(join(app, "node_modules", "@hasna", "contracts"), { recursive: true });
    writeFileSync(
      join(app, "node_modules", "@hasna", "contracts", "package.json"),
      JSON.stringify({
        name: "@hasna/contracts",
        version: "0.0.0-runner-stub",
        main: "index.js",
        exports: { ".": "./index.js", "./auth": "./index.js", "./client/storage": "./index.js", "./*": "./index.js" },
      }),
    );
    writeFileSync(
      join(app, "node_modules", "@hasna", "contracts", "index.js"),
      RUNNER_STUB_SOURCE,
    );

    const output = bootStderr(app, cache, home, {}, ["migrate"]);
    expect(output).toContain("RUNNER_STUB: @hasna/contracts");
  });

  test("the bundle boots with the package registry unreachable", () => {
    // deploy-authority-titus's acceptance property, stated in its own terms: a
    // production image must not need the registry to start. The container has
    // been fetching its dependency tree from npm on every task start, which is
    // why a package another team published at 11:23Z could break a todos deploy
    // at 15:38Z with no todos commit in between.
    const outDir = serverFixtureRoot("todos-offline-");
    build(outDir);
    const { app, cache, home } = runnerRoot(join(outDir, "index.js"));

    const output = bootStderr(app, cache, home, { unreachableRegistry: true });
    expect(output).not.toContain("Cannot find module");
    expect(output).toContain("refusing to start");
  });

  test("POSITIVE CONTROL: an externalized bundle cannot boot without the registry", () => {
    // Proves the case above is a statement about the bundle and not about the
    // harness quietly resolving everything from somewhere else. Boots the
    // migrate path with the same throwing stub as the filesystem control.
    const outDir = serverFixtureRoot("todos-offline-external-");
    build(outDir, EXTERNALIZE_CONTRACTS);
    const { app, cache, home } = runnerRoot(join(outDir, "index.js"));

    mkdirSync(join(app, "node_modules", "@hasna", "contracts"), { recursive: true });
    writeFileSync(
      join(app, "node_modules", "@hasna", "contracts", "package.json"),
      JSON.stringify({
        name: "@hasna/contracts",
        version: "0.0.0-runner-stub",
        main: "index.js",
        exports: { ".": "./index.js", "./auth": "./index.js", "./client/storage": "./index.js", "./*": "./index.js" },
      }),
    );
    writeFileSync(
      join(app, "node_modules", "@hasna", "contracts", "index.js"),
      RUNNER_STUB_SOURCE,
    );

    const output = bootStderr(app, cache, home, { unreachableRegistry: true }, ["migrate"]);
    expect(output).toContain("RUNNER_STUB: @hasna/contracts");
  });

  test("the runner image disables auto-install so a missing module fails loudly", () => {
    const dockerfile = readFileSync(join(root, "Dockerfile"), "utf8");
    const runner = dockerfile.split("FROM base AS runner")[1]!;
    const bunfig = readFileSync(join(root, "docker", "runner-bunfig.toml"), "utf8");

    expect(runner).toContain("COPY docker/runner-bunfig.toml ./bunfig.toml");
    expect(bunfig).toContain('auto = "disable"');
    // The server bundle must not be re-externalized behind the harness's back.
    expect(packageJson.scripts["build:server"]).not.toContain(
      `bun build ${SERVER_ENTRY} --outdir dist/server --target bun --external`,
    );
  });
});
