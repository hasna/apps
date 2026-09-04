import { describe, expect, test } from "bun:test";
import { execFileSync } from "node:child_process";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { splitNameVersion } from "../../lib/pull.js";
import { packSkillBundle } from "../../lib/skill-bundle.js";
import { buildVersionManifest, bumpPatch, sanitizeGitRemote } from "./publish.js";
import { useDefaultTestTimeout } from "../../test-preload.js";

useDefaultTestTimeout();

describe("name@version parsing and --force-new-version bumps", () => {
  test("splitNameVersion separates an exact version and leaves bare names alone", () => {
    expect(splitNameVersion("release-notes@2.1.0")).toEqual({ name: "release-notes", version: "2.1.0" });
    expect(splitNameVersion("release-notes").version).toBeUndefined();
  });

  test("bumpPatch increments the patch and stays unique for non-semver versions", () => {
    expect(bumpPatch("2.1.0")).toBe("2.1.1");
    expect(bumpPatch("0.0.9")).toBe("0.0.10");
    expect(bumpPatch("nightly")).toBe("nightly.1");
  });
});

describe("manifest provenance hygiene (hasna/apps#1671)", () => {
  test("sanitizeGitRemote strips embedded credentials and leaves scp-style remotes alone", () => {
    // The case the review flagged: userinfo riding in a https remote would leak into
    // manifest.json in the bucket. Note the fixture uses a plain user/password pair —
    // a real token shape would trip the repo's own secret scanner.
    expect(sanitizeGitRemote("https://user:acme-password@github.com/hasna/apps.git")).toBe("https://github.com/hasna/apps.git");
    expect(sanitizeGitRemote("https://jenkins-ci@github.com:8443/hasna/apps.git")).toBe("https://github.com:8443/hasna/apps.git");
    // No userinfo: unchanged.
    expect(sanitizeGitRemote("https://github.com/hasna/apps.git")).toBe("https://github.com/hasna/apps.git");
    // scp-style: the `git@` user is the transport user, not an embedded credential.
    expect(sanitizeGitRemote("git@github.com:hasna/apps.git")).toBe("git@github.com:hasna/apps.git");
    // Same for an explicit ssh:// scheme: the login user is not a credential.
    expect(sanitizeGitRemote("ssh://git@github.com/hasna/apps.git")).toBe("ssh://git@github.com/hasna/apps.git");
    expect(sanitizeGitRemote(null)).toBeNull();
  });

  const gitAvailable = (() => {
    try {
      execFileSync("git", ["--version"], { stdio: "ignore" });
      return true;
    } catch {
      return false;
    }
  })();

  test.skipIf(!gitAvailable)("buildVersionManifest records a credential-stripped git remote", () => {
    const dir = mkdtempSync(join(tmpdir(), "skills-manifest-provenance-"));
    try {
      execFileSync("git", ["-C", dir, "init", "-q"], { stdio: "ignore" });
      execFileSync("git", ["-C", dir, "remote", "add", "origin", "https://user:token@github.com/hasna/apps.git"], { stdio: "ignore" });
      execFileSync("git", ["-C", dir, "config", "user.email", "test@example.com"], { stdio: "ignore" });
      execFileSync("git", ["-C", dir, "config", "user.name", "Test"], { stdio: "ignore" });
      writeFileSync(join(dir, "SKILL.md"), "---\nname: provenance-check\ndescription: Provenance hygiene\nversion: 1.0.0\n---\n\n# Provenance\n");
      mkdirSync(join(dir, "scripts"), { recursive: true });
      writeFileSync(join(dir, "scripts", "run.ts"), "console.log('provenance')\n");
      execFileSync("git", ["-C", dir, "add", "-A"], { stdio: "ignore" });
      execFileSync("git", ["-C", dir, "commit", "-q", "-m", "provenance fixture"], { stdio: "ignore" });

      const manifest = buildVersionManifest(dir, packSkillBundle(dir));
      // The embedded token never reaches the manifest...
      expect(manifest.provenance.gitRemote).toBe("https://github.com/hasna/apps.git");
      expect(manifest.provenance.gitRemote).not.toContain("token");
      // ...and the provenance block still names where the bytes came from.
      expect(manifest.provenance.gitSha).toMatch(/^[0-9a-f]{40}$/);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });
});