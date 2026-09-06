import { mkdir, mkdtemp, rm } from "node:fs/promises";
import { join } from "node:path";
import { homedir } from "node:os";
import { test, expect } from "bun:test";
import { harnessInstallation, harnessInstallationMessage } from "../src/harness-installation";
import { detectHarness } from "../src/harnesses";

const harnesses = ["claude", "codex", "grok", "opencode", "opencode2", "pi", "omp", "dsh", "cline", "hermes", "prime-agent", "gemini", "aider", "kilo"] as const;

test("every native harness has actionable, version-aware installation metadata", () => {
  const requirements = {
    claude: ">=2.1.242", codex: ">=0.153.0", grok: ">=1.0.13", opencode: ">=1.18.0",
    opencode2: "beta-19157 or newer (including stable >=2.0.0)", pi: ">=0.85.1", omp: ">=18.1.11", dsh: ">=0.1.2-rc.1",
    cline: ">=3.0.61", hermes: ">=0.21.0", "prime-agent": ">=0.9.2", gemini: "exactly 0.58.0",
    aider: "exactly 0.86.2", kilo: ">=7.5.15",
  } as const;
  for (const harness of harnesses) {
    const metadata = harnessInstallation(harness);
    expect(metadata.executable).toBe(harness === "prime-agent" ? "prime-agent" : harness);
    expect(metadata.versionRequirement).toBe(requirements[harness]);
    expect(metadata.displayName.length).toBeGreaterThan(0);
    expect(metadata.packageOrProject.length).toBeGreaterThan(0);
    expect(metadata.documentationUrl).toMatch(/^https:\/\//);
    expect(metadata.installationGuidance).toContain("--executable");
  }
});

test("missing executable guidance names the selected harness contract and preserves explicit path recovery", () => {
  const automatic = harnessInstallationMessage("gemini", "gemini", false);
  expect(automatic).toContain("Gemini CLI (gemini)");
  expect(automatic).toContain("exactly 0.58.0");
  expect(automatic).toContain("@google/gemini-cli");
  expect(automatic).toContain("--executable");

  const explicit = harnessInstallationMessage("opencode2", "/owned/opencode2", true);
  expect(explicit).toContain("Configured executable /owned/opencode2");
  expect(explicit).toContain("beta-19157 or newer (including stable >=2.0.0)");
  expect(explicit).toContain("https://opencode.ai/v2/docs/");
});

test("detectHarness returns the same installation contract for available and missing executables", async () => {
  const parent = process.env.SWITCHER_TEST_ROOT ?? join(homedir(), "Workspace", "scratch", "switcher-tests");
  await mkdir(parent, { recursive: true });
  const root = await mkdtemp(join(parent, "install-guidance-"));
  try {
    const available = await detectHarness("pi", process.execPath);
    expect(available).toMatchObject({ harness: "pi", executable: process.execPath, available: true });
    expect(available.version).toMatch(/^\d+\.\d+\.\d+/);
    expect(available.installation).toEqual(harnessInstallation("pi"));
    const missing = await detectHarness("pi", join(root, "missing"));
    expect(missing).toMatchObject({ harness: "pi", available: false, version: undefined });
    expect(missing.installation).toEqual(harnessInstallation("pi"));
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});
