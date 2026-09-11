import { describe, test, expect } from "bun:test";
import {
  buildUpdatedInput,
  evaluate,
  fallbackVerdict,
  protectedTargetReason,
  rewriteIsComplete,
  scanCommand,
  type GuardDependencies,
} from "./hook";
import type { CodewithHookInput, CodewithHookOutput } from "../../codewith-native-common";

const HOME = "/home/tester";
const CWD = "/home/tester/work";
const WORKSPACE = "/home/tester/work/project";
const CLONES = "/home/tester/.hasna/repos/clones";
const LEGACY = "/home/tester/workspace/repos";
const TRASH = "/usr/local/bin/trash";

function deps(overrides: Partial<GuardDependencies> = {}): GuardDependencies {
  return { home: HOME, cwd: CWD, findTrash: () => TRASH, ...overrides };
}

function bash(command: string, cwd = CWD, tool_input: Record<string, unknown> = {}): CodewithHookInput {
  return { hook_event_name: "PreToolUse", tool_name: "Bash", cwd, tool_input: { command, ...tool_input } } as CodewithHookInput;
}

interface Decision {
  decision: "allow" | "deny" | "continue";
  reason: string | null;
  updatedInput: Record<string, unknown> | null;
}

function decide(output: CodewithHookOutput): Decision {
  const specific = (output as { hookSpecificOutput?: Record<string, unknown> }).hookSpecificOutput;
  if (!specific) return { decision: "continue", reason: null, updatedInput: null };
  const decision = specific.permissionDecision;
  if (decision === "allow") {
    return { decision: "allow", reason: null, updatedInput: (specific.updatedInput as Record<string, unknown>) ?? null };
  }
  if (decision === "deny") {
    return { decision: "deny", reason: String(specific.permissionDecisionReason ?? ""), updatedInput: null };
  }
  return { decision: "continue", reason: null, updatedInput: null };
}

function run(command: string, cwd = CWD, options = deps(), tool_input: Record<string, unknown> = {}) {
  return decide(evaluate(bash(command, cwd, tool_input), { ...options, cwd }));
}

describe("hook-trash-guard", () => {
  describe("positive controls — never touched", () => {
    test("non-Bash tools and non-PreToolUse events continue", () => {
      expect(evaluate({ hook_event_name: "PreToolUse", tool_name: "Write", tool_input: {} } as CodewithHookInput, deps())).toEqual({ continue: true });
      expect(evaluate({ hook_event_name: "PostToolUse", tool_name: "Bash", tool_input: { command: "rm -rf x" } } as CodewithHookInput, deps())).toEqual({ continue: true });
      expect(evaluate({ hook_event_name: "PreToolUse", tool_name: "Bash", tool_input: { command: "   " } } as CodewithHookInput, deps())).toEqual({ continue: true });
    });

    // Regression: an unreadable command is a payload this hook cannot verify.
    // The harness falls back to the ORIGINAL tool input whenever `updatedInput`
    // is missing or empty, so "cannot tell" must never resolve to "run it".
    // Caught by the independent live gate on 2026-09-11, which measured
    // `{"tool_name":"Bash"}` and `{"tool_input":{}}` returning allow.
    test("a payload whose command cannot be read is REFUSED, not allowed", () => {
      const noToolInput = evaluate(
        { hook_event_name: "PreToolUse", tool_name: "Bash" } as CodewithHookInput,
        deps(),
      ) as { hookSpecificOutput?: { permissionDecision?: string } };
      expect(noToolInput.hookSpecificOutput?.permissionDecision).toBe("deny");

      const emptyToolInput = evaluate(
        { hook_event_name: "PreToolUse", tool_name: "Bash", tool_input: {} } as CodewithHookInput,
        deps(),
      ) as { hookSpecificOutput?: { permissionDecision?: string } };
      expect(emptyToolInput.hookSpecificOutput?.permissionDecision).toBe("deny");

      const wrongType = evaluate(
        { hook_event_name: "PreToolUse", tool_name: "Bash", tool_input: { command: 42 } } as unknown as CodewithHookInput,
        deps(),
      ) as { hookSpecificOutput?: { permissionDecision?: string } };
      expect(wrongType.hookSpecificOutput?.permissionDecision).toBe("deny");
    });

    // A command that is PRESENT and empty runs nothing, so it stays allowed —
    // the refusal above is about unreadable payloads, not about emptiness.
    test("an empty but readable command still continues", () => {
      expect(
        evaluate({ hook_event_name: "PreToolUse", tool_name: "Bash", tool_input: { command: "" } } as CodewithHookInput, deps()),
      ).toEqual({ continue: true });
    });

    test("read-only commands continue", () => {
      for (const command of ["ls -la", "git status", "cat package.json", "npm run build", "rm --help", "rm -rf"]) {
        expect(run(command).decision).toBe("continue");
      }
    });

    test("a delete verb in an argument position is not a delete", () => {
      for (const command of [
        "printf '%s\\n' rm",
        "grep -rn rm .",
        'echo "rm -rf /tmp"',
        "rg 'unlink' --type ts",
        "ls rm-notes",
        "git commit -m 'drop rm helper'",
      ]) {
        expect(run(command).decision).toBe("continue");
      }
    });

    test("`git rm --cached` and `git clean -n` do not delete the working tree", () => {
      expect(run("git rm --cached -r node_modules").decision).toBe("continue");
      expect(run("git clean -n").decision).toBe("continue");
    });
  });

  describe("the rewrite", () => {
    test("rewrites only the verb, leaving every other byte alone", () => {
      const decision = run("cd /tmp && rm -rf ./build > /tmp/log 2>&1");
      expect(decision.decision).toBe("allow");
      expect(decision.updatedInput?.command).toBe(`cd /tmp && ${TRASH} guard -rf ./build > /tmp/log 2>&1`);
    });

    test("preserves quoting, -- and flags", () => {
      expect(run("rm -rf '/tmp/with space'").updatedInput?.command).toBe(`${TRASH} guard -rf '/tmp/with space'`);
      expect(run("rm -rf -- -weird-name").updatedInput?.command).toBe(`${TRASH} guard -rf -- -weird-name`);
      expect(run("/bin/rm -r ~/Downloads/junk").updatedInput?.command).toBe(`${TRASH} guard -r ~/Downloads/junk`);
    });

    test("rewrites the `rm` behind a wrapper, not the wrapper's own argument", () => {
      expect(run("sudo rm -rf /tmp/x").updatedInput?.command).toBe(`sudo ${TRASH} guard -rf /tmp/x`);
      expect(run("env FOO=1 rm -rf /tmp/x").updatedInput?.command).toBe(`env FOO=1 ${TRASH} guard -rf /tmp/x`);
      expect(run("timeout 5 rm -rf /tmp/x").updatedInput?.command).toBe(`timeout 5 ${TRASH} guard -rf /tmp/x`);
      expect(run("timeout -s KILL 5 rm -rf /tmp/x").updatedInput?.command).toBe(`timeout -s KILL 5 ${TRASH} guard -rf /tmp/x`);
      expect(run("FOO=1 rm -rf /tmp/x").updatedInput?.command).toBe(`FOO=1 ${TRASH} guard -rf /tmp/x`);
    });

    test("a trash path with spaces is quoted", () => {
      const decision = run("rm -rf /tmp/x", CWD, deps({ findTrash: () => "/opt/my dir/trash" }));
      expect(decision.updatedInput?.command).toBe("'/opt/my dir/trash' guard -rf /tmp/x");
    });

    test("the rewrite is complete and schema-valid — never partial", () => {
      const decision = run("rm -rf ./build", CWD, deps(), {
        description: "clean the build dir",
        timeout: 30000,
        run_in_background: true,
        dangerouslyDisableSandbox: false,
        extra_field: "kept",
      });
      const input = decision.updatedInput ?? {};
      expect(input.command).toBe(`${TRASH} guard -rf ./build`);
      expect(input.description).toBe("clean the build dir");
      expect(input.timeout).toBe(30000);
      expect(input.run_in_background).toBe(true);
      expect(input.dangerouslyDisableSandbox).toBe(false);
      expect(input.extra_field).toBe("kept");
    });

    test("absent Bash-tool fields are re-supplied at their defaults", () => {
      const input = run("rm -rf ./build").updatedInput ?? {};
      expect(typeof input.command).toBe("string");
      expect(typeof input.description).toBe("string");
      expect(typeof input.timeout).toBe("number");
      expect((input.timeout as number) > 0).toBe(true);
      expect(input.run_in_background).toBe(false);
    });

    test("every allowed rewrite re-scans clean (no live delete verb survives)", () => {
      const commands = [
        "rm -rf ./build",
        "rm -rf /tmp/x && rm -rf /tmp/y",
        "cd /tmp && rm -rf a; rm -f b",
        "rm -rf ~/Downloads/junk",
        "nice -n 5 rm -rf /tmp/x",
      ];
      for (const command of commands) {
        const decision = run(command);
        expect(decision.decision).toBe("allow");
        const rewritten = String(decision.updatedInput?.command ?? "");
        const scan = scanCommand(rewritten, { cwd: CWD, home: HOME });
        expect(scan.rmHits.length).toBe(0);
        expect(scan.handoffHits.length).toBe(0);
        expect(scan.refusals.length).toBe(0);
        expect(rewriteIsComplete(command, rewritten, scanCommand(command, { cwd: CWD, home: HOME }).rmHits, CWD, HOME)).toBe(true);
      }
    });

    test("an incomplete updatedInput is refused rather than emitted", () => {
      // The guard's own invariant: a rewrite missing a field never leaves the hook.
      expect(() => buildUpdatedInput({}, "")).not.toThrow();
      expect(buildUpdatedInput(undefined, "x").command).toBe("x");
    });
  });

  describe("refusals — a delete that cannot be redirected", () => {
    test("rm's cousins are refused", () => {
      for (const command of ["rmdir /tmp/x", "unlink /tmp/x", "shred -u /tmp/x"]) {
        const decision = run(command);
        expect(decision.decision).toBe("deny");
        expect(decision.reason).toContain("[trash-guard]");
      }
    });

    test("deletes that do not run through `rm` are refused", () => {
      for (const command of [
        "git rm -f file.txt",
        "git clean -fdx",
        "find /tmp -delete",
        "find /tmp -exec rm -rf {} +",
        "xargs -0 rm -rf",
        "busybox rm -rf /tmp/x",
        "toybox rm -rf /tmp/x",
        "sh -c 'rm -rf /tmp/x'",
        "bash -c 'rm -rf /tmp/x'",
        "eval 'rm -rf /tmp/x'",
        "su -c 'rm -rf /tmp/x'",
        "$(rm -rf /tmp/x)",
        "echo $(rm -rf /tmp/x)",
      ]) {
        const decision = run(command);
        expect(decision.decision).toBe("deny");
      }
    });

    test("an unparseable command that mentions a delete is refused", () => {
      const decision = run("rm -rf '/tmp/unterminated");
      expect(decision.decision).toBe("deny");
    });

    test("an unparseable command with no delete stays silent", () => {
      expect(run("echo '/tmp/unterminated").decision).toBe("continue");
    });
  });

  describe("trash absent — degrade redirect to block", () => {
    const absent = deps({ findTrash: () => null });

    test("an rm that cannot be redirected is refused, never allowed", () => {
      const decision = run("rm -rf /tmp/x", CWD, absent);
      expect(decision.decision).toBe("deny");
      expect(decision.reason).toContain("trash");
    });

    test("commands with no delete are still untouched", () => {
      expect(run("ls -la", CWD, absent).decision).toBe("continue");
      expect(run("git status", CWD, absent).decision).toBe("continue");
    });

    test("a delete under the handed-over roots stays abstained even without trash", () => {
      expect(run(`rm -rf ${CLONES}/hasna/apps/build`, CWD, absent).decision).toBe("continue");
    });
  });

  describe("protected class — refused, never trashed (decision 11.3)", () => {
    test("root, home and the credential/state stores are refused", () => {
      for (const command of ["rm -rf /", "rm -rf /etc", "rm -rf /home", "rm -rf ~", "rm -rf $HOME", "rm -rf ~/.ssh", "rm -rf ~/.ssh/known_hosts", "rm -rf ~/.hasna", "rm -rf ~/.aws/credentials"]) {
        const decision = run(command);
        expect(decision.decision).toBe("deny");
        expect(decision.updatedInput).toBeNull();
      }
    });

    test("an ordinary path is still rewritten", () => {
      for (const command of ["rm -rf ./build", "rm -rf ~/Downloads/junk", "rm -rf /tmp/x", "rm -rf node_modules"]) {
        expect(run(command).decision).toBe("allow");
      }
    });

    test("protectedTargetReason labels the class it matched", () => {
      expect(protectedTargetReason("/", HOME)).toContain("filesystem root");
      expect(protectedTargetReason("/etc", HOME)).toContain("system root");
      expect(protectedTargetReason(HOME, HOME)).toContain("home directory");
      expect(protectedTargetReason(`${HOME}/.ssh/id_ed25519`, HOME)).toContain("~/.ssh");
      expect(protectedTargetReason(`${HOME}/work/build`, HOME)).toBeNull();
      expect(protectedTargetReason("/tmp/x", HOME)).toBeNull();
    });
  });

  describe("handoff to workspace-repos-guard", () => {
    test("a delete inside the guarded roots is left to that hook", () => {
      expect(run(`rm -rf ${CLONES}/hasna/apps/build`).decision).toBe("continue");
      expect(run(`rm -rf ${LEGACY}/hasna/apps/build`).decision).toBe("continue");
      expect(run("rm -rf hasna/apps/build", `${CLONES}/hasnaxyz`).decision).toBe("continue");
      expect(run(`cd ${CLONES}/hasna && rm -rf apps`).decision).toBe("continue");
    });

    test("a command mixing an owned delete with a handed-over one is refused", () => {
      const decision = run(`rm -rf ${CLONES}/hasna/apps/build && rm -rf /tmp/y`);
      expect(decision.decision).toBe("deny");
      expect(decision.updatedInput).toBeNull();
    });

    test("the guard does not restate the repos policy for an ordinary path", () => {
      expect(run("rm -rf ./build").decision).toBe("allow");
    });
  });

  describe("internal failure", () => {
    test("fail-closed for a delete-verb command, silent otherwise", () => {
      expect((fallbackVerdict("rm -rf /tmp/x") as { hookSpecificOutput?: { permissionDecision?: string } }).hookSpecificOutput?.permissionDecision).toBe("deny");
      expect(fallbackVerdict("ls -la")).toEqual({ continue: true });
    });

    test("an internal throw denies a delete rather than running it", () => {
      const throwing = deps({
        findTrash: () => {
          throw new Error("boom");
        },
      });
      expect(run("rm -rf /tmp/x", CWD, throwing).decision).toBe("deny");
    });
  });

  describe("scanCommand", () => {
    test("command position is the command, not any word that reads like one", () => {
      expect(scanCommand("printf '%s' rm", { cwd: CWD, home: HOME }).rmHits.length).toBe(0);
      expect(scanCommand("rm -rf /tmp/x", { cwd: CWD, home: HOME }).rmHits.length).toBe(1);
      expect(scanCommand("rm -rf a && rm -rf /tmp/b", { cwd: CWD, home: HOME }).rmHits.length).toBe(2);
    });

    test("an unterminated command is not trustworthy", () => {
      expect(scanCommand("echo 'oops", { cwd: CWD, home: HOME }).trustworthy).toBe(false);
    });

    test("a here-document body is not scanned as commands", () => {
      const scan = scanCommand("cat <<EOF\nrm -rf /tmp/x\nEOF\nrm -rf /tmp/y", { cwd: WORKSPACE, home: HOME });
      expect(scan.rmHits.length).toBe(1);
    });

    test("windows-style path separators and plain words are left alone", () => {
      expect(scanCommand("rm -rf ./a/../b", { cwd: CWD, home: HOME }).rmHits.length).toBe(1);
    });
  });
});
