// Regression tests for the bar-only successor lane (task 4ee4ebbf-9a10-4181-8e43-9307d56e684b).
//
// These lock the three P1 defect classes of the terminated hasna/apps#269 lineage plus the
// signing support and the fleet naming rule:
//
// 1. run_swift empty-array abort — a bare "${arr[@]}" on an EMPTY array under `set -u` aborts
//    bash < 4.4 (macOS /bin/bash is 3.2.57), killing every macOS build the moment a variant
//    flag array exists. The script-wide guarded idiom is ${arr[0]+"${arr[@]}"}.
// 2. Windowless-branch runtime smoke — the full build's normal-mode runtime smoke must keep
//    exercising the workspace window (windowCreationCount==1), and only bar builds finish
//    windowless. Keying the windowless branch on `declaresMainWindow` (which excludes every
//    runtime smoke) made the FULL smoke fail deterministically.
// 3. Variant wiring + release rejection — the build/install path must actually pass the
//    variant through, reject release-mode bar without an explicit mark, and verify the
//    manifest variant at install time (verify-archive/verify-app/verify-active).
// 4. Developer ID signing support — signing identity from env, discovery fallback via
//    `security find-identity -v -p codesigning`, fail loudly when a Developer ID is
//    requested but none exists.
// 5. Naming — the bar artifact is Hasna Recordings.app per the fleet rule (knowledge
//    k_msxd5rz3_jfvl3i): bundle id stays com.hasna.recordings (TCC keys on it), display
//    name "Hasna Recordings"; the 'bar' is a variant, never a separately named app (no
//    Hasna RecordingsBar.app / RecordingsBar.app).
//
// Pure source assertions run on every platform; fixture runs are gated to non-Darwin hosts
// (the build.sh/installer fixture seams are deliberately closed on real Darwin hosts) and the
// pre-4.4 bash proof is gated on a docker bash:4.3 image.

import { afterEach, describe, expect, test } from "bun:test";
import {
  chmodSync,
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

const buildScript = readFileSync("src/native/Recordings/build.sh", "utf8");
const launchPlanScript = readFileSync(
  "src/native/Recordings/RecordingsLib/PermissionRequestLaunchPlan.swift",
  "utf8",
);
const appScript = readFileSync("src/native/Recordings/App/RecordingsApp.swift", "utf8");
const smokeScript = readFileSync("scripts/smoke_macos_app.sh", "utf8");
const installScript = readFileSync("scripts/install_macos_app.sh", "utf8");
const artifactTool = readFileSync("scripts/macos_artifact.ts", "utf8");
const infoPlist = readFileSync("src/native/Recordings/RecordingsLib/Info.plist", "utf8");

const temporaryDirectories: string[] = [];

// Fixture runs that spawn build.sh/installer fixtures on the host kernel are only
// meaningful off-Darwin: the fixtures exercise the non-Darwin test seams, and some
// assertions depend on /usr/bin/swift being ABSENT (it exists on a real Mac).
const isDarwin = process.platform === "darwin";

afterEach(() => {
  for (const directory of temporaryDirectories.splice(0)) {
    rmSync(directory, { recursive: true, force: true });
  }
});

function temporaryDirectory(label: string): string {
  const root = mkdtempSync(join(tmpdir(), `recordings-bar-${label}-`));
  temporaryDirectories.push(root);
  return root;
}

function writeExecutable(path: string, body: string): void {
  writeFileSync(path, body);
  chmodSync(path, 0o755);
}

/** Extract a `name() { ... }` function body from a bash script by brace depth. */
function extractBashFunction(source: string, name: string): string {
  const lines = source.split("\n");
  const start = lines.findIndex((line) => line.trim() === `${name}() {`);
  expect(start, `bash function ${name}() not found in the source`).toBeGreaterThanOrEqual(0);
  let depth = 0;
  const body: string[] = [];
  for (let index = start; index < lines.length; index += 1) {
    body.push(lines[index]);
    depth += (lines[index].match(/\{/g) ?? []).length - (lines[index].match(/\}/g) ?? []).length;
    if (depth <= 0 && body.length > 1) break;
  }
  return body.join("\n");
}

/**
 * Extract a `func name() { ... }` body from a Swift source by brace depth. The
 * signature may span multiple lines (`private func finishRuntimeSmokeWhenWindowSettles(`),
 * so the opening brace is located after the signature rather than on the same line.
 */
function extractSwiftFunction(source: string, signature: string): string {
  const lines = source.split("\n");
  const signatureIndex = lines.findIndex((line) => line.includes(signature));
  expect(
    signatureIndex,
    `swift function ${signature} not found in the source`,
  ).toBeGreaterThanOrEqual(0);
  let start = signatureIndex;
  while (!lines[start].includes("{")) {
    start += 1;
    expect(start, `swift function ${signature} has no opening brace`).toBeLessThan(lines.length);
  }
  let depth = 0;
  const body: string[] = [];
  for (let index = start; index < lines.length; index += 1) {
    body.push(lines[index]);
    depth += (lines[index].match(/\{/g) ?? []).length - (lines[index].match(/\}/g) ?? []).length;
    if (depth <= 0 && body.length > 1) break;
  }
  return body.join("\n");
}

/** Assert a marker occurs exactly once before slicing on it. */
function sliceBetweenUnique(source: string, open: string, close: string): string {
  for (const [label, marker] of [
    ["start", open],
    ["end", close],
  ] as const) {
    const occurrences = source.split(marker).length - 1;
    expect(occurrences, `${label} marker is not unique (${occurrences}x): ${marker}`).toBe(1);
  }
  const from = source.indexOf(open);
  const to = source.indexOf(close, from + 1);
  return source.slice(from, to);
}

/**
 * Build a self-contained harness that extracts run_swift from build.sh and exercises it.
 * Two mocks are written, differing only in the interpreter and the recorded-args path:
 * `mock-swift` for the host bash, `mock-swift-container` for the docker bash:4.3 proof
 * (that image keeps bash at /usr/local/bin/bash and has no /bin/bash). The recorded
 * path is baked into the mock because run_swift launches the executable through
 * `env -i`, which strips every environment variable the harness set.
 */
function runSwiftHarness(work: string, variant: "full" | "bar"): {
  harnessPath: string;
  mockSwiftPath: string;
  recordedArgsPath: string;
  containerMockSwiftPath: string;
  containerRecordedArgsPath: string;
} {
  const runSwift = extractBashFunction(buildScript, "run_swift");
  const mockSwiftPath = join(work, "mock-swift");
  const containerMockSwiftPath = join(work, "mock-swift-container");
  const recordedArgsPath = join(work, "swift-args.txt");
  writeExecutable(
    mockSwiftPath,
    `#!/bin/bash\nprintf '%s\\n' "$@" > "${recordedArgsPath}"\n`,
  );
  writeExecutable(
    containerMockSwiftPath,
    `#!/usr/local/bin/bash\nprintf '%s\\n' "$@" > "/test/swift-args.txt"\n`,
  );
  const harnessPath = join(work, "harness.sh");
  writeFileSync(
    harnessPath,
    [
      "#!/bin/bash",
      "set -euo pipefail",
      runSwift,
      'ENV_EXECUTABLE="/usr/bin/env"',
      'SWIFT_EXECUTABLE="$MOCK_SWIFT_PATH"',
      'BUILD_HOME="$TEST_WORK/home"',
      'BUILD_WORK_DIR="$TEST_WORK"',
      'SANITIZED_PATH="/usr/bin:/bin:/usr/sbin:/sbin"',
      'PATH="/usr/bin:/bin"',
      'TMPDIR="$TEST_WORK/tmp"',
      'VARIANT_SWIFT_FLAGS=()',
      `if [ "$TEST_VARIANT" = "bar" ]; then`,
      '  VARIANT_SWIFT_FLAGS=(-Xswiftc -DRECORDINGS_BAR_ONLY)',
      "fi",
      'run_swift build --product App',
      "",
    ].join("\n"),
  );
  chmodSync(harnessPath, 0o755);
  return {
    harnessPath,
    mockSwiftPath,
    recordedArgsPath,
    containerMockSwiftPath,
    containerRecordedArgsPath: join(work, "swift-args.txt"),
  };
}

function runSwiftOnHost(variant: "full" | "bar"): { exitCode: number | null; args: string[] } {
  const work = temporaryDirectory("run-swift");
  const { harnessPath, mockSwiftPath, recordedArgsPath } = runSwiftHarness(work, variant);
  const result = Bun.spawnSync(["/bin/bash", harnessPath], {
    env: {
      ...Bun.env,
      TEST_VARIANT: variant,
      TEST_WORK: work,
      MOCK_SWIFT_PATH: mockSwiftPath,
    },
  });
  const args = existsSync(recordedArgsPath)
    ? readFileSync(recordedArgsPath, "utf8").trim().split("\n").filter(Boolean)
    : [];
  return { exitCode: result.exitCode, args };
}

let dockerBash43Available: boolean | null = null;
function hasDockerBash43(): boolean {
  if (dockerBash43Available !== null) return dockerBash43Available;
  const probe = Bun.which("docker") ? Bun.spawnSync(
    ["docker", "run", "--rm", "bash:4.3", "bash", "-c", "true"],
    { timeout: 120000 },
  ) : null;
  dockerBash43Available = probe?.exitCode === 0;
  if (!dockerBash43Available) {
    console.warn(
      "macos-bar-variant: docker bash:4.3 image unavailable; the pre-4.4 empty-array proof is skipped",
    );
  }
  return dockerBash43Available;
}

describe("run_swift variant-flag guard (P1 #1: empty-array abort)", () => {
  test("run_swift expands the variant flags through the guarded empty-array idiom", () => {
    const runSwift = extractBashFunction(buildScript, "run_swift");
    // The exact guard idiom the rest of the script uses for every possibly-empty array
    // (run_bun, run_xcrun, run_release_sensitive_tool, verify_app_bundle_modes, ...).
    expect(runSwift).toContain('${VARIANT_SWIFT_FLAGS[0]+"${VARIANT_SWIFT_FLAGS[@]}"}');
    // After removing the guarded expansion, no bare array expansion may remain.
    const withoutGuard = runSwift
      .split('${VARIANT_SWIFT_FLAGS[0]+"${VARIANT_SWIFT_FLAGS[@]}"}')
      .join("");
    expect(withoutGuard).not.toContain("VARIANT_SWIFT_FLAGS[@]");
    // The terminated PR's construct is banned outright.
    expect(buildScript).not.toContain('"${variant_flags[@]}"');
  });

  test("run_swift passes no extra arguments for a full build and the bar define for a bar build", () => {
    const empty = runSwiftOnHost("full");
    expect(empty.exitCode, `full-build run_swift harness failed`).toBe(0);
    expect(empty.args).toEqual(["build", "--product", "App"]);

    const bar = runSwiftOnHost("bar");
    expect(bar.exitCode, `bar-build run_swift harness failed`).toBe(0);
    expect(bar.args).toEqual(["-Xswiftc", "-DRECORDINGS_BAR_ONLY", "build", "--product", "App"]);
  });

  test.skipIf(!hasDockerBash43())(
    "run_swift survives the pre-4.4 empty-array abort under bash 4.3 (macOS /bin/bash class)",
    () => {
      const work = temporaryDirectory("bash43");
      for (const variant of ["full", "bar"] as const) {
        const { harnessPath, recordedArgsPath } = runSwiftHarness(work, variant);
        const result = Bun.spawnSync(
          [
            "docker",
            "run",
            "--rm",
            "-e",
            `TEST_VARIANT=${variant}`,
            "-e",
            "TEST_WORK=/test",
            "-e",
            "MOCK_SWIFT_PATH=/test/mock-swift-container",
            "-v",
            `${work}:/test`,
            "bash:4.3",
            "bash",
            "/test/" + harnessPath.split("/").pop(),
          ],
          { timeout: 120000 },
        );
        expect(
          result.exitCode,
          `bash 4.3 run_swift harness (${variant}) aborted: ${result.stderr}`,
        ).toBe(0);
        const args = existsSync(recordedArgsPath)
          ? readFileSync(recordedArgsPath, "utf8").trim().split("\n").filter(Boolean)
          : [];
        if (variant === "full") {
          expect(args).toEqual(["build", "--product", "App"]);
        } else {
          expect(args).toEqual([
            "-Xswiftc",
            "-DRECORDINGS_BAR_ONLY",
            "build",
            "--product",
            "App",
          ]);
        }
      }
    },
  );
});

describe("variant wiring and release rejection (P1 #3)", () => {
  test("build.sh consumes RECORDINGS_VARIANT and rejects unknown values", () => {
    expect(buildScript).toMatch(/VARIANT="\$\{RECORDINGS_VARIANT:-full\}"/);
    expect(buildScript).toContain("RECORDINGS_VARIANT must be full or bar");
    // Variant validation runs before the heavy executable requirements so the gate is
    // reachable with a minimal fixture (and so a bad variant fails fast on a real Mac).
    expectOrderIn(buildScript, 'readonly RELEASE_SUBTYPE', "must be full or bar");
  });

  test.skipIf(isDarwin)("release-mode bar builds fail without an explicit mark and pass the gate with it", () => {
    const buildSh = join(import.meta.dir, "..", "..", "src", "native", "Recordings", "build.sh");
    const rejection = "release-mode bar-variant builds require RECORDINGS_RELEASE_BAR_VARIANT_MARKED=1";
    expect(buildScript).toContain(rejection);

    const unmarked = Bun.spawnSync(["/bin/bash", buildSh, "release", "initial-bootstrap"], {
      env: { ...Bun.env, RECORDINGS_VARIANT: "bar" },
    });
    expect(unmarked.exitCode).not.toBe(0);
    expect(unmarked.stderr.toString()).toContain(rejection);

    const marked = Bun.spawnSync(["/bin/bash", buildSh, "release", "initial-bootstrap"], {
      env: { ...Bun.env, RECORDINGS_VARIANT: "bar", RECORDINGS_RELEASE_BAR_VARIANT_MARKED: "1" },
    });
    expect(marked.exitCode).not.toBe(0);
    expect(marked.stderr.toString()).not.toContain(rejection);
    // With the gate passed the build proceeds to the ordinary executable requirements
    // (swift does not exist on this Linux box) instead of being rejected for its variant.
    expect(marked.stderr.toString()).toContain("SWIFT_EXECUTABLE");
  });

  test("bar builds name artifacts per the bundle rule and forward the variant to smoke and finalize", () => {
    // Artifact basenames follow the bundle naming rule (Hasna Recordings-<v>-... for bar);
    // the variant lives in the manifest, never as a -bar filename suffix.
    expect(buildScript).toContain('ARTIFACT_BASENAME="${APP_BASENAME}-${VERSION}-macos-${APPROVED_TARGET}-local-only"');
    expect(buildScript).toContain('ARTIFACT_BASENAME="${APP_BASENAME}-${VERSION}-macos-${RELEASE_SUBTYPE}"');
    expect(buildScript).not.toContain('ARTIFACT_BASENAME="${ARTIFACT_BASENAME}-bar"');
    // The variant reaches the runtime smoke and the artifact finalization.
    expect(buildScript).toContain('"$SMOKE_SCRIPT" "$APP_DIR" "$BUN_EXECUTABLE" --variant "$VARIANT"');
    expect(buildScript).toContain('finalize-local');
    expect(buildScript).toContain('--variant "$VARIANT"');
  });

  test("bar builds inject LSUIElement so the app launches as an accessory with no Dock icon", () => {
    const between = sliceBetweenUnique(
      buildScript,
      '"$CP_EXECUTABLE" "$SOURCE_NATIVE_DIR/RecordingsLib/Info.plist" "$CONTENTS/Info.plist"',
      'VERSION="$("$PLIST_BUDDY"',
    );
    expect(between).toContain("LSUIElement");
    expect(between).toContain('if [ "$VARIANT" = "bar" ]; then');
  });

  test("macos_artifact.ts manifests carry the variant and verify commands accept it", () => {
    expect(artifactTool).toContain("variant?: ArtifactVariant");
    expect(artifactTool).toContain('"variant",');
    expect(artifactTool).toContain('optionalArgument("--variant")');
    expect(artifactTool).toContain('variantArgument("full")');
  });

  test("manifest-get reports the variant", () => {
    expect(artifactTool).toContain('field === "variant"');
  });

  test("installer passes --variant to every manifest verification and to the runtime smoke", () => {
    const verifyCalls = installScript.match(
      /"\$BUN_EXECUTABLE" "\$ARTIFACT_TOOL" (verify-(archive|app|active)|extract-verified-archive)/g,
    );
    expect(verifyCalls).not.toBeNull();
    expect(verifyCalls!.length).toBeGreaterThanOrEqual(7);
    // Every verification invocation carries --variant; the smoke invocation's
    // --variant has no trailing backslash, so it is not counted here.
    const variantForwarding =
      installScript.match(/--variant "\$INSTALL_VARIANT" \\\n/g) ?? [];
    expect(variantForwarding.length).toBe(verifyCalls!.length);
    expect(installScript).toContain(
      '"$RUNTIME_SMOKE" "$APP_DEST" "$BUN_EXECUTABLE" --variant "$INSTALL_VARIANT"',
    );
    // A bar install relaunches with an explicit --bar-only so the launch record is
    // self-describing even though bar builds are bar-only by construction.
    expect(installScript).toContain('--args --bar-only');
  });

  test("CLI app install forwards --variant to the installer", () => {
    const cliSource = readFileSync("src/cli/index.ts", "utf8");
    expect(cliSource).toContain('"--variant",');
    expect(cliSource).toContain("--variant");
  });
});

describe("windowless launch and runtime smoke (P1 #2)", () => {
  test("the launch plan distinguishes the bar variant from the runtime-smoke mode", () => {
    // Bar-only is argument-driven OR compile-time defaulted under RECORDINGS_BAR_ONLY.
    expect(launchPlanScript).toContain('arguments.contains("--bar-only")');
    expect(launchPlanScript).toContain("#if RECORDINGS_BAR_ONLY");
    // declaresMainWindow keeps the runtime-smoke exclusion (deterministic smoke control)
    // AND gains the bar exclusion (no auto-open window on a bar launch).
    expect(launchPlanScript).toMatch(
      /var declaresMainWindow: Bool \{ !isHelper && !isRuntimeSmoke && !isBarOnly \}/,
    );
    // The window-declaring condition for openRecordings() is bar-only, NOT smoke-excluding:
    // a full build's runtime smoke still creates the workspace window.
    expect(launchPlanScript).toMatch(/var declaresWindow: Bool \{ !isHelper && !isBarOnly \}/);
  });

  test("openRecordings is guarded on the window-declaring condition, not declaresMainWindow", () => {
    const openRecordings = extractSwiftFunction(appScript, "func openRecordings()");
    expect(openRecordings).toMatch(/guard declaresWindow else \{ return \}/);
    // The guard STATEMENT itself must never key on declaresMainWindow (that property
    // excludes every runtime smoke and made the full smoke fail deterministically).
    const guardStatement = openRecordings
      .split("\n")
      .find((line) => line.trim().startsWith("guard "));
    expect(guardStatement).toBeDefined();
    expect(guardStatement!).toContain("declaresWindow");
    expect(guardStatement!).not.toContain("declaresMainWindow");
  });

  test("the runtime smoke finishes windowless explicitly on a bar launch", () => {
    // The bar smoke reports the windowless state directly from the completion handler.
    // A nil-window comparison there would read as a retained window (nil === nil), so the
    // windowless result must be finished explicitly with retainedWindowReused: false.
    const handler = extractSwiftFunction(appScript, "runtimeSmokeProbe.completed");
    expect(handler).toContain("if self.barOnly");
    expect(handler).toContain("retainedWindowReused: false");
    // The windowless branch keys on barOnly, NEVER on declaresMainWindow — that property
    // excludes every runtime smoke and made the FULL build's smoke fail deterministically
    // (the terminated lineage's cycle-2 P1). The harmful construct was a condition (or
    // guard) keyed on it, not a comment naming the lesson.
    expect(handler).not.toContain("guard declaresMainWindow");
    expect(handler).not.toMatch(/if !?self\.declaresMainWindow/);
    // The settle wait is reached only for non-bar launches, so the full-build window
    // assertions are untouched.
    const settle = extractSwiftFunction(appScript, "private func finishRuntimeSmokeWhenWindowSettles");
    expect(settle).toContain("mainWindow?.isKeyWindow ?? false");
    expect(settle).not.toContain("barOnly");
  });

  test("the smoke script asserts windowlessness only for the bar variant", () => {
    expect(smokeScript).toContain("--variant");
    expect(smokeScript).toContain("--bar-only");
    expect(smokeScript).toContain("windowCreationCount !== 0");
    expect(smokeScript).toContain("retainedWindowReused !== false");
    // The full-build normal-mode assertions are untouched.
    expect(smokeScript).toContain("retained-window activation path was not exercised twice");
  });

  test("the Swift regression suite covers the launch-plan control flow", () => {
    const barTests = readFileSync(
      "src/native/Recordings/RecordingsTests/BarOnlyLaunchPlanTests.swift",
      "utf8",
    );
    for (const testName of [
      "bareLaunchFollowsBuildVariant",
      "explicitBarArgument",
      "fullBuildRuntimeSmokePlan",
      "barPlanKeepsMenuBarAndGlobalHandlers",
      "declaresMainWindowExcludesRuntimeSmoke",
    ]) {
      expect(barTests, `missing Swift regression ${testName}`).toContain(`func ${testName}()`);
    }
  });
});

describe("Developer ID signing support", () => {
  test("build.sh consumes both the legacy and the canonical signing identity environment", () => {
    expect(buildScript).toContain('CODESIGN_IDENTITY="${RECORDINGS_CODESIGN_IDENTITY:-${HASNA_CODESIGN_IDENTITY:-}}"');
  });

  test("build.sh discovers a Developer ID Application identity from the keychain", () => {
    expect(buildScript).toContain("find-identity -v -p codesigning");
    expect(buildScript).toContain("Developer ID Application:");
  });

  test("signing fails loudly when a Developer ID is requested but none can be found", () => {
    expect(buildScript).toContain("RECORDINGS_SIGNING_REQUIRED");
    expect(buildScript).toContain("no Developer ID Application identity found");
    expect(buildScript).toContain("never silently ad-hoc");
  });

  test("local builds default to the discovered Developer ID identity when one exists", () => {
    // The default route (no env identity, no RECORDINGS_SIGNING_REQUIRED) is the
    // keychain: discover and use the Developer ID Application identity, so an ad-hoc
    // signature (which has no stable identity for TCC to key on) is never chosen
    // silently while a Developer ID exists in the keychain.
    const localMode = sliceBetweenUnique(
      buildScript,
      'elif [ "$MODE" = "local" ]; then',
      'APPROVED_TARGET="$LOCAL_APPROVED_TARGET"',
    );
    expect(localMode).toContain('discovered_identity="$(discover_developer_id_identity)"');
    expect(localMode).toContain("falls back to ad-hoc signing");
  });

  test("the discovery function picks the Developer ID Application identity deterministically", () => {
    const discover = extractBashFunction(buildScript, "discover_developer_id_identity");
    expect(discover).toContain("find-identity");
    // Dynamic proof with a mock `security` executable.
    const work = temporaryDirectory("signing-discovery");
    const mockSecurity = join(work, "security");
    writeExecutable(
      mockSecurity,
      [
        "#!/bin/bash",
        "cat <<'EOF'",
        "  1) 1234567890 \"Apple Development: Hasna (ABCDEF1234)\"",
        "  2) 0987654321 \"Developer ID Application: Hasna, Inc. (HKZ326A8Y3)\"",
        "  3) 1122334455 \"Developer ID Installer: Hasna, Inc. (HKZ326A8Y3)\"",
        "  4) 5566778899 \"Mac Developer: Hasna (ABCDEF1234)\"",
        "EOF",
        "",
      ].join("\n"),
    );
    const mockIdentity = join(work, "identity");
    writeExecutable(
      mockIdentity,
      [
        "#!/bin/bash",
        "set -euo pipefail",
        "set -- $(discover_developer_id_identity)",
        "printf '%s\\n' \"$*\"",
        "",
      ].join("\n"),
    );
    const harness = [
      "#!/bin/bash",
      "set -euo pipefail",
      extractBashFunction(buildScript, "discover_developer_id_identity"),
      'SECURITY_EXECUTABLE="' + mockSecurity + '"',
      'AWK_EXECUTABLE="/usr/bin/awk"',
      'printf "%s\\n" "$(discover_developer_id_identity)"',
      "",
    ].join("\n");
    const harnessPath = join(work, "discover.sh");
    writeExecutable(harnessPath, harness);
    const result = Bun.spawnSync(["/bin/bash", harnessPath]);
    expect(result.exitCode, result.stderr.toString()).toBe(0);
    expect(result.stdout.toString().trim()).toBe(
      "Developer ID Application: Hasna, Inc. (HKZ326A8Y3)",
    );
  });
});

describe("artifact naming per the fleet rule", () => {
  test("the bar artifact is Hasna Recordings.app with the display name 'Hasna Recordings'", () => {
    // Fleet naming rule (knowledge k_msxd5rz3_jfvl3i): Hasna<Name>.app with 'Hasna' at the
    // beginning. Both variants (full and bar) build as Hasna Recordings.app; the rename of
    // the full app was the rule's recorded follow-up decision and is now executed.
    expect(buildScript).toContain('APP_BUNDLE_NAME="Hasna Recordings.app"');
    expect(buildScript).not.toContain('APP_BUNDLE_NAME="Recordings.app"');
    expect(buildScript).toContain("Set :CFBundleDisplayName Hasna Recordings");
    // The bundle identifier TCC keys on stays com.hasna.recordings.
    expect(infoPlist).toContain("<string>com.hasna.recordings</string>");
    // The bar is a variant of Hasna Recordings.app, never a separately named app.
    for (const source of [buildScript, smokeScript, installScript, artifactTool]) {
      expect(source).not.toContain("Hasna RecordingsBar");
      expect(source).not.toContain("RecordingsBar.app");
    }
  });

  test("the manifest carries the bundle name and the installer adopts it at install time", () => {
    expect(artifactTool).toContain("bundle_name: string;");
    expect(artifactTool).toContain('field === "bundle_name"');
    // Pre-variant manifests are full builds by definition; the canonical name is
    // Hasna Recordings.app for both variants.
    expect(artifactTool).toContain('manifest.bundle_name ?? "HasnaRecordings.app"');
    // The installer reads the authenticated manifest's bundle name and derives the
    // install target from it, so a Hasna Recordings.app artifact lands under its own
    // name regardless of variant.
    expect(installScript).toContain('AUTHENTICATED_BUNDLE_NAME="$("$BUN_EXECUTABLE" "$ARTIFACT_TOOL" manifest-get');
    expect(installScript).toContain('STAGED_APP="${STAGING_DIR}/${MANIFEST_BUNDLE_NAME}"');
    expect(installScript).toContain('CANDIDATE_APP="$UNPACK_DIR/${MANIFEST_BUNDLE_NAME}"');
    // Archive extraction verifies the top-level bundle directory name from the manifest.
    expect(artifactTool).toContain("expectedBundleName");
  });
});

/** Local ordering helper so expectations read naturally. */
function expectOrderIn(source: string, first: string, second: string): void {
  const firstIndex = source.indexOf(first);
  const secondIndex = source.indexOf(second);
  expect(firstIndex, `ordering operand is missing entirely: ${first}`).toBeGreaterThan(-1);
  expect(secondIndex, `ordering operand is missing entirely: ${second}`).toBeGreaterThan(-1);
  expect(firstIndex).toBeLessThan(secondIndex);
}
