import { describe, test, expect } from "bun:test";
import { homedir } from "os";
import { join } from "path";
import { evaluate, resolveAllowedOrgs } from "./hook";

const HOME = homedir();
const REPOS = join(HOME, ".hasna", "repos", "clones");

function preToolUse(tool_name: string, tool_input: Record<string, unknown>, cwd = join(REPOS, "hasna", "apps")) {
  return { hook_event_name: "PreToolUse", tool_name, tool_input, cwd };
}

function isBlocked(result: { output: { decision?: string; reason?: string } }): string | null {
  if (result.output.decision === "block") return result.output.reason ?? "blocked";
  return null;
}describe("hook-workspace-repos-guard", () => {
  describe("resolveAllowedOrgs", () => {
    test("defaults to the three public canonical GitHub orgs", () => {
      expect([...resolveAllowedOrgs({})].sort()).toEqual(["hasna", "hasna-products", "hasnaxyz"]);
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

    test("Edit inside a non-default org is blocked", () => {
      const result = evaluate(preToolUse("Edit", { file_path: join(REPOS, "notanorg", "platform", "docs", "readme.md") }));
      expect(isBlocked(result)).not.toBeNull();
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
        `mkdir -p ${join(REPOS, "hasnaxyz", "iapp-probe", "docs")}`,
      ];
      for (const command of commands) {
        const result = evaluate(preToolUse("Bash", { command }));
        expect(result.output.continue).toBe(true);
      }
    });

    test("tilde/$HOME spellings of deep allowed-org writes continue", () => {
      const commands = [
        `touch ~/.hasna/repos/clones/hasna/apps/foo.md`,
        `echo x > ~/.hasna/repos/clones/hasnaxyz/iapp-probe/notes.md`,
        `mkdir -p "${HOME}/.hasna/repos/clones/hasnaxyz/iapp-probe/notes"`,
        `touch "$HOME"/.hasna/repos/clones/hasna/apps/x.txt`,
        `echo x > "\${HOME}"/.hasna/repos/clones/hasnaxyz/iapp-probe/notes.md`,
      ];
      for (const command of commands) {
        const result = evaluate(preToolUse("Bash", { command }));
        expect(result.output.continue).toBe(true);
      }
    });

    test("file-tool tilde/$HOME paths deep inside an allowed org continue", () => {
      const results = [
        evaluate(preToolUse("Write", { file_path: `~/.hasna/repos/clones/hasna/apps/src/x.ts` })),
        evaluate(preToolUse("Edit", { file_path: `$HOME/.hasna/repos/clones/hasnaxyz/iapp-probe/n.ipynb` })),
        evaluate(preToolUse("Write", { file_path: `"${HOME}/.hasna/repos/clones/hasna/apps/notes.md"` })),
        evaluate(preToolUse("Write", { file_path: `"$HOME"/.hasna/repos/clones/hasna/apps/notes2.md` })),
      ];
      for (const result of results) {
        expect(result.output.continue).toBe(true);
      }
    });

    test("apply_patch Add/Update File deep inside an allowed org continues", () => {
      const result = evaluate(
        preToolUse("apply_patch", {
          patch: `*** Begin Patch\n*** Add File: apps/hooks/src/lib/registry.ts\n+export const x = 1;\n*** End Patch`,
        })
      );
      expect(result.output.continue).toBe(true);
    });

    test("non-mutating sed without -i, and interpreter without a path, continue", () => {
      const commands = [
        `sed 's/a/b/' ${join(REPOS, "hasna", "apps", "README.md")}`,
        `node -e "console.log('no path here')"`,
        `python3 -c "print('no path here')"`,
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
    test("Write to ~/.hasna/repos/clones itself is blocked", () => {
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

    test("tilde/$HOME spellings of the protected path are blocked", () => {
      const commands = [
        `rm -rf ~/.hasna/repos/clones`,
        `rm -rf ~/.hasna/repos/clones/hasna/apps`,
        `rm -rf $HOME/.hasna/repos/clones/hasna`,
        `rm -rf "${HOME}/.hasna/repos/clones"`,
        `rm -rf "$HOME"/.hasna/repos/clones`,
        `rm -rf "$HOME"/.hasna/repos/clones/hasna/apps`,
        `rm -rf "\${HOME}"/.hasna/repos/clones/hasna`,
        `rm -rf "${HOME}"/.hasna/repos/clones/hasna`,
        `touch ~/.hasna/repos/clones/stray.txt`,
        `mkdir -p ~/.hasna/repos/clones/notanorg`,
        `echo x > ~/.hasna/repos/clones/notanorg/f.ts`,
        `mv /tmp/x ~/.hasna/repos/clones`,
        `truncate -s 0 ~/.hasna/repos/clones/stray.log`,
        `rsync -a /tmp/x ~/.hasna/repos/clones/`,
        `scp f.txt ~/.hasna/repos/clones/`,
      ];
      for (const command of commands) {
        const result = evaluate(preToolUse("Bash", { command }));
        expect(isBlocked(result), `expected BLOCK for: ${command}`).not.toBeNull();
      }
    });

    test("file-tool tilde/$HOME spellings are blocked", () => {
      const results = [
        evaluate(preToolUse("Write", { file_path: `~/.hasna/repos/clones/stray.txt` })),
        evaluate(preToolUse("Write", { file_path: `$HOME/.hasna/repos/clones/notanorg/f.ts` })),
        evaluate(preToolUse("Edit", { file_path: `~/.hasna/repos/clones/hasna` })),
        evaluate(preToolUse("Write", { file_path: `~/.hasna/repos/clones` })),
        evaluate(preToolUse("Write", { file_path: `"$HOME"/.hasna/repos/clones/stray.txt` })),
      ];
      for (const result of results) {
        expect(isBlocked(result)).not.toBeNull();
      }
    });

    test("subshell-grouped cd + rm is blocked", () => {
      const commands = [
        `(cd ~/.hasna/repos/clones && rm -rf hasna)`,
        `(cd ${REPOS} && rm -rf hasna)`,
        `( cd ${REPOS} && touch stray.txt )`,
      ];
      for (const command of commands) {
        const result = evaluate(preToolUse("Bash", { command }));
        expect(isBlocked(result), `expected BLOCK for: ${command}`).not.toBeNull();
      }
    });

    test("cwd-relative deletes without an explicit cd are blocked", () => {
      const fromCheckout = evaluate(preToolUse("Bash", { command: `rm -rf ../` }, join(REPOS, "hasna", "apps")));
      expect(isBlocked(fromCheckout)).not.toBeNull();
      const fromRoot = evaluate(preToolUse("Bash", { command: `mkdir -p notanorg` }, REPOS));
      expect(isBlocked(fromRoot)).not.toBeNull();
      const bareRm = evaluate(preToolUse("Bash", { command: `rm -rf .` }, join(REPOS, "hasnaxyz")));
      expect(isBlocked(bareRm)).not.toBeNull();
    });

    test("mutating verbs writing under the protected root are blocked", () => {
      const commands = [
        `sed -i 's/x/y/' ~/.hasna/repos/clones/stray.txt`,
        `rsync -a ${join(REPOS, "hasna")} /tmp/out`,
        `scp -r ${join(REPOS, "hasna")} other:/tmp/`,
        `truncate -s 0 ${join(REPOS, "notanorg", "f.ts")}`,
        `python3 -c "open('~/.hasna/repos/clones/stray.txt','w')"`,
        `node -e "require('fs').writeFileSync('${join(REPOS, "notanorg", "f.ts")}','x')"`,
      ];
      for (const command of commands) {
        const result = evaluate(preToolUse("Bash", { command }));
        expect(isBlocked(result), `expected BLOCK for: ${command}`).not.toBeNull();
      }
    });

    test("apply_patch Delete File and shallow Add File are blocked", () => {
      const del = evaluate(
        preToolUse("ApplyPatch", {
          patch: `*** Begin Patch\n*** Delete File: src/foo.ts\n*** End Patch`,
        })
      );
      expect(isBlocked(del)).not.toBeNull();
      const shallow = evaluate(
        preToolUse("functions.apply_patch", {
          patch: `*** Begin Patch\n*** Add File: ../../stray.txt\n+x\n*** End Patch`,
        })
      );
      expect(isBlocked(shallow)).not.toBeNull();
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
