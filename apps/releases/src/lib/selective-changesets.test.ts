import { describe, expect, test } from "bun:test";
import {
  chmodSync,
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  symlinkSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import {
  SelectiveChangesetError,
  applySelectiveChangesets,
  planSelectiveChangesets,
} from "./selective-changesets.js";

const REPO_ROOT = resolve(import.meta.dir, "../../../..");
const RELEASES_CLI_PATH =
  process.env["RELEASES_TEST_CLI"] ??
  join(REPO_ROOT, "apps/releases/src/cli/index.ts");

const CHANGESETS = {
  "conversations-monorepo-first-release": `---
"@hasna/conversations": patch
---

First release from the hasna/apps monorepo.
`,
  "projects-monorepo-first-release": `---
"@hasna/projects": patch
---

First release from the hasna/apps monorepo.
`,
  "projects-conversations-prebound-adoption": `---
"@hasna/conversations": patch
"@hasna/projects": patch
---

Add fail-closed adoption of an exact pre-bound project channel.
`,
  "projects-serve-help-before-dburl": `---
"@hasna/projects": patch
---

Answer help and version without a configured database URL.
`,
  "todos-9b050845-bounded-remote-timeout": `---
"@hasna/todos": patch
---

Bound authenticated requests to a single timeout budget.
`,
  "todos-0-15-34-storage-mode-removal": `---
"@hasna/todos": patch
---

Remove the deprecated storage-mode environment selection.
`,
  "plan-comment-surface-04ee08fd": `---
"@hasna/todos": patch
---

Add the plan comment surface end to end.
`,
} as const;

const SELECTED_CHANGESET_IDS = Object.keys(CHANGESETS).sort();
const PACKAGE_ALLOWLIST = [
  "@hasna/conversations",
  "@hasna/projects",
  "@hasna/todos",
];

const EXPECTED_PATHS = [
  ".changeset/conversations-monorepo-first-release.md",
  ".changeset/plan-comment-surface-04ee08fd.md",
  ".changeset/projects-conversations-prebound-adoption.md",
  ".changeset/projects-monorepo-first-release.md",
  ".changeset/projects-serve-help-before-dburl.md",
  ".changeset/todos-0-15-34-storage-mode-removal.md",
  ".changeset/todos-9b050845-bounded-remote-timeout.md",
  "apps/conversations/CHANGELOG.md",
  "apps/conversations/package.json",
  "apps/projects/CHANGELOG.md",
  "apps/projects/package.json",
  "apps/todos/CHANGELOG.md",
  "apps/todos/package.json",
];

type Fixture = {
  root: string;
  cleanup: () => void;
};

function writeFixtureFile(root: string, path: string, contents: string): void {
  const destination = join(root, path);
  mkdirSync(dirname(destination), { recursive: true });
  writeFileSync(destination, contents);
}

function writeFixtureJson(
  root: string,
  path: string,
  value: unknown,
): void {
  writeFixtureFile(root, path, `${JSON.stringify(value, null, 2)}\n`);
}

function runGit(root: string, args: string[]): void {
  const result = Bun.spawnSync(["git", ...args], {
    cwd: root,
    stdout: "pipe",
    stderr: "pipe",
    env: {
      ...process.env,
      GIT_AUTHOR_NAME: "Changesets fixture",
      GIT_AUTHOR_EMAIL: "fixture@example.com",
      GIT_COMMITTER_NAME: "Changesets fixture",
      GIT_COMMITTER_EMAIL: "fixture@example.com",
    },
  });
  if (result.exitCode !== 0) {
    throw new Error(
      `git ${args.join(" ")} failed: ${result.stderr.toString()}`,
    );
  }
}

function createFixture(options: { linkNodeModules?: boolean } = {}): Fixture {
  const root = mkdtempSync(join(tmpdir(), "releases-selective-changesets-"));
  writeFixtureJson(root, "package.json", {
    name: "selective-changesets-fixture",
    private: true,
    workspaces: ["apps/*"],
  });
  writeFixtureFile(root, "bun.lock", "# fixture lock\n");
  writeFixtureFile(root, ".gitignore", "node_modules\n");
  writeFixtureJson(root, ".changeset/config.json", {
    $schema: "https://unpkg.com/@changesets/config@3.0.3/schema.json",
    changelog: "@changesets/cli/changelog",
    commit: false,
    fixed: [],
    linked: [],
    access: "public",
    baseBranch: "main",
    updateInternalDependencies: "patch",
    ignore: [],
  });

  for (const [id, contents] of Object.entries(CHANGESETS)) {
    writeFixtureFile(root, `.changeset/${id}.md`, contents);
  }
  writeFixtureFile(
    root,
    ".changeset/unselected-release.md",
    `---
"@hasna/events": patch
---

This Changeset must remain byte-for-byte unchanged.
`,
  );

  writeFixtureJson(root, "apps/events/package.json", {
    name: "@hasna/events",
    version: "0.1.15",
  });
  writeFixtureJson(root, "apps/loops/package.json", {
    name: "@hasna/loops",
    version: "0.5.1",
  });
  writeFixtureJson(root, "apps/conversations/package.json", {
    name: "@hasna/conversations",
    version: "0.6.2",
    dependencies: {
      "@hasna/events": "^0.1.6",
    },
  });
  writeFixtureJson(root, "apps/todos/package.json", {
    name: "@hasna/todos",
    version: "0.15.35",
    dependencies: {
      "@hasna/events": "^0.1.11",
    },
  });
  writeFixtureJson(root, "apps/projects/package.json", {
    name: "@hasna/projects",
    version: "0.1.132",
    dependencies: {
      "@hasna/conversations": "0.5.41",
      "@hasna/events": "0.1.3",
      "@hasna/todos": "0.15.19",
    },
    peerDependencies: {
      "@hasna/loops": ">=0.3.0",
    },
  });

  for (const packageName of ["conversations", "projects", "todos"]) {
    writeFixtureFile(
      root,
      `apps/${packageName}/CHANGELOG.md`,
      `# @hasna/${packageName}\n\n## Unreleased\n`,
    );
  }
  for (const packageName of ["events", "loops"]) {
    writeFixtureFile(
      root,
      `apps/${packageName}/CHANGELOG.md`,
      `# @hasna/${packageName}\n\n## Unreleased\n`,
    );
  }

  if (options.linkNodeModules !== false) {
    symlinkSync(join(REPO_ROOT, "node_modules"), join(root, "node_modules"), "dir");
  }
  runGit(root, ["init", "-q", "-b", "main"]);
  runGit(root, ["add", "."]);
  runGit(root, ["commit", "-qm", "fixture"]);

  return {
    root,
    cleanup: () => rmSync(root, { recursive: true, force: true }),
  };
}

function readBytes(root: string, paths: readonly string[]): Map<string, Buffer> {
  return new Map(
    paths.map((path) => [path, readFileSync(join(root, path))]),
  );
}

function expectBytesUnchanged(
  root: string,
  before: ReadonlyMap<string, Buffer>,
): void {
  for (const [path, contents] of before) {
    expect(readFileSync(join(root, path)).equals(contents)).toBe(true);
  }
}

function readManifest(
  root: string,
  packageName: string,
): {
  version: string;
  dependencies?: Record<string, string>;
} {
  return JSON.parse(
    readFileSync(join(root, `apps/${packageName}/package.json`), "utf8"),
  );
}

function configureConcurrentChangelog(root: string): void {
  writeFixtureJson(root, ".changeset/config.json", {
    $schema: "https://unpkg.com/@changesets/config@3.0.3/schema.json",
    changelog: ["./concurrent-changelog.cjs", { realRoot: root }],
    commit: false,
    fixed: [],
    linked: [],
    access: "public",
    baseBranch: "main",
    updateInternalDependencies: "patch",
    ignore: [],
  });
  writeFixtureFile(
    root,
    ".changeset/concurrent-changelog.cjs",
    `const fs = require("node:fs");
const path = require("node:path");
let mutated = false;

module.exports = {
  async getReleaseLine(changeset, _type, options) {
    if (!mutated) {
      mutated = true;
      const manifestPath = path.join(
        options.realRoot,
        "apps/conversations/package.json",
      );
      const manifest = JSON.parse(fs.readFileSync(manifestPath, "utf8"));
      manifest.concurrentMarker = "must-survive";
      fs.writeFileSync(manifestPath, JSON.stringify(manifest, null, 2) + "\\n");
    }
    return "- " + changeset.summary;
  },
  async getDependencyReleaseLine() {
    return "";
  },
};
`,
  );
}

function changesetsCandidateCliArgs(root: string, apply = false): string[] {
  return [
    "bun",
    "run",
    RELEASES_CLI_PATH,
    "changesets-candidate",
    "--cwd",
    root,
    ...(apply ? ["--apply"] : []),
    ...SELECTED_CHANGESET_IDS.flatMap((id) => ["--changeset", id]),
    ...PACKAGE_ALLOWLIST.flatMap((name) => ["--package", name]),
  ];
}

describe("selective Changesets candidate", () => {
  test("dry-run plans the seven Conversations/Todos/Projects Changesets and writes nothing", async () => {
    const fixture = createFixture();
    try {
      const protectedPaths = [
        ...SELECTED_CHANGESET_IDS.map((id) => `.changeset/${id}.md`),
        ".changeset/unselected-release.md",
        "apps/conversations/package.json",
        "apps/projects/package.json",
        "apps/todos/package.json",
        "apps/events/package.json",
        "apps/loops/package.json",
      ];
      const before = readBytes(fixture.root, protectedPaths);

      const result = await planSelectiveChangesets({
        cwd: fixture.root,
        changesetIds: SELECTED_CHANGESET_IDS,
        packageAllowlist: PACKAGE_ALLOWLIST,
      });

      expect(result.mode).toBe("dry-run");
      expect(result.plannedPaths).toEqual(EXPECTED_PATHS);
      expect(result.touchedPaths).toEqual([]);
      expect(
        Object.fromEntries(
          result.releases.map((release) => [
            release.name,
            release.newVersion,
          ]),
        ),
      ).toEqual({
        "@hasna/conversations": "0.6.3",
        "@hasna/projects": "0.1.133",
        "@hasna/todos": "0.15.36",
      });
      expectBytesUnchanged(fixture.root, before);
    } finally {
      fixture.cleanup();
    }
  });

  test("apply touches exactly 13 paths and preserves Events, Loops, and the unselected Changeset", async () => {
    const fixture = createFixture();
    try {
      const before = readBytes(fixture.root, [
        ".changeset/unselected-release.md",
        "apps/events/CHANGELOG.md",
        "apps/events/package.json",
        "apps/loops/CHANGELOG.md",
        "apps/loops/package.json",
      ]);

      const result = await applySelectiveChangesets({
        cwd: fixture.root,
        changesetIds: SELECTED_CHANGESET_IDS,
        packageAllowlist: PACKAGE_ALLOWLIST,
      });

      expect(result.mode).toBe("apply");
      expect(result.plannedPaths).toEqual(EXPECTED_PATHS);
      expect(result.touchedPaths).toEqual(EXPECTED_PATHS);
      for (const id of SELECTED_CHANGESET_IDS) {
        expect(existsSync(join(fixture.root, `.changeset/${id}.md`))).toBe(
          false,
        );
      }
      expectBytesUnchanged(fixture.root, before);

      expect(readManifest(fixture.root, "conversations").version).toBe("0.6.3");
      expect(readManifest(fixture.root, "todos").version).toBe("0.15.36");
      const projects = readManifest(fixture.root, "projects");
      expect(projects.version).toBe("0.1.133");
      expect(projects.dependencies?.["@hasna/conversations"]).toBe("0.6.3");
      expect(projects.dependencies?.["@hasna/todos"]).toBe("0.15.36");
      expect(readManifest(fixture.root, "events").version).toBe("0.1.15");
      expect(readManifest(fixture.root, "loops").version).toBe("0.5.1");
    } finally {
      fixture.cleanup();
    }
  });

  test("invalid selection fails before writing", async () => {
    const fixture = createFixture();
    try {
      const watchedPaths = [
        ".changeset/projects-conversations-prebound-adoption.md",
        "apps/conversations/package.json",
        "apps/projects/package.json",
      ];
      const before = readBytes(fixture.root, watchedPaths);

      try {
        await applySelectiveChangesets({
          cwd: fixture.root,
          changesetIds: ["projects-conversations-prebound-adoption"],
          packageAllowlist: ["@hasna/projects"],
        });
        throw new Error("expected selection validation to fail");
      } catch (error) {
        expect(error).toBeInstanceOf(SelectiveChangesetError);
        expect((error as SelectiveChangesetError).code).toBe(
          "SELECTION_OUTSIDE_ALLOWLIST",
        );
      }
      expectBytesUnchanged(fixture.root, before);
    } finally {
      fixture.cleanup();
    }
  });

  test("dependency closure outside the allowlist fails before writing", async () => {
    const fixture = createFixture();
    try {
      const projectsManifestPath = join(
        fixture.root,
        "apps/projects/package.json",
      );
      const projectsManifest = JSON.parse(
        readFileSync(projectsManifestPath, "utf8"),
      ) as { dependencies: Record<string, string> };
      projectsManifest.dependencies["@hasna/conversations"] = "0.6.2";
      writeFileSync(
        projectsManifestPath,
        `${JSON.stringify(projectsManifest, null, 2)}\n`,
      );
      const watchedPaths = [
        ".changeset/conversations-monorepo-first-release.md",
        "apps/conversations/package.json",
        "apps/projects/package.json",
      ];
      const before = readBytes(fixture.root, watchedPaths);

      try {
        await applySelectiveChangesets({
          cwd: fixture.root,
          changesetIds: ["conversations-monorepo-first-release"],
          packageAllowlist: ["@hasna/conversations"],
        });
        throw new Error("expected dependency closure validation to fail");
      } catch (error) {
        expect(error).toBeInstanceOf(SelectiveChangesetError);
        expect((error as SelectiveChangesetError).code).toBe(
          "CLOSURE_OUTSIDE_ALLOWLIST",
        );
      }
      expectBytesUnchanged(fixture.root, before);
    } finally {
      fixture.cleanup();
    }
  });

  test("selected-file preimage drift fails closed and preserves concurrent content", async () => {
    const fixture = createFixture();
    try {
      configureConcurrentChangelog(fixture.root);
      const unaffectedPaths = EXPECTED_PATHS.filter(
        (path) => path !== "apps/conversations/package.json",
      );
      const before = readBytes(fixture.root, unaffectedPaths);

      try {
        await applySelectiveChangesets({
          cwd: fixture.root,
          changesetIds: SELECTED_CHANGESET_IDS,
          packageAllowlist: PACKAGE_ALLOWLIST,
        });
        throw new Error("expected selected-file preimage drift to fail");
      } catch (error) {
        expect(error).toBeInstanceOf(SelectiveChangesetError);
        expect((error as SelectiveChangesetError).code).toBe(
          "APPLY_INVARIANT_FAILED",
        );
      }

      expectBytesUnchanged(fixture.root, before);
      const conversations = JSON.parse(
        readFileSync(
          join(fixture.root, "apps/conversations/package.json"),
          "utf8",
        ),
      ) as { version: string; concurrentMarker?: string };
      expect(conversations.version).toBe("0.6.2");
      expect(conversations.concurrentMarker).toBe("must-survive");
      for (const id of SELECTED_CHANGESET_IDS) {
        expect(existsSync(join(fixture.root, `.changeset/${id}.md`))).toBe(true);
      }
    } finally {
      fixture.cleanup();
    }
  });

  test("CLI apply detects a selected changelog write failure, commits nothing, and replays cleanly", () => {
    const fixture = createFixture();
    try {
      const changelogPath = join(
        fixture.root,
        "apps/conversations/CHANGELOG.md",
      );
      chmodSync(changelogPath, 0o444);
      const before = readBytes(fixture.root, EXPECTED_PATHS);

      const result = Bun.spawnSync(changesetsCandidateCliArgs(fixture.root, true), {
        cwd: REPO_ROOT,
        stdout: "pipe",
        stderr: "pipe",
      });

      expect(result.exitCode).toBe(1);
      const report = JSON.parse(result.stdout.toString()) as {
        code?: string;
        touchedPaths?: string[];
      };
      expect(report.code).toBe("APPLY_INVARIANT_FAILED");
      expect(report.touchedPaths).toBeUndefined();
      expectBytesUnchanged(fixture.root, before);
      for (const id of SELECTED_CHANGESET_IDS) {
        expect(existsSync(join(fixture.root, `.changeset/${id}.md`))).toBe(true);
      }

      chmodSync(changelogPath, 0o644);
      const replay = Bun.spawnSync(
        changesetsCandidateCliArgs(fixture.root, true),
        {
          cwd: REPO_ROOT,
          stdout: "pipe",
          stderr: "pipe",
        },
      );
      expect(replay.exitCode).toBe(0);
      const replayReport = JSON.parse(replay.stdout.toString()) as {
        mode: string;
        touchedPaths: string[];
      };
      expect(replayReport.mode).toBe("apply");
      expect(replayReport.touchedPaths).toEqual(EXPECTED_PATHS);
    } finally {
      fixture.cleanup();
    }
  });

  test("CLI defaults to dry-run and emits the same 13-path candidate", () => {
    const fixture = createFixture();
    try {
      const result = Bun.spawnSync(changesetsCandidateCliArgs(fixture.root), {
        cwd: REPO_ROOT,
        stdout: "pipe",
        stderr: "pipe",
      });

      expect(result.exitCode).toBe(0);
      const report = JSON.parse(result.stdout.toString()) as {
        mode: string;
        plannedPaths: string[];
        touchedPaths: string[];
      };
      expect(report.mode).toBe("dry-run");
      expect(report.plannedPaths).toEqual(EXPECTED_PATHS);
      expect(report.touchedPaths).toEqual([]);
      expect(
        existsSync(
          join(
            fixture.root,
            ".changeset/conversations-monorepo-first-release.md",
          ),
        ),
      ).toBe(true);
    } finally {
      fixture.cleanup();
    }
  });

  test("CLI --apply uses the same explicit selection and touches the same 13 paths", () => {
    const fixture = createFixture();
    try {
      const result = Bun.spawnSync(changesetsCandidateCliArgs(fixture.root, true), {
        cwd: REPO_ROOT,
        stdout: "pipe",
        stderr: "pipe",
      });

      expect(result.exitCode).toBe(0);
      const report = JSON.parse(result.stdout.toString()) as {
        mode: string;
        plannedPaths: string[];
        touchedPaths: string[];
      };
      expect(report.mode).toBe("apply");
      expect(report.plannedPaths).toEqual(EXPECTED_PATHS);
      expect(report.touchedPaths).toEqual(EXPECTED_PATHS);
      expect(readManifest(fixture.root, "conversations").version).toBe("0.6.3");
      expect(readManifest(fixture.root, "todos").version).toBe("0.15.36");
      expect(readManifest(fixture.root, "projects").version).toBe("0.1.133");
    } finally {
      fixture.cleanup();
    }
  });

  test("CLI --apply resolves the configured changelog when the target has no node_modules", () => {
    const fixture = createFixture({ linkNodeModules: false });
    try {
      const before = readBytes(fixture.root, [
        ".changeset/unselected-release.md",
        "apps/events/CHANGELOG.md",
        "apps/events/package.json",
        "apps/loops/CHANGELOG.md",
        "apps/loops/package.json",
        "bun.lock",
        "package.json",
      ]);

      const result = Bun.spawnSync(
        changesetsCandidateCliArgs(fixture.root, true),
        {
          cwd: REPO_ROOT,
          stdout: "pipe",
          stderr: "pipe",
        },
      );

      if (result.exitCode !== 0) {
        throw new Error(result.stdout.toString());
      }
      expect(result.exitCode).toBe(0);
      const report = JSON.parse(result.stdout.toString()) as {
        mode: string;
        plannedPaths: string[];
        touchedPaths: string[];
      };
      expect(report.mode).toBe("apply");
      expect(report.plannedPaths).toEqual(EXPECTED_PATHS);
      expect(report.touchedPaths).toEqual(EXPECTED_PATHS);
      expectBytesUnchanged(fixture.root, before);
    } finally {
      fixture.cleanup();
    }
  });
});
