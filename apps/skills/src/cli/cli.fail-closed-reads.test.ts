/**
 * Every CLI read verb fails closed the way `skills list` does.
 *
 * Under the fail-closed ruling (owner directive 2026-09-04, hasna/apps#1720)
 * `list` / `search` / `categories` / `tags` exit 1 with the ladder's refusal
 * when no credential resolves, no authority is configured and the local opt-in
 * is absent. `info` / `show` / `docs` / `requires` and the bare non-TTY
 * listing did not: they printed the bundled catalog at exit 0 on the very same
 * environment (#1720 validation, round 1). `setup-info` reported
 * `mode: "misconfigured"` in its payload but exited 0.
 *
 * The harness opts every child in by default (HASNA_SKILLS_LOCAL=1); a blank
 * value here opts a child OUT, which is the fail-closed environment. HOME is a
 * throwaway (no credentials file), the Keychain account is absent, and every
 * credential variable is stripped — see cli.test-utils.ts / test-preload.ts.
 */
import { describe, expect, test } from "bun:test";

import { useDefaultTestTimeout } from "../test-preload.js";
import { runCli, stderrWithoutLocalNotice } from "./cli.test-utils.js";

useDefaultTestTimeout();

const FAIL_CLOSED = { HASNA_SKILLS_LOCAL: "" };

const READ_VERBS: string[][] = [
  ["info", "brand-kit", "--json"],
  ["info", "brand-kit"],
  ["show", "brand-kit", "--brief"],
  ["docs", "brand-kit"],
  ["docs", "brand-kit", "--json"],
  ["requires", "brand-kit", "--json"],
  ["requires", "brand-kit"],
  [], // the bare verb: the non-TTY compact listing
];

describe("read verbs fail closed without a credential and without the opt-in", () => {
  for (const args of READ_VERBS) {
    test(`skills ${args.join(" ") || "(bare)"} exits 1 with nothing on stdout and the refusal on stderr`, async () => {
      const { stdout, stderr, exitCode } = await runCli(args, FAIL_CLOSED);
      expect(exitCode).toBe(1);
      expect(stdout).toBe("");
      const [first] = stderr.trim().split("\n");
      expect(first).toContain("failing closed");
      expect(first).toContain("HASNA_SKILLS_LOCAL=1");
      // Where the credential should live, not only how to log in.
      expect(first).toContain("hasna.credentials.skills.api-key");
      expect(first).toContain("HASNA_SKILLS_API_KEY");
      expect(first).toContain("/.hasna/skills/config/credentials");
      expect(first).toContain("skills auth login");
      // Never mistaken for a missing skill.
      expect(stderr).not.toContain("not found");
    });
  }

  test("an authority with no key is refused on info, naming the authority — never served locally", async () => {
    const { stdout, stderr, exitCode } = await runCli(["info", "brand-kit", "--json"], {
      ...FAIL_CLOSED,
      HASNA_SKILLS_API_URL: "https://skills.example.com",
    });
    expect(exitCode).toBe(1);
    expect(stdout).toBe("");
    expect(stderr).toContain("HASNA_SKILLS_API_URL");
    expect(stderr).toContain("no API key resolved");
  });

  test("setup-info reports the misconfigured state AND exits 1 (JSON shape unchanged)", async () => {
    const { stdout, exitCode } = await runCli(["setup-info", "--json"], FAIL_CLOSED);
    expect(exitCode).toBe(1);
    const payload = JSON.parse(stdout) as { version: string; credential: { mode: string; error: string | null; apiKeySource: string | null } };
    expect(payload.credential.mode).toBe("misconfigured");
    expect(payload.credential.error).toContain("failing closed");
    expect(payload.credential.apiKeySource).toBeNull();

    const human = await runCli(["setup-info"], FAIL_CLOSED);
    expect(human.exitCode).toBe(1);
    expect(human.stdout).toContain("misconfigured");
  });

  describe("control: the explicit local opt-in serves the on-machine answer", () => {
    test("info / docs / requires / bare listing exit 0 and announce local mode once", async () => {
      const info = await runCli(["info", "brand-kit", "--json"]);
      expect(info.exitCode).toBe(0);
      expect((JSON.parse(info.stdout) as { name: string }).name).toBe("brand-kit");
      expect(info.stderr).toContain("skills: local mode");
      expect(stderrWithoutLocalNotice(info.stderr)).toBe("");

      const docs = await runCli(["docs", "brand-kit"]);
      expect(docs.exitCode).toBe(0);
      expect(docs.stdout).toContain("Brand Kit");

      const requires = await runCli(["requires", "brand-kit", "--json"]);
      expect(requires.exitCode).toBe(0);
      expect(JSON.parse(requires.stdout)).toHaveProperty("envVars");

      const bare = await runCli([]);
      expect(bare.exitCode).toBe(0);
      expect(Array.isArray(JSON.parse(bare.stdout))).toBe(true);
      expect(bare.stderr).toContain("skills: local mode");
    });

    test("setup-info reports local mode and exits 0", async () => {
      const { stdout, exitCode } = await runCli(["setup-info", "--json"]);
      expect(exitCode).toBe(0);
      expect((JSON.parse(stdout) as { credential: { mode: string } }).credential.mode).toBe("local");
    });
  });
});
