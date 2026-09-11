/**
 * The scanner's contract, stated as spans.
 *
 * Every assertion here is about BYTES, not about a decoded word list: the
 * rewrite is a span substitution, so `hit.span` must select exactly the token
 * that has to be replaced and nothing else. The tests that look pedantic
 * (`printf '%s\n' rm` must NOT match) are the ones that separate a scanner from
 * a `findIndex` over tokenized words — which is the defect §15 correction 9
 * records against reusing the fleet's decoder for rewriting.
 */

import { describe, expect, test } from "bun:test";
import { applySpanEdits, quoteForShell, scanDeleteVerbs, type DeleteVerbHit } from "./scan.js";

function hit(command: string, index = 0): DeleteVerbHit {
  const result = scanDeleteVerbs(command);
  const found = result.hits[index];
  expect(found, `expected a hit at index ${index} in ${JSON.stringify(command)}`).toBeDefined();
  return found!;
}

function slice(command: string, found: DeleteVerbHit): string {
  return command.slice(found.span.start, found.span.end);
}

describe("command position", () => {
  test("the first word of the command", () => {
    const command = "rm -rf /work/build";
    expect(slice(command, hit(command))).toBe("rm");
    expect(hit(command).disposition).toBe("rewrite");
  });

  test("after every segment separator", () => {
    for (const separator of [";", "&&", "||", "|", "&", "\n", "(", ";"]) {
      const command = `true ${separator} rm -rf x`;
      const found = hit(command);
      expect(slice(command, found)).toBe("rm");
      expect(found.span.start).toBe(command.indexOf("rm"));
    }
  });

  test("after the keywords that introduce a command", () => {
    for (const prefix of ["if true; then", "while true; do", "do", "else", "!", "{"]) {
      const command = `${prefix} rm -rf x`;
      expect(slice(command, hit(command))).toBe("rm");
    }
  });

  test("NOT after `in` — a case pattern is not a command", () => {
    // `case rm in rm) …` — the second `rm` is a PATTERN. Rewriting it would
    // produce a syntax error, and the first is not a command either.
    const result = scanDeleteVerbs("case rm in rm) echo hi;; esac");
    expect(result.hits).toHaveLength(0);
  });

  test("never in argument position", () => {
    for (const command of ["printf '%s\\n' rm", "echo rm", "grep rm file.txt", "ls -la rm", "x=rm"]) {
      expect(scanDeleteVerbs(command).hits).toHaveLength(0);
    }
  });

  test("not the operand of a redirection", () => {
    expect(scanDeleteVerbs("cat > rm").hits).toHaveLength(0);
    expect(scanDeleteVerbs("echo hi 2> rm").hits).toHaveLength(0);
  });

  test("finds both verbs of a compound command, with distinct spans", () => {
    const command = "rm -rf build && rmdir out";
    const result = scanDeleteVerbs(command);
    expect(result.hits.map((h) => slice(command, h))).toEqual(["rm", "rmdir"]);
    expect(result.hits.map((h) => h.verb)).toEqual(["rm", "rmdir"]);
  });
});

describe("verb classification", () => {
  test("paths and quoting still classify as the verb", () => {
    for (const [command, span] of [
      ["/bin/rm -rf x", "/bin/rm"],
      ["../rm -rf x", "../rm"],
      ['"rm" -rf x', '"rm"'],
      ["r\\m -rf x", "r\\m"],
    ] as const) {
      const found = hit(command);
      expect(found.verb).toBe(command.includes("rmdir") ? "rmdir" : "rm");
      expect(slice(command, found)).toBe(span);
      expect(found.disposition).toBe("rewrite");
    }
  });

  test("shred and unlink are refused, not rewritten", () => {
    for (const command of ["shred -u secret", "unlink secret", "/usr/bin/unlink secret"]) {
      const found = hit(command);
      expect(found.disposition).toBe("refuse");
      expect(found.reason.length).toBeGreaterThan(0);
    }
  });

  test("git rm / git clean / find -delete are refused (§15 correction 9)", () => {
    for (const command of ["git rm --cached f", "git clean -fd", "find . -name '*.o' -delete", "find . -exec rm {} \\;"]) {
      const found = hit(command);
      expect(found.disposition).toBe("refuse");
    }
  });

  test("git commands that delete nothing are not touched", () => {
    expect(scanDeleteVerbs("git status").hits).toHaveLength(0);
    expect(scanDeleteVerbs("git log --oneline").hits).toHaveLength(0);
  });
});

describe("wrappers", () => {
  test("a transparent wrapper keeps the verb's span valid", () => {
    for (const command of ["timeout 5 rm -rf x", "env FOO=1 rm -rf x", "nohup rm -rf x", "nice -n 5 rm x"]) {
      const found = hit(command);
      expect(found.verb).toBe("rm");
      expect(slice(command, found)).toBe("rm");
      expect(found.disposition).toBe("rewrite");
    }
  });

  test("an opaque wrapper refuses — the guard cannot see what it runs", () => {
    for (const command of ["xargs rm -rf", "eval 'rm -rf x'", "sh -c 'rm -rf x'", "bash -c 'rm -rf /'", "find . | xargs rm"]) {
      const found = hit(command);
      expect(found.disposition).toBe("refuse");
    }
  });

  test("a privilege wrapper refuses (wave 1 is unprivileged)", () => {
    for (const command of ["sudo rm -rf /etc", "sudo -u root rm -rf /etc", "doas rm -rf /etc"]) {
      const found = hit(command);
      expect(found.disposition).toBe("refuse");
    }
  });

  test("inspection is not execution", () => {
    for (const command of ["command -v rm", "which rm", "type rm", "hash rm"]) {
      expect(scanDeleteVerbs(command).hits).toHaveLength(0);
    }
  });

  test("`command rm …` and `builtin` still run the verb", () => {
    expect(hit("command rm -rf x").disposition).toBe("rewrite");
  });
});

describe("text that only looks like a command", () => {
  test("a heredoc body is data", () => {
    const command = "cat <<EOF\nrm -rf /\nEOF\n";
    expect(scanDeleteVerbs(command).hits).toHaveLength(0);
  });

  test("a quoted heredoc delimiter still skips its body", () => {
    const command = "cat <<-'EOF'\n\trm -rf /\n\tEOF\n";
    expect(scanDeleteVerbs(command).hits).toHaveLength(0);
  });

  test("the command after a heredoc is still scanned", () => {
    const command = "cat <<EOF\nrm -rf /\nEOF\nrm -rf /work\n";
    const found = hit(command);
    expect(slice(command, found)).toBe("rm");
    expect(found.span.start).toBe(command.lastIndexOf("rm"));
  });

  test("a comment is not a command", () => {
    expect(scanDeleteVerbs("# rm -rf /\n").hits).toHaveLength(0);
    expect(scanDeleteVerbs("true # rm -rf /\n").hits).toHaveLength(0);
    const found = hit("true && rm x # rm y\n");
    expect(found.span.start).toBe("true && rm x".indexOf("rm"));
  });
});

describe("command substitutions", () => {
  test("a delete inside a substitution is surfaced and refused", () => {
    const command = "echo $(rm -rf x)";
    const found = hit(command);
    expect(found.disposition).toBe("refuse");
    expect(found.inSubstitution).toBe(true);
    expect(command.slice(found.span.start, found.span.end)).toBe("rm");
  });

  test("a substitution that deletes nothing is not a hit", () => {
    expect(scanDeleteVerbs("echo $(date)").hits).toHaveLength(0);
    expect(scanDeleteVerbs("echo `date`").hits).toHaveLength(0);
  });

  test("an unterminated substitution taints the whole scan", () => {
    const result = scanDeleteVerbs("echo $(rm -rf x");
    expect(result.unterminated).toBe(true);
  });

  test("a word containing a substitution is one word, decoded with the flag set", () => {
    const found = hit("rm -rf $(pwd)/build");
    const arg = found.args.find((w) => w.hasSubstitution);
    expect(arg).toBeDefined();
    expect(arg!.raw).toBe("$(pwd)/build");
    expect(arg!.span.end - arg!.span.start).toBe("$(pwd)/build".length);
  });
});

describe("unterminated input", () => {
  test("an unterminated quote is reported", () => {
    expect(scanDeleteVerbs('rm -rf "x').unterminated).toBe(true);
  });

  test("a balanced command is not", () => {
    expect(scanDeleteVerbs("rm -rf 'x y' && echo \"$(date)\"").unterminated).toBe(false);
  });
});

describe("word decoding", () => {
  test("flags report substitution, variable and glob separately", () => {
    const words = hit("rm -rf $DIR").args;
    expect(words[0]!.text).toBe("-rf");
    expect(words[0]!.hasVariable).toBe(false);
    expect(words[1]!.hasVariable).toBe(true);
    expect(words[1]!.hasGlob).toBe(false);

    expect(hit("rm -rf *.log").args[1]!.hasGlob).toBe(true);
    expect(hit("rm -rf $(cat list)").args[1]!.hasSubstitution).toBe(true);

    // Quoting disarms a metacharacter: `'*.log'` is a literal file name, and
    // the planner must be able to tell the two apart before deciding.
    const quoted = hit("rm -rf '*.log'").args;
    expect(quoted[1]!.hasGlob).toBe(false);
    expect(quoted[1]!.text).toBe("*.log");
    expect(quoted[1]!.raw).toBe("'*.log'");
  });

  test("`--` separates flags from operands without changing their spans", () => {
    const found = hit("rm -- -weird");
    expect(found.args.map((a) => a.text)).toEqual(["--", "-weird"]);
  });
});

describe("applySpanEdits", () => {
  test("replaces only the given spans and is right-to-left safe", () => {
    const command = "rm -rf build && rm -rf out";
    const result = scanDeleteVerbs(command);
    expect(result.hits).toHaveLength(2);
    const rewritten = applySpanEdits(
      command,
      result.hits.map((h) => ({ span: h.span, text: "trash guard" })),
    );
    expect(rewritten).toBe("trash guard -rf build && trash guard -rf out");
  });

  test("a multi-character replacement shifts later spans correctly", () => {
    // Left-to-right application would corrupt the second edit; the edit list is
    // applied right-to-left precisely so this case is stable.
    const command = "rm a; rm b";
    const result = scanDeleteVerbs(command);
    const rewritten = applySpanEdits(
      command,
      result.hits.map((h) => ({ span: h.span, text: "TRASH GUARD --SPOOL /very/long/path" })),
    );
    expect(rewritten).toBe("TRASH GUARD --SPOOL /very/long/path a; TRASH GUARD --SPOOL /very/long/path b");
  });

  test("an empty edit list returns the command unchanged", () => {
    expect(applySpanEdits("rm -rf x", [])).toBe("rm -rf x");
  });
});

describe("quoteForShell", () => {
  test("leaves safe words alone and quotes the rest", () => {
    expect(quoteForShell("/home/u/.hasna/trash")).toBe("/home/u/.hasna/trash");
    expect(quoteForShell("/spool dir/x")).toBe("'/spool dir/x'");
    expect(quoteForShell("it's")).toBe("'it'\\''s'");
    expect(quoteForShell("")).toBe("''");
  });
});
