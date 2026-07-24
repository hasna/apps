import { describe, expect, test } from "bun:test";
import {
  chmodSync,
  closeSync,
  constants,
  copyFileSync,
  existsSync,
  mkdtempSync,
  mkdirSync,
  openSync,
  readFileSync,
  renameSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { spawnSync } from "node:child_process";

const root = join(import.meta.dir, "..");

describe("Stage A external artifact provenance", () => {
  test("the evidence builder binds source, build, inventory, modes, smokes, and archive", () => {
    const source = readFileSync(join(root, "scripts/create-stage-a-evidence.ts"), "utf8");
    const policySource = readFileSync(join(root, "scripts/stage-a-verifier-policy.ts"), "utf8");
    const candidateSource = readFileSync(join(root, "scripts/stage-a-candidate-identity.ts"), "utf8");
    const evidenceSources = `${source}\n${policySource}\n${candidateSource}`;

    expect(source).toContain("31988ba7a1ca3d42f50cb2fab894a3581f8e568f");
    expect(source).toContain("canonical_source_candidate_digest");
    expect(evidenceSources).toContain('["diff", "--binary", "--full-index", "--no-ext-diff"');
    expect(evidenceSources).toContain('["ls-files", "--others", "--exclude-standard", "-z"]');
    expect(source).toContain("generated_sdk: { before: generatedSdkBefore, after: generatedSdkAfter, equal: true }");
    expect(evidenceSources).toContain('"install-free build"');
    expect(source).toContain("inventory: artifactInventory");
    expect(source).toContain("mode");
    expect(source).toContain("sha256");
    expect(source).toContain("containment_smokes");
    expect(evidenceSources).toContain("built MCP HTTP cold/warm import");
    expect(evidenceSources).toContain("built direct storage cold/warm import");
    expect(source).toContain("source_digest_after");
    expect(source).toContain("archive_sha256: artifactArchiveIdentity.sha256");
    expect(evidenceSources).toContain("STAGE_A_TRIPWIRE_IMPORTS");
    expect(source).toContain('"--tmpfs", "/home"');
    expect(source).toContain('"--unshare-net"');
    expect(source).toContain('"--unshare-pid"');
    expect(source).toContain('"--proc", "/proc"');
    expect(source).toContain("sandbox-root");
    expect(source).toContain("assertHostSandboxRuntimeBinding();");
    expect(source).toContain("canonical AppArmor-authorized path");
    expect(source).toContain('"--ro-bind-fd"');
    expect(source).toContain('childDirectoryCount !== "0"');
    expect(source).toContain('childSocketCount !== "0"');
    expect(source).toContain("ulimit -f 65536");
    expect(source).not.toContain('"--ro-bind", "/", "/"');
    expect(source).not.toContain("bun-real");
    expect(source).toContain('version: "existing-dependency-bytes-v1"');
    expect(source).toContain("source_unchanged: true");
    expect(source).toContain("lockfile_unchanged: true");
    expect(evidenceSources).not.toContain('"--frozen-lockfile"');
    expect(evidenceSources).not.toContain('"--ignore-scripts"');
    expect(source).toContain("special_member_count: 0");
    expect(source).toContain("output_comparison");
    expect(source).toContain("exact-bytes");
    expect(source).toContain("required_replay_indices");
    expect(source).toContain("canonical_digest_input");
    expect(source).toContain("copied_source_before");
    expect(source).toContain("copied_source_after");
    expect(source).toContain("recursive_regular_file_count");
    expect(source).toContain("clean_of_unapproved_high_confidence_heuristic_findings");
    expect(source).toContain("retain and report every generic assignment category");
    expect(source.indexOf("const verifierSourceNames")).toBeLessThan(source.indexOf("const finalCandidateDigest"));
    expect(source).toContain("evidenceRoot = `/proc/${process.pid}/fd/${outputDescriptor}`");
    expect(source).toContain("assertOutputBinding();");
    expect(source).not.toContain('const workspace = join(output, "workspace")');
    expect(source).toContain("--output");
    expect(source).toMatch(/outside (?:the )?repository/i);
    expect(source).not.toContain("git add");
    expect(source).not.toContain("git commit");
    expect(source).not.toContain("git push");
    const releaseVerifier = readFileSync(join(root, "scripts/verify-public-release.ts"), "utf8");
    expect(releaseVerifier).toContain("readPackedRegularFiles");
    expect(releaseVerifier).toContain("MAX_STRUCTURED_JSON_BYTES");
    expect(releaseVerifier).not.toContain('["-xOf", tarball, path]');
  });

  test("import proof is enabled for import and preload actions", () => {
    const source = readFileSync(join(root, "src/stage-a-import-boundary.test.ts"), "utf8");
    expect(source).not.toContain('action === "import" ? "0" : "1"');
    expect(source).toContain('STAGE_A_TRIPWIRE_IMPORTS: "1"');
  });

  test("the standalone verifier binds canonical replay policy and has no encoded chunk boundary", () => {
    const source = readFileSync(join(root, "scripts/verify-stage-a-evidence.ts"), "utf8");
    expect(source).toContain("SOURCE_REPLAY_POLICY");
    expect(source).toContain("assertCommandRecordMatchesPolicy");
    expect(source).toContain('"--tmpfs", "/home"');
    expect(source).toContain("interface SecretScanUnit");
    expect(source).toContain("compactAsciiProjection");
    expect(source).toContain("utf16Projection");
    expect(source).toContain("MAX_PERCENT_DECODE_PASSES = 32");
    expect(source).toContain("highConfidenceCredentialCategories");
    expect(source).toContain("borrowedRootDescriptor");
    expect(source).toContain("copyDescriptorAnchoredTree");
    expect(source).toContain("Buffer.compare(actualStdout, expectedStdout)");
    expect(source).toContain("readTar(evidencePath(manifest.dependencies.archive.path), true)");
    expect(source).toContain("resolveDependencyInventoryPath");
    expect(source).toContain('"--ro-bind-fd"');
    expect(source).not.toContain('"--ro-bind", "/", "/"');
    expect(source).not.toContain("{8,4096}");
    const structuredValidator = source.slice(
      source.indexOf("function validateStructuredIdentity"),
      source.indexOf("function parseJsonFile"),
    );
    expect(structuredValidator.indexOf("identity.size <= MAX_STRUCTURED_JSON_BYTES"))
      .toBeLessThan(structuredValidator.indexOf("validateIdentity(identity)"));
  });

  test("the standalone verifier rejects an undeclared whole-root entry before semantic replay", () => {
    const creator = readFileSync(join(root, "scripts/create-stage-a-evidence.ts"), "utf8");
    const verifier = readFileSync(join(root, "scripts/verify-stage-a-evidence.ts"), "utf8");
    expect(creator).toContain("evidence_root: {");
    expect(creator).toContain("inventory_without_manifest: evidenceRootInventoryWithoutManifest");
    expect(verifier).toContain("manifest.evidence_root.inventory_without_manifest");
    expect(verifier).toContain("actualEvidenceRootInventoryWithoutManifest");
    expect(verifier).toContain("assertNoHardlinks(evidenceRootDescriptorPath, \"evidence root\")");
    const closureCheck = verifier.indexOf("equalInventory(actualEvidenceRootInventoryWithoutManifest");
    const semanticReplay = verifier.indexOf("validateStructuredIdentity(manifest.tools.inventory)");
    expect(closureCheck).toBeGreaterThanOrEqual(0);
    expect(closureCheck).toBeLessThan(semanticReplay);
  });

  test("self-consistent manifest executable fields cannot select verifier launchers", () => {
    const source = readFileSync(join(root, "scripts/verify-stage-a-evidence.ts"), "utf8");
    const sandboxInvocation = source.slice(
      source.indexOf("function sandboxInvocation"),
      source.indexOf("function runSandbox"),
    );
    expect(sandboxInvocation).toContain("TRUSTED_VERIFIER_EXECUTION_POLICY.hostBwrap");
    expect(sandboxInvocation).toContain("/proc/self/fd/${bwrapChildFd}");
    expect(sandboxInvocation).toContain('"tools/host/bash"');
    expect(sandboxInvocation).toContain('"tools/host/bwrap"');
    expect(sandboxInvocation).not.toContain("manifest.network_isolation.sandbox_launch_shell_path");
    expect(sandboxInvocation).not.toContain("manifest.network_isolation.sandbox_execution_path");
    const runSandbox = source.slice(
      source.indexOf("async function runSandbox"),
      source.indexOf("const bunVersionResult"),
    );
    expect(runSandbox).toContain("runPinnedCommand");
    expect(runSandbox).toContain("TRUSTED_VERIFIER_EXECUTION_POLICY.hostBash");

    const gitleaksReplay = source.slice(
      source.indexOf("const gitleaksReplayRoot"),
      source.indexOf("const commandRecords"),
    );
    expect(gitleaksReplay).toContain("runPinnedCommand");
    expect(gitleaksReplay).toContain("TRUSTED_VERIFIER_EXECUTION_POLICY.bundledGitleaks");
    expect(gitleaksReplay).not.toContain("openEvidenceRegular(credentialScan.gitleaks.tool.path)");
    expect(source).toContain('gitleaksSha256: "00e91bbe655bd7c47753e8cfe61cb76ea1a5d7e7702fe161ee40102b46b3823b"');
    expect(source).not.toContain("realpathSync(manifest.network_isolation.sandbox_");
  });

  test("descriptor-bound execution retains verified identity across path replacement", () => {
    const directory = mkdtempSync(join(tmpdir(), "todos-descriptor-exec-"));
    const launcher = join(directory, "launcher");
    const replacement = join(directory, "replacement");
    const marker = join(directory, "untrusted-executed");
    let descriptor: number | undefined;
    try {
      copyFileSync("/bin/true", launcher);
      chmodSync(launcher, 0o755);
      descriptor = openSync(launcher, constants.O_RDONLY | constants.O_NOFOLLOW);
      writeFileSync(replacement, `#!/bin/sh\nprintf untrusted > ${JSON.stringify(marker)}\nexit 97\n`);
      chmodSync(replacement, 0o755);
      renameSync(replacement, launcher);

      const result = spawnSync(`/proc/self/fd/${descriptor}`, [], {
        encoding: null,
        stdio: ["ignore", "pipe", "pipe"],
      });
      expect(result.status).toBe(0);
      expect(existsSync(marker)).toBe(false);
    } finally {
      if (descriptor !== undefined) closeSync(descriptor);
      rmSync(directory, { recursive: true, force: true });
    }
  });

  test("creator and verifier use bounded pinned execution and verifier-owned replay policy", () => {
    const creator = readFileSync(join(root, "scripts/create-stage-a-evidence.ts"), "utf8");
    const verifier = readFileSync(join(root, "scripts/verify-stage-a-evidence.ts"), "utf8");
    expect(creator).toContain("openAnchoredRegularFollowingInternalLinks");
    expect(creator).toContain('from "./stage-a-process.js"');
    expect(creator).toContain("runPinnedCommand");
    expect(creator).toContain("openEvidenceFileMatchingIdentity");
    expect(creator).toContain("sandboxRuntimeBindings");
    expect(creator).not.toContain('["bash", "-lc"');
    expect(creator).not.toContain("Bun.spawnSync(");
    expect(creator).not.toContain("spawnSync(");
    expect(verifier).toContain('from "./stage-a-verifier-policy.js"');
    expect(verifier).toContain("assertCommandRecordMatchesPolicy");
    expect(verifier).toContain("openEvidenceFileMatchingIdentity");
    expect(verifier).not.toContain("skipArtifactSmokes");
    expect(verifier).not.toContain("replaySource");
    expect(verifier).not.toContain("runSandbox(hostWorkspace, record.env, record.argv)");
  });

  test("gitleaks uses a private normal-path snapshot and independently replays the bounded scan", () => {
    const creator = readFileSync(join(root, "scripts/create-stage-a-evidence.ts"), "utf8");
    const verifier = readFileSync(join(root, "scripts/verify-stage-a-evidence.ts"), "utf8");
    const creatorScan = creator.slice(creator.indexOf("async function runNormalPathGitleaks"), creator.indexOf("const auditsRoot"));
    const verifierScan = verifier.slice(verifier.indexOf("const gitleaksReplayRoot"), verifier.indexOf("const commandRecords"));

    expect(creatorScan).toContain("gitleaks-normal-path-snapshot");
    expect(creatorScan).toContain("primary");
    expect(creatorScan).toContain("independent-replay");
    expect(creatorScan).not.toContain("gitleaksDescriptorPath");
    expect(creatorScan).not.toMatch(/\/proc\/(?:self|\$\{process\.pid\})\/fd/);
    expect(verifierScan).toContain("gitleaks-normal-path-snapshot");
    expect(verifierScan).not.toMatch(/\/proc\/(?:self|\$\{process\.pid\})\/fd/);
  });

  test("gitleaks detects a synthetic fixture at a normal path while a descriptor path traverses zero files", () => {
    const gitleaks = process.env.STAGE_A_TEST_GITLEAKS;
    expect(gitleaks).toBeTruthy();
    const directory = mkdtempSync(join(tmpdir(), "todos-gitleaks-path-proof-"));
    const snapshot = join(directory, "private-snapshot");
    const normalReport = join(directory, "normal.json");
    const descriptorReport = join(directory, "descriptor.json");
    let descriptor: number | undefined;
    try {
      mkdirSync(snapshot, { mode: 0o700 });
      const synthetic = ["ghp", "_", "aB3dE5fG7hJ9kL2mN4pQ6rS8tV1wX0yZcD4e"].join("");
      writeFileSync(join(snapshot, "synthetic-fixture.test.txt"), `fixture=${synthetic}\n`, { mode: 0o600 });
      const scan = (scanRoot: string, report: string) => spawnSync(gitleaks!, [
        "dir", scanRoot,
        "--no-banner", "--no-color", "--log-level", "error", "--redact=100",
        "--max-archive-depth", "0", "--max-decode-depth", "1", "--max-target-megabytes", "4",
        "--timeout", "10", "--report-format", "json", "--report-path", report,
      ], {
        cwd: directory,
        env: { LANG: "C.UTF-8", LC_ALL: "C" },
        encoding: "utf8",
        stdio: ["ignore", "pipe", "pipe"],
        timeout: 15_000,
      });

      const normal = scan(snapshot, normalReport);
      expect(normal.status, normal.stderr).toBe(1);
      const normalFindings = JSON.parse(readFileSync(normalReport, "utf8")) as Array<Record<string, unknown>>;
      expect(normalFindings.length).toBeGreaterThan(0);
      expect(normalFindings.every((finding) => typeof finding.RuleID === "string" && typeof finding.File === "string")).toBe(true);

      descriptor = openSync(snapshot, constants.O_RDONLY | constants.O_DIRECTORY | constants.O_NOFOLLOW);
      const descriptorScan = scan(`/proc/${process.pid}/fd/${descriptor}`, descriptorReport);
      expect(descriptorScan.status, descriptorScan.stderr).toBe(0);
      const descriptorFindings = JSON.parse(readFileSync(descriptorReport, "utf8")) as Array<Record<string, unknown>>;
      expect(descriptorFindings).toHaveLength(0);
    } finally {
      if (descriptor !== undefined) closeSync(descriptor);
      rmSync(directory, { recursive: true, force: true });
    }
  });

  test("manifest and recorded argv omit runtime topology while retaining replay identities", () => {
    const creator = readFileSync(join(root, "scripts/create-stage-a-evidence.ts"), "utf8");
    const verifier = readFileSync(join(root, "scripts/verify-stage-a-evidence.ts"), "utf8");
    expect(creator).toContain("runtime_topology_free: true");
    expect(creator).toContain("normalizedLaunchArgv");
    expect(creator).not.toContain("parent_namespace:");
    expect(creator).not.toContain("child_namespace:");
    expect(creator).not.toContain("source_path?: string");
    expect(creator).not.toContain("source_path: sourcePath");
    expect(verifier).toContain("assertTopologyNeutralRecord");
    expect(verifier).toContain("runtime_topology_free");
  });
});
