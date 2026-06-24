import { mkdirSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, test } from "bun:test";
import {
  createMultiRepoLoopPlan,
  discoverOpenRepos,
  renderRepoTemplate,
  type OpenReposSdk,
} from "./open-repos.js";

function repoFixture(root: string, name: string, packageName: string): string {
  const path = join(root, name);
  mkdirSync(path, { recursive: true });
  writeFileSync(join(path, "package.json"), JSON.stringify({ name: packageName }));
  writeFileSync(join(path, "tsconfig.json"), "{}");
  return path;
}

describe("open-repos integration", () => {
  test("selects repos by org, package scope, language, path, and tag", async () => {
    const root = join(tmpdir(), `open-repos-selector-${Date.now()}-${Math.random().toString(16).slice(2)}`);
    const selected = repoFixture(root, "open-one", "@hasna/open-one");
    const skipped = repoFixture(root, "other", "@other/other");
    const sdk: OpenReposSdk = {
      listRepos: () => [
        { id: 1, name: "open-one", path: selected, org: "hasna", default_branch: "main", tags: ["daily"] },
        { id: 2, name: "other", path: skipped, org: "other", default_branch: "main", tags: ["daily"] },
      ],
    };

    const result = await discoverOpenRepos(
      {
        orgs: ["hasna"],
        packageScopes: ["@hasna"],
        languages: ["TypeScript"],
        paths: [root],
        tags: ["daily"],
      },
      { sdk },
    );

    expect(result.repos).toHaveLength(1);
    expect(result.repos[0]?.name).toBe("open-one");
    expect(result.repos[0]?.packageScope).toBe("@hasna");
    expect(result.repos[0]?.language).toBe("TypeScript");
    expect(result.warnings.join("\n")).toContain("package-scope");
  });

  test("applies limit after selector filtering", async () => {
    const root = join(tmpdir(), `open-repos-limit-${Date.now()}-${Math.random().toString(16).slice(2)}`);
    const skipped = repoFixture(root, "skipped", "@other/skipped");
    const selected = repoFixture(root, "selected", "@hasna/selected");
    const rows = [
      { id: 1, name: "skipped", path: skipped, org: "other", default_branch: "main" },
      { id: 2, name: "selected", path: selected, org: "hasna", default_branch: "main" },
    ];
    const sdk: OpenReposSdk = {
      listRepos: ({ limit = 50, offset = 0 } = {}) => rows.slice(offset, offset + limit),
    };

    const result = await discoverOpenRepos({ orgs: ["hasna"], limit: 1 }, { sdk });

    expect(result.repos).toHaveLength(1);
    expect(result.repos[0]?.name).toBe("selected");
  });

  test("builds sequential-by-default loop inputs with repo metadata", () => {
    const repo = {
      id: "1",
      numericId: 1,
      name: "open-one",
      fullName: "hasna/open-one",
      path: "/workspace/open-one",
      org: "hasna",
      remoteUrl: "https://github.com/hasna/open-one.git",
      defaultBranch: "main",
      language: "TypeScript",
      packageName: "@hasna/open-one",
      packageScope: "@hasna",
      tags: ["daily"],
    };

    const plan = createMultiRepoLoopPlan({
      group: "daily",
      kind: "command",
      repos: [repo],
      schedule: { type: "interval", everyMs: 3_600_000 },
      targetForRepo: (_repo, env) => ({
        type: "command",
        command: "printf ok",
        cwd: env.OPENLOOPS_REPO_PATH,
        env,
      }),
    });

    expect(plan.maxConcurrency).toBe(1);
    expect(plan.memoryLimitMb).toBe(2048);
    expect(plan.scheduling.defaultSequential).toBe(true);
    expect(plan.loops[0]?.input.name).toBe("repo:command:daily:open-one");
    expect(plan.loops[0]?.input.metadata?.openReposGroup).toBe("daily");
    expect(plan.loops[0]?.input.metadata?.openReposMaxConcurrency).toBe(1);
    expect(plan.loops[0]?.env.OPENLOOPS_REPO_PATH).toBe("/workspace/open-one");
  });

  test("renders repo templates for names and prompts", () => {
    const repo = {
      id: "repo",
      name: "open loops",
      fullName: "hasna/open loops",
      path: "/workspace/open loops",
      org: "hasna",
      tags: [],
    };
    const ctx = { group: "daily work", kind: "agent" as const, repo, maxConcurrency: 1, memoryLimitMb: 2048 };
    expect(renderRepoTemplate("repo:{kind}:{group}:{repo}", ctx, { sanitize: true })).toBe("repo:agent:daily-work:open-loops");
    expect(renderRepoTemplate("Review {fullName} at {repoPath}", ctx)).toBe("Review hasna/open loops at /workspace/open loops");
  });
});
