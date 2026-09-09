import { chmodSync, cpSync, existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { replaceFixtureText } from "./signing-fixture";

type BuildFixture = {
  root: string; native: string; bin: string; markers: string; releaseBuildRoot: string;
  compatibleCohortManifest: string;
};
const quote = (value: string) => `'${value.replaceAll("'", "'\\''")}'`;
function executable(path: string, source: string) {
  mkdirSync(dirname(path), { recursive: true }); writeFileSync(path, source); chmodSync(path, 0o755);
}

/** Model the isolated builder at subprocess/file boundaries, retaining Darwin control flow. */
export function prepareSignedBuildFixture<T extends BuildFixture>(fixture: T, repository: string): T {
  if (process.platform !== "darwin") return fixture;
  const { root, bin, native, markers, releaseBuildRoot } = fixture;
  const settings = join(root, "fixture-settings.sh");
  writeFileSync(settings, "");
  const prefix = `#!/bin/bash\nset -euo pipefail\nsource ${quote(settings)}\n`;
  writeFileSync(join(bin, "build-supervisor.ts"), `
const child = Bun.spawn(["/bin/bash", ...process.argv.slice(2)], { detached: true, stdout: "pipe", stderr: "pipe" });
let expired = false;
const stop = () => { try { process.kill(-child.pid, "SIGKILL"); } catch {} };
const timer = setTimeout(() => { expired = true; stop(); }, 25000);
try {
  const [status, out, error] = await Promise.all([child.exited, new Response(child.stdout).text(), new Response(child.stderr).text()]);
  process.stdout.write(out); process.stderr.write(error);
  if (expired) process.stderr.write("signing fixture deadline exceeded\\n");
  process.exitCode = expired ? 124 : status;
} finally { clearTimeout(timer); stop(); }
`);
  const attestation = join(root, "build-trust", "isolated-builder-v1");
  const cohorts = join(root, "build-trust", "compatible-cohorts");
  mkdirSync(cohorts, { recursive: true });
  writeFileSync(attestation, "recordings-isolated-builder-v1\n", { mode: 0o444 });
  const cohortBytes = readFileSync(fixture.compatibleCohortManifest);
  fixture.compatibleCohortManifest = join(cohorts, `${Bun.CryptoHasher.hash("sha256", cohortBytes, "hex")}.json`);
  writeFileSync(fixture.compatibleCohortManifest, cohortBytes, { mode: 0o444 });

  const ancestors: string[] = [];
  for (let path = root; path !== "/"; path = dirname(path)) ancestors.push(path);
  const ancestorPatterns = ancestors.map(quote).join("|");

  const buildPath = join(native, "build.sh");
  let build = readFileSync(buildPath, "utf8");
  const tools: Record<string, string> = {
    "/usr/bin/swift": "swift", "/usr/bin/codesign": "codesign", "/usr/bin/security": "security",
    "/usr/bin/xcrun": "xcrun", "/usr/sbin/spctl": "spctl", "/usr/bin/syspolicy_check": "syspolicy_check",
    "/usr/bin/ditto": "ditto", "/usr/libexec/PlistBuddy": "plistbuddy", "/usr/bin/plutil": "plutil",
    "/usr/bin/lipo": "lipo", "/usr/bin/id": "id", "/usr/bin/stat": "stat",
  };
  for (const [system, name] of Object.entries(tools)) build = replaceFixtureText(build, system, join(bin, name));
  build = replaceFixtureText(build, "/private/var/recordings-build", releaseBuildRoot);
  build = replaceFixtureText(build, "/Library/Application Support/Hasna/Recordings/BuildTrust/isolated-builder-v1", attestation);
  build = replaceFixtureText(build, "/Library/Application Support/Hasna/Recordings/BuildTrust/compatible-cohorts", cohorts);
  // This replacement is only the run_bun process boundary. require_bun_executable
  // still authenticates the real runtime; production source is never changed.
  const runBunStart = build.indexOf("run_bun() {");
  const runBunEnd = build.indexOf("\nrun_xcrun() {", runBunStart);
  if (runBunStart < 0 || runBunEnd < 0) throw new Error("run_bun fixture boundary is missing");
  build = build.slice(0, runBunStart) + replaceFixtureText(build.slice(runBunStart, runBunEnd),
    '"$BUN_EXECUTABLE" "$@"', `${quote(join(bin, "fixture-bun"))} "$@"`) + build.slice(runBunEnd);
  writeFileSync(buildPath, build);

  // Only modeled ownership observations change. Modes/link checks and all real
  // canonical-path checks remain active against private fixture objects.
  executable(join(bin, "id"), `${prefix}case "$*" in -un) printf '_recordingsbuild\\n';; -u) /usr/bin/id -u;; *) exit 64;; esac\n`);
  executable(join(bin, "stat"), `${prefix}
path="\${@: -1}"
if [ "$1" = -f ] && [ "$2" = %u ]; then
  case "$path" in ${quote(attestation)}|${ancestorPatterns}|${quote(root + "/build-trust")}|${quote(cohorts)}|${quote(cohorts)}/*) printf '0\\n'; exit 0;; esac
fi
if [ "$1" = -f ] && [ "$2" = %Lp ] && { [ "$path" = /private/tmp ] || [ "$path" = ${quote(root)} ]; }; then printf '755\\n'; exit 0; fi
exec /usr/bin/stat "$@"
`);
  executable(join(bin, "security"), `${prefix}printf '%s\\n' "$*" >> ${quote(join(markers, "security.log"))}\n[ "$*" = 'find-identity -v -p codesigning' ] || exit 64\n`);
  executable(join(bin, "lipo"), `${prefix}
if [ "$1" = -create ]; then
  [ "$4" = -output ] || exit 64
  cp "$2" "$5"
elif [ "$1" = -archs ]; then
  case "$2" in */swift/arm64/*) printf 'arm64\\n';; */swift/x86_64/*) printf 'x86_64\\n';; *) printf 'arm64 x86_64\\n';; esac
elif [ "\${2:-}" = -verify_arch ]; then [ "$3 $4" = 'arm64 x86_64' ] || exit 64
else exit 64; fi
`);
  const swiftPath = join(bin, "swift");
  let swift = readFileSync(swiftPath, "utf8");
  const begin = swift.indexOf('output_directory=".build/$configuration"');
  const end = swift.indexOf('\nmkdir -p "$output_directory"', begin);
  if (begin < 0 || end < 0) throw new Error("Swift fixture output boundary is missing");
  swift = swift.slice(0, begin) + `output_directory=""\nshow=0\nfor ((i=1;i<=$#;i++)); do\n  if [ "\${!i}" = --scratch-path ]; then j=$((i+1)); output_directory="\${!j}/$configuration"; fi\n  [ "\${!i}" != --show-bin-path ] || show=1\ndone\n[ -n "$output_directory" ] || exit 64\n` + swift.slice(end);
  swift = replaceFixtureText(swift, '[ "${1:-}" = build ] || exit 0', '[ "${1:-}" != test ] || exit 0\n[ "${1:-}" = build ] || exit 64');
  swift += '\n[ "$show" = 0 ] || printf \'%s\\n\' "$output_directory"\n';
  writeFileSync(swiftPath, swift.replaceAll("$MARKER_DIRECTORY/envelope-signer.log", join(markers, "envelope-signer.log")));

  const addon = join(repository, "scripts/native/prebuilds/darwin-universal/recordings_fs_guard.node");
  executable(join(root, "scripts/build_native_fs_guard.sh"), `${prefix}mkdir -p "$(dirname "$1")"\ncp ${quote(addon)} "$1"\n`);
  executable(join(bin, "fixture-bun"), `${prefix}
case "\${1:-}" in
  install) exit 0;;
  build)
    output=""
    while [ "$#" -gt 0 ]; do if [ "$1" = --outfile ]; then output="$2"; shift; fi; shift; done
    [ -n "$output" ] || exit 64
    printf '#!/bin/bash\\nexit 0\\n' > "$output"; chmod 755 "$output"; exit 0;;
esac
exec ${quote(process.execPath)} "$@"
`);
  for (const input of ["Package.swift", "RecordingsLib/RecordingEngine.swift"]) {
    const path = join(native, input); if (!existsSync(path)) writeFileSync(path, "// fictional committed fixture\n");
  }
  for (const input of ["scripts/native_fs_guard.ts", "scripts/native/recordings_fs_guard.c", "packaging/macos/Verifier.entitlements",
    "packaging/macos/Empty.entitlements", "packaging/macos/artifact-verifier.sb",
    "packaging/macos/Library/LaunchDaemons/com.hasna.recordings.updater.plist", "packaging/macos/scripts/preinstall", "packaging/macos/scripts/postinstall"]) {
    const path = join(root, input); mkdirSync(dirname(path), { recursive: true }); cpSync(join(repository, input), path);
  }
  writeFileSync(join(root, "package.json"), JSON.stringify({ name: "recordings-signing-fixture", version: "0.2.12", files: ["scripts/native/prebuilds/**"] }));
  writeFileSync(join(root, "bun.lock"), JSON.stringify({lockfileVersion:1,workspaces:{"":{name:"recordings-signing-fixture"}},packages:{}})); writeFileSync(join(root, "bunfig.toml"), "");

  const artifact = join(root, "scripts/macos_artifact.ts");
  let source = readFileSync(artifact, "utf8");
  source = replaceFixtureText(source, 'if (args[0] === "provenance") process.exit(0);', `if (args[0] === "provenance") {
  writeFileSync(join(argument("--app"), "Contents/Resources/recordings-build-provenance.json"), JSON.stringify({git_sha: argument("--source-sha")})); process.exit(0);
}
if (args[0] === "tree-digest") {
  const rows: string[] = [];
  const walk = (path: string, relative = "") => { for (const name of readdirSync(path).sort()) {
    const child = join(path, name), key = relative + "/" + name, info = lstatSync(child);
    rows.push(key + ":" + (info.mode & 0o777) + ":" + (info.isFile() ? Bun.CryptoHasher.hash("sha256", readFileSync(child), "hex") : "dir"));
    if (info.isDirectory()) walk(child, key);
  }};
  walk(argument("--path")); console.log(Bun.CryptoHasher.hash("sha256", rows.join("\\n"), "hex")); process.exit(0);
}`);
  source = replaceFixtureText(source, 'git_sha: "0".repeat(40),', 'git_sha: argument("--source-sha"),\n      notarization: { log_sha256: Bun.CryptoHasher.hash("sha256", readFileSync(argument("--notary-log")), "hex"), submitted_archive_sha256: argument("--submitted-archive-sha256") },');
  writeFileSync(artifact, source);
  // These scripts are subprocess doubles; restore only explicit fixture values
  // after production env -i. No credential-bearing ambient environment is read.
  const shellInputs = ["codesign", "xcrun", "swift", "spctl", "syspolicy_check", "ditto", "plistbuddy", "plutil"];
  for (const name of shellInputs) {
    const path = join(bin, name), contents = readFileSync(path, "utf8");
    writeFileSync(path, prefix + contents.slice(contents.indexOf("\n") + 1));
  }
  for (const input of ["scripts/build_companion_cli.sh", "scripts/smoke_macos_app.sh", "packaging/macos/build_release_pkg.sh"]) {
    const path = join(root, input), contents = readFileSync(path, "utf8");
    writeFileSync(path, prefix + contents.slice(contents.indexOf("\n") + 1));
  }
  const codesign = join(bin, "codesign");
  writeFileSync(codesign, readFileSync(codesign, "utf8").replace(prefix, prefix + `
+case "\${@: -1}" in ${quote(root)}/*) ;; *) exit 64;; esac
+case "$*" in '--force --sign '*|'--verify '*|'-d --verbose=4 '*|'-d --entitlements :- '*|'-d -r- '*) ;; *) exit 64;; esac
+`.replace(/^\+/gm, "")));
  const xcrun = join(bin, "xcrun");
  writeFileSync(xcrun, readFileSync(xcrun, "utf8").replace(prefix, prefix + `
+case "$*" in 'notarytool submit '*|'notarytool log '*|'stapler staple '*|'stapler validate '*) ;; *) exit 64;; esac
+`.replace(/^\+/gm, "")));
  const ditto = join(bin, "ditto");
  writeFileSync(ditto, replaceFixtureText(readFileSync(ditto, "utf8"), 'cp -R', 'cp -pR'));
  const pkg = join(root, "packaging/macos/build_release_pkg.sh");
  let pkgSource = replaceFixtureText(readFileSync(pkg, "utf8"), 'installer_identity=""', 'output_dir=""\ninstaller_identity=""');
  pkgSource = replaceFixtureText(pkgSource, '    --installer-identity)', '    --output-dir) output_dir="$2"; shift 2 ;;\n    --installer-identity)');
  pkgSource += `
+[ -d "$output_dir" ] || exit 64
+base="$output_dir/$artifact_basename-updater"
+mkdir "$base.release"
+for suffix in pkg notary-submit.json notary-log.json bootstrap-envelope.json compatible-cohort.json compatible-cohort.json.sha256; do
+  printf 'fictional package artifact\\n' > "$base.$suffix"; chmod 444 "$base.$suffix"
+done
+/usr/bin/shasum -a 256 "$base.pkg" > "$base.pkg.sha256"; chmod 444 "$base.pkg.sha256"
+${quote(process.execPath)} -e 'require("fs").writeFileSync(process.argv[1]+"/fixture-publication.json",JSON.stringify({destination:process.argv[1],publicationIdentitySha256:process.argv[2],aliases:[]}))' "$base.release" "$publication_identity_sha256"
+`.replace(/^\+/gm, "");
  writeFileSync(pkg, pkgSource);
  const plutil = join(bin, "plutil");
  writeFileSync(plutil, readFileSync(plutil, "utf8").replace('input="${@: -1}"', `if [ "$1" = -extract ]; then
  exec ${quote(process.execPath)} -e 'const f=JSON.parse(require("fs").readFileSync(process.argv[2],"utf8")); console.log(process.argv[1].split(".").reduce((v,k)=>v[k],f));' "$2" "\${@: -1}"
fi
input="\${@: -1}"`));
  writeFileSync(join(root, ".gitignore"), "markers/\nrelease-build-root/\nbuild-trust/\nfixture-settings.sh\nsource-probe\n");
  const git = (args: string[], input?: string) => {
    const result = Bun.spawnSync(["/usr/bin/git", "-c", "core.hooksPath=/dev/null", "-C", root, ...args],
      { stdout: "pipe", stderr: "pipe", ...(input === undefined ? {} : { stdin: Buffer.from(input) }) });
    if (result.exitCode !== 0) throw new Error(`Could not create owned signing source: ${result.stderr.toString()}`);
    return result.stdout.toString().trim();
  };
  git(["init", "-q"]); git(["add", "."]);
  // Fixture object only: retain the checked-out source commit's identity metadata.
  // No user.name/user.email, Git identity environment, or signing setting is overridden.
  const original = Bun.spawnSync(["/usr/bin/git", "-C", repository, "cat-file", "commit", "HEAD"]);
  if (original.exitCode !== 0) throw new Error("Fixture source metadata is unavailable");
  const metadata = original.stdout.toString().split("\n").filter(line => /^(author|committer) /.test(line));
  if (metadata.length !== 2) throw new Error("Fixture source identity metadata is invalid");
  const tree = git(["write-tree"]);
  const revision = git(["hash-object", "-t", "commit", "-w", "--stdin"],
    `tree ${tree}\n${metadata.join("\n")}\n\ntest fixture source\n\nAgent: fixer\n`);
  git(["update-ref", "HEAD", revision]);
  return fixture;
}

export function configureSignedBuildFixture(fixture: BuildFixture, environment: Record<string, string>) {
  if (process.platform !== "darwin") return;
  const fixed: Record<string, string> = {
    MARKER_DIRECTORY: fixture.markers,
    EXPECTED_HELPER_ENTITLEMENTS: join(fixture.native, "RecordingsLib/RecordingsCLI.entitlements"),
  };
  const allowed = ["EXTRA_HELPER_ENTITLEMENT", "SIGNING_AUTHORITY", "SIGNING_TEAM", "SIGNING_FLAGS", "MISSING_TIMESTAMP",
    "BREAK_SIGNED_HELPER", "MALFORMED_SIGNED_HELPER_OUTPUT", "NOTARY_SUBMIT_REJECTED", "NOTARY_LOG_ISSUES", "REVERSE_ENTITLEMENT_ORDER"];
  for (const key of allowed) if (environment[key] !== undefined) fixed[key] = environment[key]!;
  writeFileSync(join(fixture.root, "fixture-settings.sh"), Object.entries(fixed).map(([key,value]) => `export ${key}=${quote(value)}`).join("\n") + "\n");
}
