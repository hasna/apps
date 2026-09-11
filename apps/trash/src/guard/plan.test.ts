/**
 * The decision layer's contract.
 *
 * Two properties are load-bearing and get their own tests throughout:
 *
 *   1. a rewrite is BYTE-EXACT except for the program token — every flag,
 *      every target, every quote survives untouched;
 *   2. a decision is all-or-nothing — one refused hit or one unenumerable
 *      target denies the WHOLE command, because a partial rewrite leaves a
 *      real `rm` running inside a command the guard claimed to cover.
 */

import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { join } from "node:path";
import { createSandbox, type Sandbox } from "../testing/sandbox.js";
import { guardPlanDocument, planGuardCommand, type PlanOptions } from "./plan.js";

let sandbox: Sandbox;

beforeEach(() => {
  sandbox = createSandbox();
});

afterEach(() => {
  sandbox.cleanup();
});

function options(overrides: Partial<PlanOptions> = {}): PlanOptions {
  return {
    spool: join(sandbox.root, "spool"),
    trashBin: "trash",
    home: sandbox.path("home"),
    cwd: sandbox.root,
    ...overrides,
  };
}

describe("allow", () => {
  test("a command with no delete verb is emitted unchanged", () => {
    const decision = planGuardCommand("ls -la && echo done", options());
    expect(decision.kind).toBe("allow");
    expect(decision.command).toBe("ls -la && echo done");
    expect(decision.hits).toHaveLength(0);
  });

  test("a word that only looks like a verb is not a verb", () => {
    for (const command of ["echo rm", "printf '%s' rmdir", "grep -r 'rm -rf' ."]) {
      expect(planGuardCommand(command, options()).kind).toBe("allow");
    }
  });
});

describe("rewrite", () => {
  test("swaps only the program token", () => {
    const decision = planGuardCommand("rm -rf './build dir' --exclude=x", options({ spool: "/spool" }));
    expect(decision.kind).toBe("rewrite");
    expect(decision.command).toBe("trash guard --spool /spool -rf './build dir' --exclude=x");
  });

  test("every verb in a compound command is rewritten in one pass", () => {
    const decision = planGuardCommand("rm -rf a && rm b ; rmdir c", options({ spool: "/spool" }));
    expect(decision.kind).toBe("rewrite");
    expect(decision.rewritten).toBe(3);
    expect(decision.command).toBe(
      "trash guard --spool /spool -rf a && trash guard --spool /spool b ; trash guard --rmdir --spool /spool c",
    );
  });

  test("rmdir selects rmdir grammar, rm does not", () => {
    expect(planGuardCommand("rmdir d", options({ spool: "/s" })).command).toBe("trash guard --rmdir --spool /s d");
    expect(planGuardCommand("rm -d d", options({ spool: "/s" })).command).toBe("trash guard --spool /s -d d");
  });

  test("a spool path with spaces survives as one word", () => {
    const decision = planGuardCommand("rm -rf x", options({ spool: "/var/tmp/my spool" }));
    expect(decision.command).toBe("trash guard --spool '/var/tmp/my spool' -rf x");
  });

  test("no spool configured means no spool is embedded", () => {
    const decision = planGuardCommand("rm -rf x", options({ spool: "" }));
    expect(decision.command).toBe("trash guard -rf x");
  });

  test("wrappers the swap stays valid through", () => {
    expect(planGuardCommand("timeout 5 rm -rf x", options({ spool: "/s" })).command).toBe(
      "timeout 5 trash guard --spool /s -rf x",
    );
    expect(planGuardCommand("env FOO=1 rm -rf x", options({ spool: "/s" })).command).toBe(
      "env FOO=1 trash guard --spool /s -rf x",
    );
  });

  test("`rm -f` with no operands is rewriteable — the missing-operand rule lives in the guard", () => {
    const decision = planGuardCommand("rm -f", options({ spool: "/s" }));
    expect(decision.kind).toBe("rewrite");
    expect(decision.command).toBe("trash guard --spool /s -f");
    expect(decision.targets).toEqual([]);
  });

  test("the targets it decided on are reported", () => {
    const decision = planGuardCommand("rm -rf ./a ./b", options());
    expect(decision.targets).toEqual(["./a", "./b"]);
  });
});

describe("refusals (§15 correction 9)", () => {
  test("git rm, git clean, find -delete and find -exec are denied", () => {
    for (const command of [
      "git rm --cached f",
      "git clean -fdx",
      "find . -name '*.tmp' -delete",
      "find . -name '*.tmp' -exec rm {} ;",
      "shred -u secret",
      "unlink secret",
    ]) {
      const decision = planGuardCommand(command, options());
      expect(decision.kind, command).toBe("deny");
      expect(decision.command, command).toBe(command);
      expect(decision.reason.length).toBeGreaterThan(0);
    }
  });

  test("a refusal denies the WHOLE command, never a partial rewrite", () => {
    const decision = planGuardCommand("rm -rf a && git rm b", options());
    expect(decision.kind).toBe("deny");
    // The untouched command, so nothing the guard could not cover runs either.
    expect(decision.command).toBe("rm -rf a && git rm b");
    expect(decision.rewritten).toBe(0);
  });

  test("an opaque wrapper is denied rather than half-covered", () => {
    for (const command of ["xargs rm -rf", "find . | xargs rm -rf", "sh -c 'rm -rf /'", "eval 'rm -rf x'"]) {
      expect(planGuardCommand(command, options()).kind, command).toBe("deny");
    }
  });

  test("a privilege transition is denied", () => {
    for (const command of ["sudo rm -rf /etc", "sudo -u root rm -rf /var", "doas rm -rf /etc"]) {
      expect(planGuardCommand(command, options()).kind, command).toBe("deny");
    }
  });

  test("an unenumerable target denies — the guard cannot tell what it would delete", () => {
    for (const command of ["rm -rf $DIR", "rm -rf *.log", "rm -rf $(cat list)", "rm -rf `ls`"]) {
      const decision = planGuardCommand(command, options());
      expect(decision.kind, command).toBe("deny");
      expect(decision.rewritten, command).toBe(0);
    }
  });

  test("a quoted glob is a literal name and stays rewriteable", () => {
    const decision = planGuardCommand("rm -rf '*.log'", options({ spool: "/s" }));
    expect(decision.kind).toBe("rewrite");
    expect(decision.command).toBe("trash guard --spool /s -rf '*.log'");
  });

  test("a truncated lex denies, because no span in it can be trusted", () => {
    for (const command of ['rm -rf "unclosed', "rm -rf $(echo x", "rm -rf `echo x"]) {
      const decision = planGuardCommand(command, options());
      expect(decision.kind, command).toBe("deny");
      expect(decision.rewritten, command).toBe(0);
    }
  });
});

describe("the protected class (§11.3)", () => {
  test("the filesystem root and system roots are denied", () => {
    for (const command of ["rm -rf /", "rm -rf /etc", "rm -rf /usr", "rm -rf /etc/hosts"]) {
      const decision = planGuardCommand(command, options());
      expect(decision.kind, command).toBe("deny");
      expect(decision.reason, command).toContain("protected class");
    }
  });

  test("home, ~/.ssh, ~/.aws and ~/.hasna are denied", () => {
    for (const command of ["rm -rf ~", "rm -rf ~/", "rm -rf ~/.ssh", "rm -rf ~/.aws", "rm -rf ~/.hasna"]) {
      const decision = planGuardCommand(command, options());
      expect(decision.kind, command).toBe("deny");
      expect(decision.reason, command).toContain("protected class");
    }
  });

  test("a path INSIDE a protected home directory is rewriteable, so it lands in the trash", () => {
    // The protected class is the roots themselves (§11.3), matching what the
    // store enforces. Deeper paths are NOT refused, deliberately: a refused
    // `rm -rf ~/.ssh/known_hosts` does not preserve the file, it only sends
    // the user to a real `rm` — the opposite of the guard's purpose. Routed
    // through the guard, the same delete is a capture and is recoverable.
    for (const command of ["rm -rf ~/.ssh/id_rsa", "rm -rf ~/.hasna/scratch", "rm -rf /usr/local/src/x"]) {
      expect(planGuardCommand(command, options()).kind, command).toBe("rewrite");
    }
  });

  test("the trash store's own roots are denied", () => {
    const store = sandbox.dir("spool");
    const decision = planGuardCommand(`rm -rf ${store}`, options({ extraProtectedRoots: [store] }));
    expect(decision.kind).toBe("deny");
  });

  test("a repository root is denied", () => {
    const repo = sandbox.dir("repo");
    sandbox.dir("repo/.git");
    const decision = planGuardCommand(`rm -rf ${repo}`, options());
    expect(decision.kind).toBe("deny");
    expect(decision.reason).toContain("repository root");
  });

  test("a linked worktree root (a `.git` FILE) is denied too", () => {
    const worktree = sandbox.dir("wt");
    sandbox.file("wt/.git", "gitdir: /elsewhere\n");
    expect(planGuardCommand(`rm -rf ${worktree}`, options()).kind).toBe("deny");
  });

  test("an ordinary project directory is NOT a repository root", () => {
    const dir = sandbox.dir("work/build");
    expect(planGuardCommand(`rm -rf ${dir}`, options()).kind).toBe("rewrite");
  });

  test("another user's home cannot be resolved, so it is denied rather than guessed", () => {
    const decision = planGuardCommand("rm -rf ~someoneelse/data", options());
    expect(decision.kind).toBe("deny");
    expect(decision.reason).toContain("another user's home");
  });

  test("a delete inside the home directory is still allowed", () => {
    const decision = planGuardCommand("rm -rf ~/scratch", options());
    expect(decision.kind).toBe("rewrite");
  });
});

describe("plan document", () => {
  test("carries the decision, the command and the spans", () => {
    const decision = planGuardCommand("rm -rf x", options());
    const document = guardPlanDocument(decision);
    expect(document.schema).toBe("hasna.trash.guard-plan.v1");
    expect(document.decision).toBe("rewrite");
    expect(document.hits[0]).toEqual({ verb: "rm", disposition: "rewrite", start: 0, end: 2, reason: "" });
  });
});
