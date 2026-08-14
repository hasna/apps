process.env.TESTERS_DB_PATH = ":memory:";

import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { closeDatabase, resetDatabase } from "./database.js";
import { createProject } from "./projects.js";
import { fingerprintIssue, listScanIssues, upsertScanIssue } from "./scan-issues.js";
import type { ScanIssue } from "../types/index.js";

function issue(overrides: Partial<ScanIssue> = {}): ScanIssue {
  return {
    type: "console_error",
    severity: "high",
    pageUrl: "https://alpha.example/login?next=/billing",
    message: "Unhandled TypeError: failed to load profile",
    ...overrides,
  };
}

describe("scan issue tracking", () => {
  beforeEach(() => {
    resetDatabase();
  });

  afterEach(() => {
    closeDatabase();
  });

  test("fingerprints ignore URL query strings within the same project", () => {
    const first = fingerprintIssue(issue(), "project-1");
    const second = fingerprintIssue(
      issue({ pageUrl: "https://preview.example/login?next=/settings#top" }),
      "project-1",
    );

    expect(first).toBe(second);
  });

  test("fingerprints do not merge different projects or unscoped origins", () => {
    expect(fingerprintIssue(issue(), "project-1")).not.toBe(
      fingerprintIssue(issue(), "project-2"),
    );
    expect(fingerprintIssue(issue())).not.toBe(
      fingerprintIssue(issue({ pageUrl: "https://beta.example/login" })),
    );
  });

  test("upserts keep identical route failures separate by project", () => {
    const firstProject = createProject({ name: "scan-project-1" });
    const secondProject = createProject({ name: "scan-project-2" });

    const first = upsertScanIssue(issue(), firstProject.id);
    const second = upsertScanIssue(
      issue({ pageUrl: "https://beta.example/login" }),
      secondProject.id,
    );

    expect(first.outcome).toBe("new");
    expect(second.outcome).toBe("new");
    expect(first.issue.id).not.toBe(second.issue.id);
    expect(listScanIssues()).toHaveLength(2);
  });
});
