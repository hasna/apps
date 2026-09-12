import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { join } from "node:path";

import { useDefaultTestTimeout } from "../test-preload.js";

useDefaultTestTimeout();

describe("README versioned cloud onboarding", () => {
  const readme = readFileSync(join(process.cwd(), "README.md"), "utf8");

  test("documents reviewed cloud execution and readiness", () => {
    for (const phrase of [
      "## Executable skills",
      "Cloud execution is enabled only",
      "arbitrary\nuploaded code is not admitted",
      "skills auth login",
      "skills executions status RUN_ID --json",
      "skills executions download RUN_ID document.pdf --output ./document.pdf",
    ]) {
      expect(readme).toContain(phrase);
    }
  });

  test("separates Skills API auth from local provider keys", () => {
    for (const phrase of [
      "`HASNA_SKILLS_API_KEY` is a Skills",
      "API credential, not a provider key",
      "`OPENAI_API_KEY`",
      "explicit environment references",
      "skill process has no API/provider credentials",
    ]) {
      expect(readme).toContain(phrase);
    }
  });

  test("documents versioned remote JSON run payloads", () => {
    expect(readme).toContain('"contractVersion": 1');
    expect(readme).toContain('"remote": true');
    expect(readme).toContain('"remoteRun"');
    expect(readme).toContain('"nextActions"');
  });
});
