import { afterEach, describe, expect, test } from "bun:test";
import {
  chmodSync,
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  realpathSync,
  rmSync,
  symlinkSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { sliceBetween, sliceBetweenUnique } from "./helpers/source-assertions";
import { signingFixtureCommand } from "./helpers/signing-fixture";
// Darwin fixtures remap only copied tool capabilities and use OS confinement.
const repositoryRoot = resolve(import.meta.dir, "../..");
const resolver = join(repositoryRoot, "scripts", "resolve_tailscale_cli.sh");
const temporaryPaths: string[] = [];
let sandboxRoot: string | undefined;
const shellQuote = (value: string) => `'${value.replaceAll("'", "'\\''")}'`;

afterEach(() => {
  for (const path of temporaryPaths.splice(0)) rmSync(path, { recursive: true, force: true });
  sandboxRoot = undefined;
});

function temporaryDirectory(): string {
  if (!sandboxRoot) {
    sandboxRoot = realpathSync(mkdtempSync(join(tmpdir(), "recordings-tailscale-resolver-")));
    chmodSync(sandboxRoot, 0o700);
    temporaryPaths.push(sandboxRoot);
  }
  const directory = mkdtempSync(join(sandboxRoot, "case-"));
  chmodSync(directory, 0o700);
  return directory;
}

async function confinedShell(root: string, source: string, environment: Record<string, string> = {}) {
  const wrapper = join(root, "canonical-probe.sh");
  writeFileSync(wrapper, `set -euo pipefail\nsource "$RESOLVER"\n${source}\n`);
  const child = Bun.spawn(signingFixtureCommand(sandboxRoot!, ["/bin/bash", wrapper]), {
    cwd: root,
    env: { HOME: sandboxRoot!, TMPDIR: sandboxRoot!, PATH: "/usr/bin:/bin", RESOLVER: resolver, ...environment },
    stdout: "pipe", stderr: "pipe",
  });
  const timer = setTimeout(() => child.kill("SIGKILL"), 5000);
  try {
    const [exitCode, stdout, stderr] = await Promise.all([child.exited, new Response(child.stdout).text(), new Response(child.stderr).text()]);
    return { exitCode, stdout, stderr };
  } finally { clearTimeout(timer); }
}

function writeExecutable(path: string, body = "printf '%s\\n' '{\"Self\":{}}'\n"): void {
  mkdirSync(dirname(path), { recursive: true });
  writeFileSync(path, `#!/bin/bash\nset -euo pipefail\n${body}`);
  chmodSync(path, 0o755);
}

function createTrustedApp(root: string, body?: string): { app: string; cli: string } {
  const app = join(root, "Tailscale.app");
  const cli = join(app, "Contents", "MacOS", "Tailscale");
  writeExecutable(
    cli,
    body ??
      `printf '%s\\n' "$0" >> ${shellQuote(join(root, "markers", "status-path.log"))}\nprintf '%s\\n' '{"Self":{"Online":true,"HostName":"station06","ID":"node-1"}}'\n`,
  );
  writeFileSync(join(app, "signature-team"), "W5364U7YZB\n");
  writeFileSync(join(app, "signature-identifier"), "io.tailscale.ipn.macsys\n");
  return { app, cli };
}

function createCodesignStub(root: string): string {
  const executable = join(root, "tools", "codesign");
  writeExecutable(
    executable,
    `subject="\${@: -1}"
case "$subject" in ${shellQuote(root)}/*) ;; *) exit 90;; esac
expected='anchor apple generic and certificate leaf[subject.OU] = "W5364U7YZB" and identifier "io.tailscale.ipn.macsys"'
if [ "$1" = --verify ]; then
  [ "$2 $3 $4" = '--strict --all-architectures --verbose=2' ] || exit 90
  if [ -d "$subject" ]; then
    [ "$#" = 8 ] && [ "$5 $6" = '--deep -R' ] && [ "$7" = "$expected" ] || exit 90
  else
    [ "$#" = 7 ] && [ "$5" = -R ] && [ "$6" = "$expected" ] || exit 90
  fi
elif [ "$1" = -d ]; then
  [ "$#" = 3 ] && [ "$2" = --verbose=4 ] || exit 90
else exit 90
fi
printf '%s\\n' "$*" >> ${shellQuote(join(root, "codesign-arguments.log"))}
app="$subject"
case "$app" in
  */Contents/MacOS/Tailscale) app="\${app%/Contents/MacOS/Tailscale}" ;;
esac
team="$(/bin/cat "$app/signature-team")"
identifier="$(/bin/cat "$app/signature-identifier")"
if [[ " $* " == *" --verify "* ]]; then
  [ "$team" = W5364U7YZB ] && [ "$identifier" = io.tailscale.ipn.macsys ] || exit 1
fi
if [[ " $* " == *" -d "* ]]; then
  printf 'Identifier=%s\\nTeamIdentifier=%s\\n' "$identifier" "$team" >&2
fi
`,
  );
  return executable;
}

function createDittoStub(root: string, mutateSnapshot = false): string {
  const executable = join(root, "tools", "ditto");
  writeExecutable(
    executable,
    `source="$1"
destination="$2"
/bin/cp -R "$source" "$destination"
${mutateSnapshot ? `printf 'ATTACKER1\\n' > "$destination/signature-team"` : ""}
`,
  );
  return executable;
}

async function trustedSnapshotWith(options: {
  team?: string;
  identifier?: string;
  mutateSnapshot?: boolean;
  replaceSourceBeforeStatus?: boolean;
  unmappedCodesign?: boolean;
}) {
  const root = temporaryDirectory();
  const markerDirectory = join(root, "markers");
  const snapshotParent = join(root, "private-work");
  mkdirSync(markerDirectory, { mode: 0o700 });
  mkdirSync(snapshotParent, { mode: 0o700 });
  const source = createTrustedApp(root);
  if (options.team) writeFileSync(join(source.app, "signature-team"), `${options.team}\n`);
  if (options.identifier) {
    writeFileSync(join(source.app, "signature-identifier"), `${options.identifier}\n`);
  }
  const codesign = createCodesignStub(root);
  const ditto = createDittoStub(root, options.mutateSnapshot);
  let fixtureResolver = resolver;
  if (process.platform === "darwin") {
    fixtureResolver = join(root, "resolver.sh");
    let contents = readFileSync(resolver, "utf8");
    const replacements: [string, string, number][] = [
      ["source_app='/Applications/Tailscale.app'", `source_app=${shellQuote(source.app)}`, 1],
      ["ditto_executable='/usr/bin/ditto'", `ditto_executable=${shellQuote(ditto)}`, 1],
    ];
    if (!options.unmappedCodesign) replacements.push(["codesign_executable='/usr/bin/codesign'", `codesign_executable=${shellQuote(codesign)}`, 2]);
    for (const [before, after, count] of replacements) {
      if (contents.split(before).length !== count + 1) throw new Error("Tailscale fixture capability boundary changed");
      contents = contents.replaceAll(before, after);
    }
    writeFileSync(fixtureResolver, contents);
  }
  const wrapper = join(root, "snapshot.sh");
  writeFileSync(
    wrapper,
    `#!/bin/bash
set -euo pipefail
source "$RESOLVER"
snapshot_cli="$(recordings_resolve_trusted_tailscale_app_cli "$SNAPSHOT_PARENT")"
printf 'resolved=%s\\n' "$snapshot_cli"
${
  options.replaceSourceBeforeStatus
    ? `printf '#!/bin/bash\\nprintf attacker\\n' > "$SOURCE_CLI"\n/bin/chmod 755 "$SOURCE_CLI"`
    : ""
}
recordings_run_trusted_tailscale_status "$snapshot_cli" "$SNAPSHOT_PARENT"
`,
  );
  chmodSync(wrapper, 0o755);
  const child = Bun.spawn(signingFixtureCommand(sandboxRoot!, ["/bin/bash", wrapper]), {
    cwd: root,
    env: resolverChildEnvironment(Bun.env, {
      RESOLVER: fixtureResolver,
      SNAPSHOT_PARENT: snapshotParent,
      SOURCE_CLI: source.cli,
      MARKER_DIRECTORY: markerDirectory,
      RECORDINGS_TEST_TRUSTED_TAILSCALE_APP: source.app,
      RECORDINGS_TEST_TAILSCALE_CODESIGN_EXECUTABLE: codesign,
      RECORDINGS_TEST_TAILSCALE_DITTO_EXECUTABLE: ditto,
    }),
    stdout: "pipe",
    stderr: "pipe",
  });
  const [exitCode, stdout, stderr] = await Promise.all([
    child.exited,
    new Response(child.stdout).text(),
    new Response(child.stderr).text(),
  ]);
  return { root, markerDirectory, snapshotParent, source, exitCode, stdout, stderr };
}

function resolverChildEnvironment(
  inheritedEnvironment: Record<string, string | undefined>,
  overrides: Record<string, string | undefined>,
): Record<string, string | undefined> {
  const environment: Record<string, string | undefined> = {
    HOME: sandboxRoot!, TMPDIR: sandboxRoot!, PATH: "/usr/bin:/bin",
    // Only the startup-injection negative control needs inherited fixture input.
    BASH_ENV: inheritedEnvironment.BASH_ENV, ENV: inheritedEnvironment.ENV,
    STARTUP_MARKER: inheritedEnvironment.STARTUP_MARKER,
    STARTUP_BIN: inheritedEnvironment.STARTUP_BIN,
    ...overrides,
  };
  delete environment.BASH_ENV;
  delete environment.ENV;
  return environment;
}

async function resolveWith(options: {
  path: string;
  fallback: string;
  invoke?: boolean;
  defineFunction?: string;
  inheritedEnvironment?: Record<string, string | undefined>;
}) {
  const root = temporaryDirectory();
  const wrapper = join(root, "run.sh");
  writeFileSync(
    wrapper,
    `#!/usr/bin/env bash
set -euo pipefail
[ -z "\${BASH_ENV+x}" ]
[ -z "\${ENV+x}" ]
source "$RESOLVER"
recordings_tailscale_standard_app_cli() { printf '%s\\n' "$FALLBACK"; }
${options.defineFunction ?? ""}
resolved="$(recordings_resolve_tailscale_cli)"
printf 'resolved=%s\\n' "$resolved"
${options.invoke ? '"$resolved" status --json' : ""}
`,
  );
  chmodSync(wrapper, 0o755);
  const child = Bun.spawn(signingFixtureCommand(sandboxRoot!, ["/bin/bash", wrapper]), {
    cwd: root,
    env: resolverChildEnvironment(options.inheritedEnvironment ?? Bun.env, {
      PATH: options.path,
      RESOLVER: resolver,
      FALLBACK: options.fallback,
    }),
    stdout: "pipe",
    stderr: "pipe",
  });
  const [exitCode, stdout, stderr] = await Promise.all([
    child.exited,
    new Response(child.stdout).text(),
    new Response(child.stderr).text(),
  ]);
  return { root, exitCode, stdout, stderr };
}

describe("Tailscale CLI resolution", () => {
  test("validates a canonical private snapshot parent using supported host tools", async () => {
    const root = temporaryDirectory();
    const result = await confinedShell(root, 'recordings_validate_private_tailscale_snapshot_parent "$FIXTURE_ROOT" "$(recordings_real_host_kernel)"', { FIXTURE_ROOT: root });
    expect(result.exitCode, result.stderr).toBe(0);
  });

  test.each(["leaf", "ancestor"])("rejects a snapshot parent with a symlinked %s", async (kind) => {
    const root = temporaryDirectory();
    const physical = join(root, "physical");
    mkdirSync(physical, { mode: 0o700 });
    const alias = join(root, "alias");
    symlinkSync(physical, alias);
    if (kind === "ancestor") mkdirSync(join(physical, "private"), { mode: 0o700 });
    const candidate = kind === "leaf" ? alias : join(alias, "private");
    const result = await confinedShell(root, 'recordings_validate_private_tailscale_snapshot_parent "$CANDIDATE" "$(recordings_real_host_kernel)"', { CANDIDATE: candidate });
    expect(result.exitCode).not.toBe(0);
    expect(result.stderr).toMatch(/existing private directory|canonical non-symlink directory/);
  });

  test("physical path validation ignores hostile PATH and CDPATH programs", async () => {
    const root = temporaryDirectory();
    const marker = join(root, "hostile-executed");
    for (const name of ["realpath", "pwd", "dirname", "basename", "cd"]) {
      writeExecutable(join(root, "bin", name), `printf hostile > ${shellQuote(marker)}\nexit 91\n`);
    }
    const cli = join(root, "bin", "tailscale");
    writeExecutable(cli);
    const result = await confinedShell(root, 'recordings_validate_trusted_tailscale_app_cli "$CANDIDATE" "$(recordings_real_host_kernel)"', {
      CANDIDATE: cli, PATH: join(root, "bin"), CDPATH: join(root, "bin"),
    });
    expect(result.exitCode, result.stderr).toBe(0);
    expect(existsSync(marker)).toBeFalse();
  });

  (process.platform === "darwin" ? test : test.skip)("OS confinement refuses an unmapped real codesign tool", async () => {
    const result = await trustedSnapshotWith({ unmappedCodesign: true });
    expect(result.exitCode).not.toBe(0);
    expect(result.stderr).toContain("codesign verifier is missing or is not executable");
    expect(existsSync(join(result.markerDirectory, "status-path.log"))).toBeFalse();
    const direct = await confinedShell(result.root, "/usr/bin/codesign --help");
    expect(direct.exitCode).not.toBe(0);
    expect(direct.stderr).toContain("Operation not permitted");
  });
  test("pins the production fallback to the standard Tailscale app CLI", () => {
    const source = readFileSync(resolver, "utf8");
    expect(source).toContain("'/Applications/Tailscale.app/Contents/MacOS/Tailscale'");
    expect(source).toContain("builtin type -P tailscale");
  });

  test("prefers a PATH executable over the app fallback", async () => {
    const root = temporaryDirectory();
    const pathCli = join(root, "bin", "tailscale");
    const fallback = join(root, "app", "Tailscale");
    writeExecutable(pathCli);
    writeExecutable(fallback);

    const result = await resolveWith({ path: dirname(pathCli), fallback });
    expect(result.exitCode, result.stderr).toBe(0);
    expect(result.stdout.trim()).toBe(`resolved=${pathCli}`);
  });

  test("uses an executable app fallback when PATH has no Tailscale CLI", async () => {
    const root = temporaryDirectory();
    const fallback = join(root, "Tailscale App", "Contents", "MacOS", "Tailscale");
    writeExecutable(fallback);

    const result = await resolveWith({ path: join(root, "empty-bin"), fallback });
    expect(result.exitCode, result.stderr).toBe(0);
    expect(result.stdout.trim()).toBe(`resolved=${fallback}`);
  });

  test("uses the app fallback when PATH shadows Tailscale with a non-executable file", async () => {
    const root = temporaryDirectory();
    const pathCli = join(root, "bin", "tailscale");
    const fallback = join(root, "app", "Tailscale");
    mkdirSync(dirname(pathCli), { recursive: true });
    writeFileSync(pathCli, "not executable\n");
    chmodSync(pathCli, 0o644);
    writeExecutable(fallback);

    const result = await resolveWith({ path: dirname(pathCli), fallback });
    expect(result.exitCode, result.stderr).toBe(0);
    expect(result.stdout.trim()).toBe(`resolved=${fallback}`);
  });

  test("accepts an executable PATH symlink and preserves its resolved command path", async () => {
    const root = temporaryDirectory();
    const realCli = join(root, "libexec", "tailscale-real");
    const pathCli = join(root, "bin", "tailscale");
    const fallback = join(root, "app", "Tailscale");
    writeExecutable(realCli);
    mkdirSync(dirname(pathCli), { recursive: true });
    symlinkSync(realCli, pathCli);
    writeExecutable(fallback);

    const result = await resolveWith({ path: dirname(pathCli), fallback });
    expect(result.exitCode, result.stderr).toBe(0);
    expect(result.stdout.trim()).toBe(`resolved=${pathCli}`);
  });

  test.each(["missing", "non-executable"])("rejects a %s fallback", async (kind) => {
    const root = temporaryDirectory();
    const fallback = join(root, "app", "Tailscale");
    if (kind === "non-executable") {
      mkdirSync(dirname(fallback), { recursive: true });
      writeFileSync(fallback, "not executable\n");
      chmodSync(fallback, 0o644);
    }

    const result = await resolveWith({ path: join(root, "empty-bin"), fallback });
    expect(result.exitCode).not.toBe(0);
    expect(result.stderr).toContain("not an executable file");
  });

  test("rejects a dangling fallback symlink", async () => {
    const root = temporaryDirectory();
    const fallback = join(root, "app", "Tailscale");
    mkdirSync(dirname(fallback), { recursive: true });
    symlinkSync(join(root, "missing-target"), fallback);

    const result = await resolveWith({ path: join(root, "empty-bin"), fallback });
    expect(result.exitCode).not.toBe(0);
    expect(result.stderr).toContain("not an executable file");
  });

  test.each([
    ["relative", "relative/Tailscale", "must be absolute"],
    ["multi-line", "/tmp/one\n/tmp/two", "malformed"],
    ["carriage-return", "/tmp/one\r/tmp/two", "malformed"],
  ])("rejects an ambiguous or unsafe %s path", async (_label, fallback, expectedError) => {
    const root = temporaryDirectory();
    const result = await resolveWith({ path: join(root, "empty-bin"), fallback });
    expect(result.exitCode).not.toBe(0);
    expect(result.stderr).toContain(expectedError);
  });

  test("quotes a resolved path instead of evaluating shell metacharacters", async () => {
    const root = temporaryDirectory();
    const marker = join(root, "injected");
    const bin = join(root, "bin");
    const fallback = join(root, `Tailscale;touch ${marker}`);
    writeExecutable(fallback, "printf '%s\\n' '{\"Self\":{\"Online\":true}}'\n");
    writeExecutable(join(bin, "touch"), ': > "$1"\n');

    const result = await resolveWith({ path: bin, fallback, invoke: true });
    expect(result.exitCode, result.stderr).toBe(0);
    expect(result.stdout).toContain('{"Self":{"Online":true}}');
    expect(existsSync(marker)).toBeFalse();
  });

  test("ignores an injected shell function named tailscale", async () => {
    const root = temporaryDirectory();
    const marker = join(root, "function-injected");
    const fallback = join(root, "app", "Tailscale");
    writeExecutable(fallback);

    const result = await resolveWith({
      path: join(root, "empty-bin"),
      fallback,
      defineFunction: `tailscale() { : > "${marker}"; }`,
    });
    expect(result.exitCode, result.stderr).toBe(0);
    expect(result.stdout.trim()).toBe(`resolved=${fallback}`);
    expect(existsSync(marker)).toBeFalse();
  });

  test.each(["BASH_ENV", "ENV"] as const)(
    "scrubs inherited %s before starting the fixture shell",
    async (startupVariable) => {
      const root = temporaryDirectory();
      const marker = join(root, "startup-environment-ran");
      const injectedBin = join(root, "injected-bin");
      const fallback = join(root, "app", "Tailscale");
      const startupFile = join(root, "startup.sh");
      writeExecutable(join(injectedBin, "tailscale"));
      writeExecutable(fallback);
      writeFileSync(startupFile, `: > "$STARTUP_MARKER"\nexport PATH="$STARTUP_BIN"\n`);

      const result = await resolveWith({
        path: join(root, "fixture-bin"),
        fallback,
        inheritedEnvironment: {
          ...Bun.env,
          [startupVariable]: startupFile,
          STARTUP_MARKER: marker,
          STARTUP_BIN: injectedBin,
        },
      });
      expect(result.exitCode, result.stderr).toBe(0);
      expect(result.stdout.trim()).toBe(`resolved=${fallback}`);
      expect(existsSync(marker)).toBeFalse();
    },
  );

  test("snapshots the complete authenticated official app and executes only the verified copy", async () => {
    const result = await trustedSnapshotWith({ replaceSourceBeforeStatus: true });
    expect(result.exitCode, result.stderr).toBe(0);
    const snapshotCli = join(
      result.snapshotParent,
      "tailscale-identity-snapshot",
      "Tailscale.app",
      "Contents",
      "MacOS",
      "Tailscale",
    );
    expect(result.stdout).toContain(`resolved=${snapshotCli}`);
    expect(result.stdout).toContain('"Online":true');
    expect(readFileSync(join(result.markerDirectory, "status-path.log"), "utf8").trim()).toBe(
      snapshotCli,
    );
    expect(result.stdout).not.toContain("attacker");
    const signingCalls = readFileSync(join(result.root, "codesign-arguments.log"), "utf8").trim().split("\n");
    expect(signingCalls.filter(line => line.startsWith("--verify"))).toHaveLength(6);
    expect(signingCalls.filter(line => line.startsWith("-d"))).toHaveLength(6);
  });

  test.each([
    ["wrong team", { team: "ATTACKER1" }, "official TeamIdentifier"],
    [
      "wrong identifier",
      { identifier: "io.attacker.fake" },
      "official bundle identifier",
    ],
    ["post-copy signature swap", { mutateSnapshot: true }, "authenticated after copying"],
  ] as const)("rejects a %s", async (_label, options, expectedError) => {
    const result = await trustedSnapshotWith(options);
    expect(result.exitCode).not.toBe(0);
    expect(result.stderr).toContain(expectedError);
    expect(existsSync(join(result.markerDirectory, "status-path.log"))).toBeFalse();
  });

  test("keeps all test app and tool overrides after the real Darwin branch", () => {
    const source = readFileSync(resolver, "utf8");
    // The kernel test this contract is about appears four times in the script, so every index below
    // is only correct relative to this one function. The anchor was the unguarded operand: a renamed
    // resolver left `resolverFunction` at -1, `indexOf(needle, -1)` clamps to 0, and the whole test
    // silently re-anchored on the first Darwin branch in the file — a different function's.
    //
    // Bounded at BOTH ends, which the -1 guard alone did not achieve. Slicing from the resolver to
    // the end of the FILE left every override claim below satisfiable by a different function:
    // `RECORDINGS_TEST_TAILSCALE_CODESIGN_EXECUTABLE` appears in this resolver's else AND in
    // `recordings_run_trusted_tailscale_status`'s else, so replacing the resolver's own override with
    // a hardcoded /usr/bin/codesign — removing the test seam from the function under test — still
    // passed, answered by the copy in the other function.
    const resolverBody = sliceBetweenUnique(
      source,
      "recordings_resolve_trusted_tailscale_app_cli() {",
      "\nrecordings_run_trusted_tailscale_status() {",
    );

    const darwinBranch = resolverBody.indexOf('if [ "$real_host_kernel" = "Darwin" ]; then');
    expect(darwinBranch, "the resolver has no real-kernel Darwin branch").toBeGreaterThan(-1);
    const nonDarwinBranch = resolverBody.indexOf("else", darwinBranch);
    expect(nonDarwinBranch, "the Darwin branch is never closed by an else").toBeGreaterThan(
      darwinBranch,
    );
    for (const override of [
      "RECORDINGS_TEST_TRUSTED_TAILSCALE_APP",
      "RECORDINGS_TEST_TAILSCALE_CODESIGN_EXECUTABLE",
      "RECORDINGS_TEST_TAILSCALE_DITTO_EXECUTABLE",
    ]) {
      // Each override must exist and live only after the else. The existence check is separate
      // because the two-argument `indexOf` reports a missing override and an override that moved
      // past the end of the region with the same -1, and only one of those is what this asserts.
      const overrideUse = resolverBody.indexOf(override, darwinBranch);
      expect(overrideUse, `test override is missing entirely: ${override}`).toBeGreaterThan(-1);
      expect(overrideUse).toBeGreaterThan(nonDarwinBranch);
    }
    // Same two bounds, but taken through `sliceBetween` so the region below cannot be the empty or
    // one-character string that satisfies `not.toContain("RECORDINGS_TEST_")` for free.
    const darwinSelection = sliceBetween(
      resolverBody,
      'if [ "$real_host_kernel" = "Darwin" ]; then',
      "else",
    );
    expect(darwinSelection).toContain('/Applications/Tailscale.app');
    expect(darwinSelection).toContain('/usr/bin/codesign');
    expect(darwinSelection).toContain('/usr/bin/ditto');
    expect(darwinSelection).not.toContain("RECORDINGS_TEST_");
  });
});
