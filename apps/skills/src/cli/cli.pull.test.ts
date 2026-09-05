import { describe, expect, test } from "bun:test";
import { runCli } from "./cli.test-utils";

import { useDefaultTestTimeout } from "../test-preload.js";

useDefaultTestTimeout();

// A clean $HOME with no credentials file, and no credential variables: the CLI test
// env strips every fleet variable and blinds the Keychain tier, so this really is an
// unconfigured install. The point of these tests is that `skills pull` fails closed
// instead of inventing a host. (Blank values are NOT how you express "unset": the
// shared ladder refuses a declared-but-empty credential.)
const UNCONFIGURED = {};

describe("skills pull (CLI)", () => {
  test("--help documents the command and its flags", async () => {
    const { stdout, exitCode } = await runCli(["pull", "--help"]);
    expect(exitCode).toBe(0);
    expect(stdout).toContain("into this machine's corpus");
    expect(stdout).toContain("--all");
    expect(stdout).toContain("--for-machine");
  });

  test("fails closed with a clear message when nothing is configured", async () => {
    const { stderr, exitCode } = await runCli(["pull", "some-skill"], UNCONFIGURED);
    expect(exitCode).toBe(1);
    // No credential -> named, actionable error; never a silent success or a guessed host.
    expect(stderr).toContain("No API key configured");
    expect(stderr).toContain("HASNA_SKILLS_API_KEY");
  });

  test("fails closed when an origin is configured but no credential resolves", async () => {
    const { stderr, exitCode } = await runCli(["pull", "some-skill"], {
      SKILLS_API_URL: "https://skills.internal.example",
    });
    expect(exitCode).toBe(1);
    // Never the local corpus: an authority with no key is a loud failure that
    // names every rung the ladder looked at.
    expect(stderr).toContain("no API key resolved");
    expect(stderr).toContain("skills auth login");
    expect(stderr.toLowerCase()).not.toContain("localhost");
  });

  test("--json emits a structured error when unconfigured", async () => {
    const { stdout, exitCode } = await runCli(["pull", "some-skill", "--json"], UNCONFIGURED);
    expect(exitCode).toBe(1);
    const payload = JSON.parse(stdout);
    expect(payload.error).toContain("No API key configured");
    expect(Array.isArray(payload.detail)).toBe(true);
  });
});
