import { afterEach, describe, expect, setDefaultTimeout, test } from "bun:test";
import {
  chmodSync,
  cpSync,
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
import { sliceBetweenUnique } from "./helpers/source-assertions";
import { adaptShellFixtureTools, benignShellExecutables, confinedShellCommand } from "./helpers/confined-shell-fixture";

const repositoryRoot = resolve(import.meta.dir, "../..");
const bunExecutable = process.execPath;
const temporaryPaths: string[] = [];
const fixtureSupervisors: Array<() => Promise<void>> = [];

setDefaultTimeout(15_000);

afterEach(async () => {
  for (const cleanup of fixtureSupervisors.splice(0)) await cleanup();
  for (const path of temporaryPaths.splice(0)) rmSync(path, { recursive: true, force: true });
});

function processIsRunning(pidFile: string): boolean {
  const pid = Number.parseInt(readFileSync(pidFile, "utf8"), 10);
  try {
    process.kill(pid, 0);
    return true;
  } catch {
    return false;
  }
}

function writeExecutable(path: string, contents: string): void {
  mkdirSync(dirname(path), { recursive: true });
  writeFileSync(path, contents);
  chmodSync(path, 0o755);
}

function normalEvidence(pid: number): string {
  return JSON.stringify({
    mode: "normal",
    processIdentifier: pid,
    menuBarSurfaceCount: 1,
    renderedStatusLabels: ["Recordings", "Recordings, recording", "Recordings, transcribing"],
    accessibilityObservationStatus: "available",
    accessibilityMenuBarItemCount: 1,
    accessibilityMenuBarLabels: ["Recordings, transcribing"],
    globalHandlersInstalled: false,
    permissionRequestsStarted: 0,
    windowCreationCount: 1,
    windowActivationCount: 2,
    retainedWindowReused: true,
    applicationActivationPolicy: 0,
    applicationIsActive: false,
    mainWindowIsVisible: true,
    mainWindowCanBecomeKey: true,
    mainWindowIsKey: false,
    resolvedCompanionPath: null,
    companionCapabilitiesPassed: false,
  });
}

function createSmokeFixture(
  options: {
    completionBehavior?:
      | "correct"
      | "ignore"
      | "ignore-term"
      | "wrong-challenge"
      | "wrong-mode"
      | "wrong-pid";
    invalidEvidence?: boolean;
    missingEvidence?: boolean;
    malformedPidEvidence?: boolean;
    preexistingExactApp?: boolean;
    stayAliveUntilSignaled?: boolean;
    wrapperExitsBeforeAppCompletion?: boolean;
    appIdentityChangesAfterCalls?: number;
    wrapperExitCode?: number;
  } = {},
) {
  const root = realpathSync(mkdtempSync(join(tmpdir(), "recordings-smoke-identity-")));
  temporaryPaths.push(root);
  const bin = join(root, "bin");
  const app = join(root, "Hasna Recordings.app");
  const executable = join(app, "Contents", "MacOS", "Recordings");
  const appAcknowledgementPath = join(root, "app-acknowledgement.path");
  const preexistingAppPid = join(root, "preexisting-app.pid");
  const smokeScript = join(root, "smoke_macos_app.sh");
  const openExecutable = join(bin, "open");
  const killExecutable = join(bin, "kill");
  const killLog = join(root, "kill.log");
  const appPid = join(root, "app.pid");
  const appExitMarker = join(root, "app.exited");
  const completionWriterPid = join(root, "completion-writer.pid");
  const psCalls = join(root, "app-ps-calls");
  const signalMarker = join(root, "app.signal");
  const wrapperExitMarker = join(root, "wrapper.exited");
  const wrapperPid = join(root, "wrapper.pid");
  const workdirMode = join(root, "workdir.mode");

  mkdirSync(dirname(executable), { recursive: true });
  cpSync(join(repositoryRoot, "scripts", "smoke_macos_app.sh"), smokeScript);
  let smokeSource = readFileSync(smokeScript, "utf8");
  expect(smokeSource).toContain("terminate_verified_process()");
  expect(smokeSource).toContain('"$KILL_EXECUTABLE" -TERM "$pid"');
  expect(smokeSource).toContain('"$KILL_EXECUTABLE" -KILL "$pid"');
  expect(smokeSource).toContain("run_smoke normal\nrun_smoke permission-helper\nrun_smoke resolver");
  smokeSource = smokeSource
    // Allow a full second for the confined shell app to launch; the old 300ms
    // budget sometimes expired before it had written any evidence.
    .replace("SMOKE_MAX_ATTEMPTS=100", "SMOKE_MAX_ATTEMPTS=10")
    .replace("SMOKE_COMPLETION_ATTEMPTS=200", "SMOKE_COMPLETION_ATTEMPTS=3")
    .replace("SMOKE_CLEANUP_ATTEMPTS=20", "SMOKE_CLEANUP_ATTEMPTS=3")
    .replace(
      "run_smoke normal\nrun_smoke permission-helper\nrun_smoke resolver",
      "run_smoke normal",
    );
  writeFileSync(smokeScript, smokeSource);
  chmodSync(smokeScript, 0o755);

  const evidence = options.malformedPidEvidence
    ? '{"mode":"normal","processIdentifier":"not-a-pid"}'
    : options.invalidEvidence
      ? '{"mode":"normal","processIdentifier":%s}'
      : normalEvidence(0).replace('"processIdentifier":0', '"processIdentifier":%s');
  const evidenceWrite = options.missingEvidence
    ? ":"
    : options.malformedPidEvidence
      ? `printf '${evidence}\\n' > "$output"`
      : `printf '${evidence}\\n' "$$" > "$output"`;
  const completionBehavior = options.completionBehavior ?? "correct";
  const termTrap = completionBehavior === "ignore-term"
    ? `trap 'printf TERM > "${signalMarker}"' TERM`
    : `trap 'printf TERM > "${signalMarker}"; exit 97' TERM`;
  const wrapperExitCode = options.wrapperExitCode ?? 0;
  writeExecutable(
    executable,
    `#!/bin/bash
set -euo pipefail
output=""
acknowledgement=""
completion=""
mode=""
trap 'printf exited > "${appExitMarker}"' EXIT
${termTrap}
while [ "$#" -gt 0 ]; do
  if [ "$1" = --runtime-smoke ]; then mode="$2"; shift 2; continue; fi
  if [ "$1" = --runtime-smoke-output ]; then output="$2"; shift 2; continue; fi
  if [ "$1" = --runtime-smoke-ack ]; then acknowledgement="$2"; shift 2; continue; fi
  if [ "$1" = --runtime-smoke-completion ]; then completion="$2"; shift 2; continue; fi
  shift
done
printf '%s\\n' "$acknowledgement" > "${appAcknowledgementPath}"
printf '%s\\n' "$$" > "${appPid}"
while [ ! -s "${appPid}" ]; do /bin/sleep 0.01; done
'${bunExecutable}' -e '
  import { statSync, writeFileSync } from "node:fs";
  writeFileSync(process.argv[2], (statSync(process.argv[1]).mode & 0o777).toString(8));
' "\${acknowledgement%/*}" "${workdirMode}"
${evidenceWrite}
if [ '${options.stayAliveUntilSignaled ? "yes" : "no"}' = yes ]; then
  while true; do /bin/sleep 0.01; done
elif [ '${completionBehavior}' != ignore ] && [ '${completionBehavior}' != ignore-term ]; then
  while [ ! -e "$acknowledgement" ]; do /bin/sleep 0.01; done
  IFS= read -r challenge < "$acknowledgement"
  completion_challenge="$challenge"
  completion_mode="$mode"
  completion_pid="$$"
  if [ '${completionBehavior}' = wrong-challenge ]; then completion_challenge="wrong-$challenge"; fi
  if [ '${completionBehavior}' = wrong-mode ]; then completion_mode="wrong-$mode"; fi
  if [ '${completionBehavior}' = wrong-pid ]; then completion_pid="$((completion_pid + 1))"; fi
  printf '%s\\n' "$$" > "${completionWriterPid}"
  printf '{"challenge":"%s","mode":"%s","processIdentifier":%s}\\n' \
    "$completion_challenge" "$completion_mode" "$completion_pid" > "$completion.tmp"
  /bin/mv "$completion.tmp" "$completion"
else
  wrapper_pid="$PPID"
  while kill -0 "$wrapper_pid" 2>/dev/null; do /bin/sleep 0.01; done
fi
`,
  );

  writeExecutable(
    openExecutable,
    `#!/bin/bash
set -euo pipefail
trap 'printf exited > "${wrapperExitMarker}"' EXIT
printf '%s\n' "$$" > "${wrapperPid}"
app=""
while [ "$#" -gt 0 ]; do
  if [ "$1" = -W ]; then app="$2"; shift 2; continue; fi
  if [ "$1" = --args ]; then shift; break; fi
  shift
done
"$app/Contents/MacOS/Recordings" "$@" &
launched_pid="$!"
while [ ! -s "${appPid}" ]; do /bin/sleep 0.01; done
if [ "$(sed -n '1p' "${appPid}")" != "$launched_pid" ]; then
  exit 91
fi
if [ '${options.wrapperExitsBeforeAppCompletion ? "yes" : "no"}' = yes ]; then
  exit 29
fi
if wait "$launched_pid"; then app_status=0; else app_status=$?; fi
if [ '${wrapperExitCode}' -ne 0 ]; then exit '${wrapperExitCode}'; fi
exit "$app_status"
`,
  );

  writeExecutable(
    killExecutable,
    `#!/bin/bash
set -euo pipefail
printf '%s\\n' "$*" >> '${killLog}'
exec /bin/kill "$@"
`,
  );

  writeExecutable(
    join(bin, "lsof"),
    `#!/bin/bash
set -euo pipefail
pid=""
while [ "$#" -gt 0 ]; do
  if [ "$1" = -p ]; then pid="$2"; shift 2; else shift; fi
done
[ -n "$pid" ] || exit 1
printf 'p%s\\nn/unrelated/first-txt-record\\n' "$pid"
app_pid=""
if [ -s '${appPid}' ]; then IFS= read -r app_pid < '${appPid}'; fi
preexisting_app_pid=""
if [ -s '${preexistingAppPid}' ]; then IFS= read -r preexisting_app_pid < '${preexistingAppPid}'; fi
if [ "$pid" = "$app_pid" ] || [ "$pid" = "$preexisting_app_pid" ]; then
  printf 'n%s\\n' '${executable}'
else
  printf 'n%s\\n' '${openExecutable}'
fi
`,
  );

  const identityChangesAfterCalls = options.appIdentityChangesAfterCalls ?? 1_000_000;
  writeExecutable(
    join(bin, "ps"),
    `#!/bin/bash
set -euo pipefail
if [ "\${1:-}" = -axo ]; then
  if [ -s '${preexistingAppPid}' ]; then
    IFS= read -r preexisting_app_pid < '${preexistingAppPid}'
    printf ' %s %s --runtime-smoke existing\\n' "$preexisting_app_pid" '${executable}'
  fi
  if [ -s '${appPid}' ]; then
    IFS= read -r app_pid < '${appPid}'
    IFS= read -r app_acknowledgement < '${appAcknowledgementPath}'
    printf ' %s %s --runtime-smoke normal --runtime-smoke-ack %s\\n' \
      "$app_pid" '${executable}' "$app_acknowledgement"
  fi
  exit 0
fi
pid=""
while [ "$#" -gt 0 ]; do
  if [ "$1" = -p ]; then pid="$2"; shift 2; else shift; fi
done
[ -n "$pid" ] || exit 1
app_pid=""
if [ -s '${appPid}' ]; then IFS= read -r app_pid < '${appPid}'; fi
preexisting_app_pid=""
if [ -s '${preexistingAppPid}' ]; then IFS= read -r preexisting_app_pid < '${preexistingAppPid}'; fi
if [ "$pid" = "$app_pid" ]; then
  calls=0
  if [ -f '${psCalls}' ]; then IFS= read -r calls < '${psCalls}'; fi
  calls=$((calls + 1))
  printf '%s\\n' "$calls" > '${psCalls}'
  if [ "$calls" -gt '${identityChangesAfterCalls}' ]; then
    printf 'Sat Jul 18 12:00:01 2026\\n'
  else
    printf 'Sat Jul 18 12:00:00 2026\\n'
  fi
elif [ "$pid" = "$preexisting_app_pid" ]; then
  printf 'Sat Jul 18 11:59:00 2026\\n'
else
  printf 'Sat Jul 18 12:00:02 2026\\n'
fi
`,
  );

  const mktempExecutable = join(bin, "mktemp");
  mkdirSync(join(root, "work"));
  writeExecutable(mktempExecutable, `#!/bin/bash
set -euo pipefail
[ "$#" -eq 2 ] && [ "$1" = -d ] || exit 90
exec /usr/bin/mktemp -d '${root}/work/'"\${2##*/}"
`);
  smokeSource = adaptShellFixtureTools(smokeSource, "for executable_spec in ", {
    OPEN_EXECUTABLE: openExecutable,
    KILL_EXECUTABLE: killExecutable,
    LSOF_EXECUTABLE: join(bin, "lsof"),
    PS_EXECUTABLE: join(bin, "ps"),
    MKTEMP_EXECUTABLE: mktempExecutable,
  });
  writeFileSync(smokeScript, smokeSource);

  return {
    app,
    preexistingExactApp: options.preexistingExactApp ?? false,
    appExitMarker,
    appPid,
    completionWriterPid,
    lsofExecutable: join(bin, "lsof"),
    killExecutable,
    killLog,
    openExecutable,
    preexistingAppPid,
    psCalls,
    psExecutable: join(bin, "ps"),
    root,
    signalMarker,
    smokeScript,
    workdirMode,
    wrapperExitMarker,
    wrapperPid,
  };
}

async function runSmoke(fixture: ReturnType<typeof createSmokeFixture>) {
  const supervisorPath = join(fixture.root, "supervisor.sh");
  const receipt = join(fixture.root, "smoke.status");
  const stdout = join(fixture.root, "smoke.stdout");
  const stderr = join(fixture.root, "smoke.stderr");
  const smokePid = join(fixture.root, "smoke.pid");
  const ownedPidFiles = [fixture.appPid, fixture.preexistingAppPid, fixture.wrapperPid, smokePid];
  writeExecutable(supervisorPath, `#!/bin/bash
set -euo pipefail
cleanup() {
  trap - EXIT TERM INT HUP
  for file in ${ownedPidFiles.map((file) => `'${file}'`).join(" ")}; do
    [ -s "$file" ] || continue
    IFS= read -r pid < "$file"
    [[ "$pid" =~ ^[1-9][0-9]*$ ]] && [ "$pid" != "$$" ] || continue
    # Kernel sandbox additionally restricts signals to this sandbox's cohort.
    /bin/kill -KILL "$pid" 2>/dev/null || true
  done
  wait 2>/dev/null || true
}
trap cleanup EXIT
trap 'exit 93' TERM INT HUP
if [ '${fixture.preexistingExactApp ? "yes" : "no"}' = yes ]; then
  /bin/sleep 60 &
  printf '%s\n' "$!" > '${fixture.preexistingAppPid}'
fi
/bin/bash '${fixture.smokeScript}' '${fixture.app}' '${bunExecutable}' > '${stdout}' 2> '${stderr}' &
printf '%s\n' "$!" > '${smokePid}'
if wait "$!"; then status=0; else status=$?; fi
printf '%s\n' "$status" > '${receipt}.tmp'
/bin/mv '${receipt}.tmp' '${receipt}'
IFS= read -r cleanup_request || true
`);
  const supervisor = Bun.spawn(confinedShellCommand(fixture.root, ["/bin/bash", supervisorPath], benignShellExecutables), {
    env: { HOME: fixture.root, TMPDIR: fixture.root, PATH: "/usr/bin:/bin:/usr/sbin:/sbin", SSH_CONNECTION: "fixture-authenticated-ssh" },
    cwd: fixture.root,
    stdin: "pipe", stdout: "ignore", stderr: "pipe", detached: true,
  });
  const supervisorErrors = new Response(supervisor.stderr).text();
  fixtureSupervisors.push(async () => {
    if (supervisor.exitCode === null) {
      supervisor.stdin.write("cleanup\n");
      supervisor.stdin.end();
    }
    const timer = setTimeout(() => supervisor.kill("SIGTERM"), 3_000);
    try { await supervisor.exited; } finally { clearTimeout(timer); }
    const errors = await supervisorErrors;
    expect(supervisor.exitCode, errors).toBe(0);
  });
  const deadline = Date.now() + 12_000;
  while (!existsSync(receipt)) {
    if (supervisor.exitCode !== null) throw new Error(`fixture supervisor exited: ${await supervisorErrors}`);
    if (Date.now() >= deadline) throw new Error("fixture smoke deadline exceeded");
    await Bun.sleep(20);
  }
  return { exitCode: Number(readFileSync(receipt, "utf8").trim()), stdout: readFileSync(stdout, "utf8"), stderr: readFileSync(stderr, "utf8") };
}

describe("macOS runtime smoke process identity", () => {
  test("fixture tool adaptation refuses ambiguous boundaries and unsafe executables", () => {
    const fixture = createSmokeFixture();
    const tools = { OPEN_EXECUTABLE: fixture.openExecutable };
    expect(() => adaptShellFixtureTools("no boundary", "boundary!", tools)).toThrow("missing or ambiguous");
    expect(() => adaptShellFixtureTools("boundary!boundary!", "boundary!", tools)).toThrow("missing or ambiguous");
    expect(() => adaptShellFixtureTools("boundary!", "boundary!", { "BAD;_EXECUTABLE": fixture.openExecutable })).toThrow("invalid fixture tool binding");
    const link = join(fixture.root, "linked-tool");
    symlinkSync(fixture.openExecutable, link);
    expect(() => adaptShellFixtureTools("boundary!", "boundary!", { OPEN_EXECUTABLE: link })).toThrow("owned regular executable");
    chmodSync(fixture.openExecutable, 0o777);
    expect(() => adaptShellFixtureTools("boundary!", "boundary!", tools)).toThrow("owned regular executable");
    chmodSync(fixture.openExecutable, 0o600);
    expect(() => adaptShellFixtureTools("boundary!", "boundary!", tools)).toThrow("owned regular executable");
    chmodSync(fixture.openExecutable, 0o700);
    const bound = adaptShellFixtureTools("Darwin-selection\nboundary!", "boundary!", tools);
    expect(bound.indexOf("OPEN_EXECUTABLE=")).toBeGreaterThan(bound.indexOf("Darwin-selection"));
    chmodSync(fixture.root, 0o755);
    try {
      expect(() => confinedShellCommand(fixture.root, [bunExecutable])).toThrow("owned canonical private root");
    } finally { chmodSync(fixture.root, 0o700); }
  });

  test("unadapted Darwin smoke ignores inherited tools and fails closed inside the fixture", () => {
    if (process.platform !== "darwin") return;
    const fixture = createSmokeFixture();
    cpSync(join(repositoryRoot, "scripts", "smoke_macos_app.sh"), fixture.smokeScript);
    const result = Bun.spawnSync(confinedShellCommand(fixture.root, ["/bin/bash", fixture.smokeScript, fixture.app, bunExecutable], benignShellExecutables), {
      cwd: fixture.root,
      env: {
        HOME: fixture.root, TMPDIR: fixture.root, PATH: "/usr/bin:/bin",
        RECORDINGS_TEST_SMOKE_OPEN_EXECUTABLE: fixture.openExecutable,
        RECORDINGS_TEST_SMOKE_LSOF_EXECUTABLE: fixture.lsofExecutable,
        RECORDINGS_TEST_SMOKE_PS_EXECUTABLE: fixture.psExecutable,
      },
    });
    expect(result.exitCode).not.toBe(0);
    expect(result.stderr.toString()).toContain("LSOF_EXECUTABLE");
    expect(result.stderr.toString()).toContain("/usr/sbin/lsof");
    expect(existsSync(fixture.appPid)).toBeFalse();
    expect(existsSync(fixture.wrapperPid)).toBeFalse();
  });

  test("Darwin fixture confinement rejects host tools, outside writes, and foreign signals", async () => {
    if (process.platform !== "darwin") return;
    const fixture = createSmokeFixture();
    const run = (command: string[]) => Bun.spawnSync(confinedShellCommand(fixture.root, command, benignShellExecutables), {
      cwd: fixture.root,
      env: { HOME: fixture.root, TMPDIR: fixture.root, PATH: "/usr/bin:/bin" },
    });
    for (const tool of ["/usr/bin/open", "/usr/bin/defaults", "/usr/bin/codesign", "/usr/bin/security", "/usr/bin/tccutil"]) {
      const denied = run([tool, "--help"]);
      expect(denied.exitCode).not.toBe(0);
      expect(denied.stderr.toString()).toContain("Operation not permitted");
    }
    const inside = join(fixture.root, "allowed-write");
    expect(run([bunExecutable, "-e", `require("node:fs").writeFileSync(${JSON.stringify(inside)}, "fixture")`]).exitCode).toBe(0);
    expect(readFileSync(inside, "utf8")).toBe("fixture");
    const outsideRoot = realpathSync(mkdtempSync(join(tmpdir(), "recordings-foreign-write-")));
    temporaryPaths.push(outsideRoot);
    const outside = join(outsideRoot, "must-not-exist");
    run([bunExecutable, "-e", `require("node:fs").writeFileSync(${JSON.stringify(outside)}, "forbidden")`]);
    // Bun can exit zero on sandbox-denied writes. Inspect the independent
    // target, not only an exit code or a swallowed exception.
    expect(existsSync(outside)).toBe(false);
    const foreign = Bun.spawn(["/bin/sleep", "30"], { stdout: "ignore", stderr: "ignore" });
    try {
      const denied = run([bunExecutable, "-e", `
        try { process.kill(${foreign.pid}, "SIGTERM"); console.log("escaped"); }
        catch (error) { console.log(error.code); }
      `]);
      expect(denied.stdout.toString().trim()).toBe("EPERM");
      await Bun.sleep(20);
      expect(foreign.exitCode).toBeNull();
      const allowed = run([bunExecutable, "-e", `
        const child = Bun.spawn(["/bin/sleep", "30"]);
        process.kill(child.pid, "SIGTERM");
        await child.exited;
        console.log("owned child stopped");
      `]);
      expect(allowed.exitCode, allowed.stderr.toString()).toBe(0);
      expect(allowed.stdout.toString().trim()).toBe("owned child stopped");
    } finally {
      foreign.kill();
      await foreign.exited;
    }
  });

  test("uses challenge-bound completion with identity-verified failure cleanup", () => {
    const smokeSource = readFileSync(
      join(repositoryRoot, "scripts", "smoke_macos_app.sh"),
      "utf8",
    );
    const appSource = readFileSync(
      join(repositoryRoot, "src", "native", "Recordings", "App", "RecordingsApp.swift"),
      "utf8",
    );
    const launchPlanSource = readFileSync(
      join(
        repositoryRoot,
        "src",
        "native",
        "Recordings",
        "RecordingsLib",
        "PermissionRequestLaunchPlan.swift",
      ),
      "utf8",
    );

    expect(smokeSource).toContain('--runtime-smoke-ack "$acknowledgement"');
    expect(smokeSource).toContain('--runtime-smoke-completion "$completion"');
    expect(smokeSource).toContain("umask 077");
    expect(smokeSource).toContain("crypto.randomUUID()");
    // The claim is that the signals below are sent from *inside* the identity-verified terminator,
    // never from anywhere that skipped the recheck. With an unguarded `indexOf`, renaming
    // `cleanup()` answers -1 and `slice(start, -1)` widens the region from the helper to the whole
    // rest of the script — at which point the same four assertions pass with the TERM and the KILL
    // moved out into an unverified code path, which is the regression this test exists for.
    const terminationHelper = sliceBetweenUnique(
      smokeSource,
      "terminate_verified_process()",
      "cleanup()",
    );
    expect(terminationHelper).toContain(
      'capture_process_start_identity "$pid" "$expected_executable"',
    );
    expect(terminationHelper).toContain(
      '[ "$rechecked_start_identity" != "$expected_start_identity" ]',
    );
    expect(terminationHelper).toContain('"$KILL_EXECUTABLE" -TERM "$pid"');
    expect(terminationHelper).toContain('"$KILL_EXECUTABLE" -KILL "$pid"');
    expect(appSource).toContain("runtimeSmokeAcknowledgementPath");
    expect(appSource).toContain("runtimeSmokeCompletionPath");
    expect(appSource).toContain("contentsOfFile: acknowledgementPath");
    // `Darwin._exit(0)` is the end bound because the contract is ordered: the completion response
    // reaches disk, atomically, and only then does the process leave. That bound was doing no work
    // — delete or relocate the exit and `indexOf` answers -1, `slice(start, -1)` keeps everything
    // to the end of the file, and "written atomically before the exit" decays into "some atomic
    // write appears after the response is built", which any later write in this file would supply.
    // Requiring both bounds to be unique also refuses a second completion writer: two copies means
    // the pin is aimed at whichever came first, including a dead one.
    const completionWriter = sliceBetweenUnique(
      appSource,
      "let response = RuntimeSmokeCompletionResponse(",
      "Darwin._exit(0)",
    );
    expect(completionWriter).toContain("responseData.write(");
    expect(completionWriter).toContain("options: .atomic");
    // There is deliberately no `expect(appSource).toContain("Darwin._exit(0)")` here. The end bound
    // above already requires that string to occur EXACTLY once, which is strictly stronger, and a
    // redundant assertion is not free: if the uniqueness bound is ever weakened, a surviving
    // `toContain` still passes and still reads as coverage, so losing the real guarantee becomes
    // invisible — the exact failure this suite was swept to remove. Duplicating `Darwin._exit(0)`
    // is the mutation that separates them: the bare `toContain` stays green on it, the bound does
    // not.
    expect(launchPlanSource).toContain('"--runtime-smoke-ack"');
    expect(launchPlanSource).toContain('"--runtime-smoke-completion"');
  });

  test("accepts the exact executable when it is not the first lsof txt record", async () => {
    const fixture = createSmokeFixture();
    const result = await runSmoke(fixture);
    expect(result.exitCode, result.stderr).toBe(0);
    expect(result.stdout).toContain('"event":"recordings_runtime_smoke_evidence"');
    expect(readFileSync(fixture.completionWriterPid, "utf8")).toBe(
      readFileSync(fixture.appPid, "utf8"),
    );
    expect(readFileSync(fixture.workdirMode, "utf8")).toBe("700");
  });

  test("does not send PID-directed TERM during normal completion", async () => {
    const fixture = createSmokeFixture();
    const result = await runSmoke(fixture);
    expect(result.exitCode, result.stderr).toBe(0);
    expect(existsSync(fixture.killLog) ? readFileSync(fixture.killLog, "utf8") : "").not.toContain(
      "-TERM ",
    );
  });

  test("does not send PID-directed KILL during cooperative completion", async () => {
    const fixture = createSmokeFixture();
    const result = await runSmoke(fixture);
    expect(result.exitCode, result.stderr).toBe(0);
    expect(existsSync(fixture.killLog) ? readFileSync(fixture.killLog, "utf8") : "").not.toContain(
      "-KILL ",
    );
  });

  test("EXIT cleanup acknowledges the app without signaling its evidence PID", async () => {
    const fixture = createSmokeFixture({
      invalidEvidence: true,
    });
    const result = await runSmoke(fixture);
    expect(result.exitCode).not.toBe(0);
    expect(existsSync(fixture.signalMarker)).toBeFalse();
  });

  test("terminates the exact live app when PID evidence never appears and the wrapper exits", async () => {
    const fixture = createSmokeFixture({
      missingEvidence: true,
      stayAliveUntilSignaled: true,
      wrapperExitsBeforeAppCompletion: true,
    });
    const result = await runSmoke(fixture);
    expect(result.exitCode).not.toBe(0);
    expect(result.stderr).toContain("exited without evidence");
    expect(existsSync(fixture.signalMarker)).toBeTrue();
    expect(existsSync(fixture.appExitMarker)).toBeTrue();
    expect(existsSync(fixture.wrapperExitMarker)).toBeTrue();
    expect(processIsRunning(fixture.appPid)).toBeFalse();
    expect(processIsRunning(fixture.wrapperPid)).toBeFalse();
  });

  test("terminates the exact live app when PID evidence is malformed", async () => {
    const fixture = createSmokeFixture({
      malformedPidEvidence: true,
      preexistingExactApp: true,
      stayAliveUntilSignaled: true,
    });
    const result = await runSmoke(fixture);
    expect(result.exitCode).not.toBe(0);
    expect(result.stderr).toContain("reported a process that is not running");
    expect(existsSync(fixture.signalMarker)).toBeTrue();
    expect(existsSync(fixture.appExitMarker)).toBeTrue();
    expect(existsSync(fixture.wrapperExitMarker)).toBeTrue();
    expect(processIsRunning(fixture.appPid)).toBeFalse();
    expect(processIsRunning(fixture.preexistingAppPid)).toBeTrue();
    expect(processIsRunning(fixture.wrapperPid)).toBeFalse();
  });

  test("fails when the app ignores the completion challenge", async () => {
    const fixture = createSmokeFixture({ completionBehavior: "ignore" });
    const startedAt = Date.now();
    const result = await runSmoke(fixture);
    const elapsedMilliseconds = Date.now() - startedAt;
    expect(result.exitCode).not.toBe(0);
    expect(result.stderr).toContain("completion handshake timed out");
    expect(elapsedMilliseconds).toBeLessThan(5_000);
    expect(existsSync(fixture.completionWriterPid)).toBeFalse();
    expect(existsSync(fixture.signalMarker)).toBeTrue();
    expect(existsSync(fixture.appExitMarker)).toBeTrue();
    expect(existsSync(fixture.wrapperExitMarker)).toBeTrue();
    expect(processIsRunning(fixture.appPid)).toBeFalse();
    expect(processIsRunning(fixture.wrapperPid)).toBeFalse();
  });

  test("refuses to signal a timeout PID whose start identity changed", async () => {
    const fixture = createSmokeFixture({
      completionBehavior: "ignore",
      appIdentityChangesAfterCalls: 6,
    });
    const result = await runSmoke(fixture);
    expect(result.exitCode).not.toBe(0);
    expect(result.stderr).toContain("completion handshake timed out");
    expect(result.stderr).toContain("Refusing to signal Hasna Recordings.app");
    expect(existsSync(fixture.signalMarker)).toBeFalse();
  });

  test("force-terminates the same verified app when it ignores TERM", async () => {
    const fixture = createSmokeFixture({ completionBehavior: "ignore-term" });
    const result = await runSmoke(fixture);
    expect(result.exitCode).not.toBe(0);
    expect(result.stderr).toContain("completion handshake timed out");
    expect(existsSync(fixture.signalMarker)).toBeTrue();
    expect(existsSync(fixture.appExitMarker)).toBeFalse();
    expect(existsSync(fixture.wrapperExitMarker)).toBeTrue();
    expect(processIsRunning(fixture.appPid)).toBeFalse();
    expect(processIsRunning(fixture.wrapperPid)).toBeFalse();
  });

  test("fails when the app returns the wrong completion challenge", async () => {
    const fixture = createSmokeFixture({ completionBehavior: "wrong-challenge" });
    const result = await runSmoke(fixture);
    expect(result.exitCode).not.toBe(0);
    expect(result.stderr).toContain("did not provide a valid completion response");
  });

  test("fails when the app returns the wrong completion mode", async () => {
    const fixture = createSmokeFixture({ completionBehavior: "wrong-mode" });
    const result = await runSmoke(fixture);
    expect(result.exitCode).not.toBe(0);
    expect(result.stderr).toContain("did not provide a valid completion response");
  });

  test("fails when the app returns the wrong completion PID", async () => {
    const fixture = createSmokeFixture({ completionBehavior: "wrong-pid" });
    const result = await runSmoke(fixture);
    expect(result.exitCode).not.toBe(0);
    expect(result.stderr).toContain("did not provide a valid completion response");
  });

  test("fails when the open wrapper exits nonzero after app completion", async () => {
    const fixture = createSmokeFixture({ wrapperExitCode: 23 });
    const result = await runSmoke(fixture);
    expect(result.exitCode).not.toBe(0);
    expect(result.stderr).toContain("open -W wrapper exited unsuccessfully");
  });

  test("rechecks the evidence process identity immediately before issuing the challenge", async () => {
    const fixture = createSmokeFixture({ appIdentityChangesAfterCalls: 4 });
    const result = await runSmoke(fixture);
    expect(result.exitCode).not.toBe(0);
    expect(result.stderr).toContain("process identity changed before completion challenge");
    expect(existsSync(fixture.signalMarker)).toBeFalse();
  });
});
