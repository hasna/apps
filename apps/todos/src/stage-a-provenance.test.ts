import { describe, expect, test } from "bun:test";
import {
  chmodSync,
  closeSync,
  constants,
  copyFileSync,
  existsSync,
  mkdtempSync,
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

    expect(source).toContain("31988ba7a1ca3d42f50cb2fab894a3581f8e568f");
    expect(source).toContain("canonical_source_candidate_digest");
    expect(source).toContain("git diff --binary --full-index --no-ext-diff");
    expect(source).toContain("git ls-files --others --exclude-standard -z");
    expect(source).toContain("generated_sdk: { before: generatedSdkBefore, after: generatedSdkAfter, equal: true }");
    expect(source).toContain('"install-free build"');
    expect(source).toContain("inventory: artifactInventory");
    expect(source).toContain("mode");
    expect(source).toContain("sha256");
    expect(source).toContain("containment_smokes");
    expect(source).toContain("built MCP HTTP cold/warm import");
    expect(source).toContain("built direct storage cold/warm import");
    expect(source).toContain("source_digest_after");
    expect(source).toContain("archive_sha256: artifactArchiveIdentity.sha256");
    expect(source).toContain("STAGE_A_TRIPWIRE_IMPORTS");
    expect(source).toContain('"--tmpfs", "/home"');
    expect(source).toContain('"--unshare-net"');
    expect(source).toContain('"--unshare-pid"');
    expect(source).toContain('"--proc", "/proc"');
    expect(source).toContain("sandbox-root");
    expect(source).toContain("assertHostSandboxRuntimeBinding();");
    expect(source).toContain("canonical AppArmor-authorized path");
    expect(source).toContain('"--ro-bind-fd"');
    expect(source).toContain("directory_fds=0");
    expect(source).toContain("ulimit -f 65536");
    expect(source).not.toContain('"--ro-bind", "/", "/"');
    expect(source).not.toContain("bun-real");
    expect(source).toContain('"--frozen-lockfile"');
    expect(source).toContain('"--ignore-scripts"');
    expect(source).toContain('"--backend=copyfile"');
    expect(source).toContain('"--linker=hoisted"');
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
    expect(source.indexOf("relativeEvidencePath(verifierSource)")).toBeLessThan(source.indexOf("const finalCandidateDigest"));
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

  test("the standalone verifier binds legacy replay labels and has no encoded chunk boundary", () => {
    const source = readFileSync(join(root, "scripts/verify-stage-a-evidence.ts"), "utf8");
    expect(source).toContain("requiredReplayLabels");
    expect(source).toContain('"--tmpfs", "/home"');
    expect(source).toContain("interface SecretScanUnit");
    expect(source).toContain("compactAsciiProjection");
    expect(source).toContain("utf16Projection");
    expect(source).toContain("MAX_PERCENT_DECODE_PASSES = 32");
    expect(source).toContain("highConfidenceCredentialCategories");
    expect(source).toContain("borrowedRootDescriptor");
    expect(source).toContain("copyDescriptorAnchoredTree");
    expect(source).toContain("Buffer.compare(actualStdout, expectedStdout)");
    expect(source).toContain("readTar(evidencePath(manifest.dependencies.archive.path), false)");
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

  test("self-consistent manifest executable fields cannot select verifier launchers", () => {
    const source = readFileSync(join(root, "scripts/verify-stage-a-evidence.ts"), "utf8");
    const sandboxInvocation = source.slice(
      source.indexOf("function sandboxInvocation"),
      source.indexOf("function runSandbox"),
    );
    expect(sandboxInvocation).toContain("TRUSTED_VERIFIER_EXECUTION_POLICY.hostBash");
    expect(sandboxInvocation).toContain("TRUSTED_VERIFIER_EXECUTION_POLICY.hostBwrap");
    expect(sandboxInvocation).toContain("/proc/self/fd/${shellDescriptor}");
    expect(sandboxInvocation).toContain("/proc/self/fd/${bwrapChildFd}");
    expect(sandboxInvocation).not.toContain("manifest.network_isolation.sandbox_launch_shell_path");
    expect(sandboxInvocation).not.toContain("manifest.network_isolation.sandbox_execution_path");

    const gitleaksReplay = source.slice(
      source.indexOf("const gitleaksReplayRoot"),
      source.indexOf("const commandRecords"),
    );
    expect(gitleaksReplay).toContain("openEvidenceRegular(TRUSTED_VERIFIER_EXECUTION_POLICY.bundledGitleaks)");
    expect(gitleaksReplay).toContain("/proc/self/fd/${toolDescriptor}");
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
});
