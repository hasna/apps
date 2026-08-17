import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import {
  type MacOSArtifactManifest,
  assertManifestVariant,
} from "../../scripts/macos_artifact";

// Resolved from this module, not the working directory, so the suite passes from
// any cwd (bun test is routinely invoked from a subdirectory).
const repositoryRoot = new URL("../../", import.meta.url).pathname;
const readRepositoryFile = (relativePath: string): string =>
  readFileSync(join(repositoryRoot, relativePath), "utf8");

const nativeRoot = "src/native/Recordings";

describe("macOS bar-only variant source wiring", () => {
  test("launch plan parses --bar-only and gates the main window on it", () => {
    const source = readRepositoryFile(
      join(nativeRoot, "RecordingsLib", "PermissionRequestLaunchPlan.swift"),
    );
    expect(source).toContain('arguments.contains("--bar-only")');
    expect(source).toContain("declaresMainWindow: Bool { !isHelper && !isRuntimeSmoke && !isBarOnly }");
  });

  test("launch plan defaults bar-only at compile time when the bar define is set", () => {
    // Regression for the review finding that no real launch passed --bar-only: the bar
    // build must be bar-only by construction, so the workspace window can never appear
    // through the installer relaunch, a manual `open`, or a LaunchAgent.
    const source = readRepositoryFile(
      join(nativeRoot, "RecordingsLib", "PermissionRequestLaunchPlan.swift"),
    );
    expect(source).toContain("#if RECORDINGS_BAR_ONLY");
    expect(source).toContain("isBarOnly = true");
    expect(source).toContain("#else");
    expect(source).toContain("#endif");
    // The comment must record why the compile-time default exists.
    expect(source).toContain("Bar builds are bar-only by construction");
  });

  test("bar launch plan tests cover the compile-time default in both build configurations", () => {
    const tests = readRepositoryFile(
      join(nativeRoot, "RecordingsTests", "BarOnlyLaunchPlanTests.swift"),
    );
    expect(tests).toContain("#if RECORDINGS_BAR_ONLY");
    expect(tests).toContain("#expect(plan.isBarOnly)");
    expect(tests).toContain("#expect(!plan.declaresMainWindow)");
    expect(tests).toContain("bareLaunchFollowsBuildVariant");
  });

  test("app state gates window creation and the smoke window path on barOnly, not declaresMainWindow", () => {
    // Regression for the review finding that the smoke branch keyed on declaresMainWindow,
    // which excludes runtime-smoke mode, so the FULL-build normal smoke finished windowless
    // (windowCreationCount===0) and its retained-window assertions always failed. Window
    // creation keys on barOnly: the full-build smoke keeps exercising the workspace window,
    // and only the bar variant finishes the smoke window-less.
    const source = readRepositoryFile(
      join(nativeRoot, "App", "RecordingsApp.swift"),
    );
    expect(source).toContain("guard !barOnly else { return }");
    expect(source).not.toContain("guard declaresMainWindow else { return }");
    expect(source).toContain("if self.barOnly {");
    expect(source).not.toContain("if !self.declaresMainWindow");
    // The init auto-open and the reopen handler stay keyed on declaresMainWindow (which
    // excludes helper and runtime-smoke launches) so the smoke controls window creation
    // deterministically.
    expect(source).toContain("guard let state, state.declaresMainWindow else { return false }");
    expect(source).toContain("if plan.declaresMainWindow");
    expect(source).toContain("barOnly: state.barOnly");
  });

  test("menu bar view hides the Open Recordings button in bar mode", () => {
    const source = readRepositoryFile(
      join(nativeRoot, "App", "MenuBarStatusView.swift"),
    );
    expect(source).toContain("var barOnly: Bool = false");
    expect(source).toContain("if !barOnly");
  });

  test("bar-only launch plan tests exist", () => {
    const tests = readRepositoryFile(
      join(nativeRoot, "RecordingsTests", "BarOnlyLaunchPlanTests.swift"),
    );
    expect(tests).toContain("--bar-only");
    expect(tests).toContain("!plan.declaresMainWindow");
    expect(tests).toContain("plan.declaresMenuBar");
  });

  test("build.sh passes the variant flag, LSUIElement, and bar artifact naming", () => {
    const source = readRepositoryFile(
      join(nativeRoot, "build.sh"),
    );
    expect(source).toContain('RECORDINGS_VARIANT="${RECORDINGS_VARIANT:-}"');
    expect(source).toContain('"RECORDINGS_VARIANT must be empty or bar"');
    expect(source).toContain("-Xswiftc -DRECORDINGS_BAR_ONLY");
    expect(source).toContain("Add :LSUIElement bool true");
    expect(source).toContain('ARTIFACT_BASENAME="RecordingsBar-${VERSION}-macos-${APPROVED_TARGET}-local-only"');
    expect(source).toContain('"$BASH_EXECUTABLE" "$SMOKE_SCRIPT" "$APP_DIR" "$BUN_EXECUTABLE"');
    expect(source).toContain('${RECORDINGS_VARIANT:+"--variant"} ${RECORDINGS_VARIANT:+"$RECORDINGS_VARIANT"}');
  });

  test("smoke script accepts --variant bar and asserts a window-less normal launch", () => {
    const source = readRepositoryFile("scripts/smoke_macos_app.sh");
    expect(source).toContain("--variant bar");
    expect(source).toContain('arguments=(--bar-only "${arguments[@]}")');
    expect(source).toContain('fail("bar variant created or activated a workspace window")');
    expect(source).toContain('fail("bar variant exposed a workspace window")');
    expect(source).toContain('if [ "$RECORDINGS_VARIANT" = "bar" ]');
  });

  test("installer accepts --variant and forwards it to the runtime smoke", () => {
    const source = readRepositoryFile("scripts/install_macos_app.sh");
    expect(source).toContain("INSTALL_VARIANT=\"${RECORDINGS_VARIANT:-}\"");
    expect(source).toContain("Install variant must be empty or bar");
    expect(source).toContain('${INSTALL_VARIANT:+"--variant"} ${INSTALL_VARIANT:+"$INSTALL_VARIANT"}');
  });

  test("installer relaunches a bar install with --bar-only", () => {
    const source = readRepositoryFile("scripts/install_macos_app.sh");
    expect(source).toContain('"$OPEN_EXECUTABLE" -n "$APP_DEST" --args --bar-only');
    expect(source).toContain('[ "$INSTALL_VARIANT" = "bar" ]');
  });

  test("CLI app install exposes --variant and forwards it to the installer", () => {
    const source = readRepositoryFile("src/cli/index.ts");
    expect(source).toContain('.option("--variant <bar>"');
    expect(source).toContain('if (opts.variant !== undefined)');
    expect(source).toContain('installerArgs.push("--variant", opts.variant)');
  });

  test("artifact tool records and verifies the manifest variant", () => {
    const source = readRepositoryFile("scripts/macos_artifact.ts");
    expect(source).toContain('variant?: "full" | "bar";');
    expect(source).toContain("assertManifestVariant(manifest, expectedVariant, expectedPolicy)");
    expect(source).toContain("variant: variant === \"bar\" ? \"bar\" : \"full\"");
    expect(source).toContain('optionalArgument("--variant") ?? ""');
  });

  test("local-only policy names the Developer ID-or-adhoc choice and station07", () => {
    const policy = readRepositoryFile("scripts/policy/local-only-approved-targets.txt");
    expect(policy).toContain("signed either ad-hoc or with a Developer ID Application");
    expect(policy).toContain("RECORDINGS_CODESIGN_IDENTITY");
    expect(policy).toContain("station03");
    expect(policy).toContain("station06");
    expect(policy).toContain("station07");
  });
});

describe("manifest variant contract", () => {
  const baseManifest = {
    schema_version: 3,
    artifact_type: "recordings-macos-app",
  } as MacOSArtifactManifest;

  test("bar manifest satisfies a bar selection and full satisfies a full selection", () => {
    const bar = { ...baseManifest, variant: "bar" } as MacOSArtifactManifest;
    const full = { ...baseManifest, variant: "full" } as MacOSArtifactManifest;
    expect(() => assertManifestVariant(bar, "bar", "local_only")).not.toThrow();
    expect(() => assertManifestVariant(full, "full", "local_only")).not.toThrow();
    // Absent variant reads as full.
    expect(() => assertManifestVariant(baseManifest, "full", "local_only")).not.toThrow();
  });

  test("mismatched variant selections are rejected", () => {
    const bar = { ...baseManifest, variant: "bar" } as MacOSArtifactManifest;
    expect(() => assertManifestVariant(bar, "full", "local_only")).toThrow(
      "does not match the operator-selected variant full",
    );
    expect(() => assertManifestVariant(baseManifest, "bar", "local_only")).toThrow(
      "does not match the operator-selected variant bar",
    );
  });

  test("bar is rejected for release artifacts and unknown variants are rejected", () => {
    const bar = { ...baseManifest, variant: "bar" } as MacOSArtifactManifest;
    expect(() => assertManifestVariant(bar, "bar", "release")).toThrow(
      "bar variant is only valid for local-only artifacts",
    );
    expect(() => assertManifestVariant(bar, "windowed", "local_only")).toThrow(
      "unsupported artifact variant windowed",
    );
  });

  test("an empty selection performs no variant check", () => {
    const bar = { ...baseManifest, variant: "bar" } as MacOSArtifactManifest;
    expect(() => assertManifestVariant(bar, "", "local_only")).not.toThrow();
  });
});
