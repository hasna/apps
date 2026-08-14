import { describe, test, expect } from "bun:test";
import { homedir } from "os";
import { join } from "path";
import { evaluate, resolveAllowedOrgs } from "./hook";

const HOME = homedir();
const REPOS = join(HOME, "workspace", "repos");

function preToolUse(tool_name: string, tool_input: Record<string, unknown>, cwd = join(REPOS, "hasna", "apps")) {
  return { hook_event_name: "PreToolUse", tool_name, tool_input, cwd };
}

function isBlocked(result: { output: { decision?: string; reason?: string } }): string | null {
  if (result.output.decision === "block") return result.output.reason ?? "blocked";
  return null;
}

describe("hook-workspace-repos-guard", () => {
  describe("resolveAllowedOrgs", () => {
    test("defaults to the four canonical GitHub orgs", () => {
      expect([...resolveAllowedOrgs({})].sort()).toEqual(["hasna", "hasna-internal", "hasna-products", "hasnaxyz"]);
    });

    test("parses comma-separated env override, trimming whitespace and empties", () => {
      expect([...resolveAllowedOrgs({ WORKSPACE_REPOS_GUARD_ORGS: " hasna ,  myorg ,, " })].sort()).toEqual(["hasna", "myorg"]);
    });
  });

  describe("positive controls — must continue", () => {
    test("Write deep inside an allowed org checkout continues", () => {
      const result = evaluate(preToolUse("Write", { file_path: join(REPOS, "hasna", "apps", "apps", "foo", "src", "index.ts") }));
      expect(result.output.continue).toBe(true);
      expect(isBlocked(result)).toBeNull();
    });

    test("Edit inside hasna-internal org continues", () => {
      const result = evaluate(preToolUse("Edit", { file_path: join(REPOS, "hasna-internal", "platform", "docs", "readme.md") }));
      expect(result.output.continue).toBe(true);
    });

    test("MultiEdit with relative file_path resolves against cwd and continues inside allowed org", () => {
      const result = evaluate(preToolUse("MultiEdit", { file_path: "apps/hooks/src/lib/registry.ts" }));
      expect(result.output.continue).toBe(true);
    });

    test("NotebookEdit inside allowed org continues", () => {
      const result = evaluate(preToolUse("NotebookEdit", { notebook_path: join(REPOS, "hasnaxyz", "iapp-probe", "probe.ipynb") }));
      expect(result.output.continue).toBe(true);
    });

    test("Bash read commands under repos are never blocked", () => {
      const reads = [
        `ls ${REPOS}`,
        `cat ${join(REPOS, "hasna", "apps", "README.md")}`,
        `git -C ${join(REPOS, "hasna", "apps")} status`,
        `cd ${REPOS} && git pull`,
        `find ${join(REPOS, "hasna")} -name AGENTS.md`,
      ];
      for (const command of reads) {
        const result = evaluate(preToolUse("Bash", { command }));
        expect(result.output.continue).toBe(true);
      }
    });

    test("Bash write deep inside an allowed org checkout continues", () => {
      const commands = [
        `echo note > ${join(REPOS, "hasna", "apps", "scratch.md")}`,
        `touch ${join(REPOS, "hasna", "apps", "apps", "foo", "x.txt")}`,
        `git clone https://github.com/hasna/foo.git ${join(REPOS, "hasna", "foo")}`,
        `mkdir -p ${join(REPOS, "hasna-internal", "platform", "apps")}`,
      ];
      for (const command of commands) {
        const result = evaluate(preToolUse("Bash", { command }));
        expect(result.output.continue).toBe(true);
      }
    });

    test("non-PreToolUse events and non-file tools are ignored", () => {
      const result = evaluate({ hook_event_name: "PostToolUse", tool_name: "Write", tool_input: { file_path: join(REPOS, "hasna", "x.ts") } });
      expect(result.output.continue).toBe(true);
      const read = evaluate(preToolUse("Read", { file_path: join(REPOS, "hasna", "apps", "README.md") }));
      expect(read.output.continue).toBe(true);
    });
  });

  describe("negative controls — must block", () => {
    test("Write to ~/workspace/repos itself is blocked", () => {
      const result = evaluate(preToolUse("Write", { file_path: join(REPOS, "stray.txt") }));
      const reason = isBlocked(result);
      expect(reason).not.toBeNull();
      expect(reason).toContain("workspace-repos-guard");
    });

    test("Write to the repos root directory entry is blocked", () => {
      const result = evaluate(preToolUse("Edit", { file_path: REPOS }));
      expect(isBlocked(result)).not.toBeNull();
    });

    test("Write whose second segment is not an allowed org is blocked", () => {
      const result = evaluate(preToolUse("Write", { file_path: join(REPOS, "notanorg", "x", "file.ts") }));
      const reason = isBlocked(result);
      expect(reason).not.toBeNull();
      expect(reason).toContain("notanorg");
    });

    test("Write creating a top-level entry under repos (org-level, no deeper path) is blocked", () => {
      const result = evaluate(preToolUse("Write", { file_path: join(REPOS, "hasna") }));
      expect(isBlocked(result)).not.toBeNull();
    });

    test("rm -rf deep inside an allowed org checkout is blocked", () => {
      const result = evaluate(preToolUse("Bash", { command: `rm -rf ${join(REPOS, "hasna", "apps", ".git")}` }));
      const reason = isBlocked(result);
      expect(reason).not.toBeNull();
      expect(reason).toContain("delete");
    });

    test("rmdir of an org folder is blocked", () => {
      const result = evaluate(preToolUse("Bash", { command: `rmdir ${join(REPOS, "oldorg")}` }));
      expect(isBlocked(result)).not.toBeNull();
    });

    test("git clean inside a checkout is blocked", () => {
      const result = evaluate(preToolUse("Bash", { command: `git -C ${join(REPOS, "hasna", "apps")} clean -fd` }));
      expect(isBlocked(result)).not.toBeNull();
    });

    test("rm -rf of the repos root itself is blocked", () => {
      const result = evaluate(preToolUse("Bash", { command: `rm -rf ${REPOS}` }));
      expect(isBlocked(result)).not.toBeNull();
    });

    test("cd into repos followed by rm -rf . is blocked via relative resolution", () => {
      const result = evaluate(preToolUse("Bash", { command: `cd ${REPOS} && rm -rf .` }));
      expect(isBlocked(result)).not.toBeNull();
    });

    test("top-level non-org folder creation via Bash is blocked", () => {
      const commands = [
        `mkdir -p ${join(REPOS, "notanorg")}`,
        `mkdir -p ${join(REPOS, "notanorg", "sub")}`,
        `touch ${join(REPOS, "neworg", "x")}`,
        `mv ${join(REPOS, "hasna", "apps", "a")} ${join(REPOS, "anotherorg")}`,
      ];
      for (const command of commands) {
        const result = evaluate(preToolUse("Bash", { command }));
        expect(isBlocked(result)).not.toBeNull();
      }
    });

    test("Bash write into a non-allowed org folder is blocked", () => {
      const result = evaluate(preToolUse("Bash", { command: `echo x > ${join(REPOS, "notanorg", "deep", "f.ts")}` }));
      const reason = isBlocked(result);
      expect(reason).not.toBeNull();
      expect(reason).toContain("notanorg");
    });

    test("delete via git rm is blocked", () => {
      const result = evaluate(preToolUse("Bash", { command: `git -C ${join(REPOS, "hasna", "apps")} rm src/foo.ts` }));
      expect(isBlocked(result)).not.toBeNull();
    });
  });

  describe("orgs env override", () => {
    test("override widens and narrows the allowed set", () => {
      const previous = process.env.WORKSPACE_REPOS_GUARD_ORGS;
      try {
        process.env.WORKSPACE_REPOS_GUARD_ORGS = "hasna,myorg";
        const allowed = evaluate(preToolUse("Write", { file_path: join(REPOS, "myorg", "proj", "f.ts") }));
        expect(allowed.output.continue).toBe(true);
        const narrowed = evaluate(preToolUse("Write", { file_path: join(REPOS, "hasnaxyz", "iapp-x", "f.ts") }));
        expect(isBlocked(narrowed)).not.toBeNull();
      } finally {
        if (previous === undefined) delete process.env.WORKSPACE_REPOS_GUARD_ORGS;
        else process.env.WORKSPACE_REPOS_GUARD_ORGS = previous;
      }
    });
  });
});
