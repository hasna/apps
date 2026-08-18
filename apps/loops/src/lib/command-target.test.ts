import { createHash } from "node:crypto";
import { describe, expect, test } from "bun:test";
import {
  COMMAND_DIGEST_PREFIX,
  commandTargetDigest,
  publicCommandDescriptor,
  resolvedCommandLine,
  verifyCommandDigest,
} from "./command-target.js";

const sha256Hex = (value: string): string => createHash("sha256").update(value).digest("hex");

// Synthetic, non-live credential-shaped fixture values (never real secrets).
const ANT_KEY = ["sk", "-ant-api03-abcDEF123456789_-suffix"].join("");

describe("resolvedCommandLine", () => {
  test("a bare command with no args is the command itself", () => {
    expect(resolvedCommandLine({ command: "printf ok" })).toBe("printf ok");
    expect(resolvedCommandLine({ command: "true", args: [] })).toBe("true");
  });

  test("args are shell-quoted and space-joined exactly like the executor's shell path", () => {
    expect(resolvedCommandLine({ command: "deploy.sh", args: ["--env", "prod"] })).toBe(
      "deploy.sh '--env' 'prod'",
    );
  });

  test("embedded quotes in args are escaped like the executor's shellQuote", () => {
    expect(resolvedCommandLine({ command: "echo", args: ["a'b"] })).toBe("echo 'a'\\''b'");
  });
});

describe("commandTargetDigest", () => {
  test("safe-command fixture verifies: digest matches an independent sha256 of the resolved line", () => {
    const target = { command: "bash deploy.sh", args: ["--env", "prod", "--dry-run"] };
    const digest = commandTargetDigest(target);
    expect(digest).toBe(`${COMMAND_DIGEST_PREFIX}${sha256Hex(resolvedCommandLine(target))}`);
    expect(verifyCommandDigest(resolvedCommandLine(target), digest)).toBe(true);
  });

  test("one-byte mutation of the command fails verification", () => {
    const intended = { command: "bash deploy.sh", args: ["--env", "prod"] };
    const mutated = { command: "bash deploy.sH", args: ["--env", "prod"] };
    const digest = commandTargetDigest(intended);
    expect(commandTargetDigest(mutated)).not.toBe(digest);
    expect(verifyCommandDigest(resolvedCommandLine(mutated), digest)).toBe(false);
  });

  test("one-byte mutation of an argument fails verification", () => {
    const intended = { command: "deploy.sh", args: ["--env", "prod"] };
    const mutated = { command: "deploy.sh", args: ["--env", "pr0d"] };
    const digest = commandTargetDigest(intended);
    expect(commandTargetDigest(mutated)).not.toBe(digest);
    expect(verifyCommandDigest(resolvedCommandLine(mutated), digest)).toBe(false);
  });

  test("the literal 'shell' is never valid integrity evidence for a real command", () => {
    const digest = commandTargetDigest({ command: "bash /private/worktree/deploy.sh --recipient x@example.test" });
    expect(digest).not.toBe(commandTargetDigest({ command: "shell" }));
    expect(verifyCommandDigest("shell", digest)).toBe(false);
  });

  test("digests are stable and deterministic for identical targets", () => {
    expect(commandTargetDigest({ command: "true" })).toBe(commandTargetDigest({ command: "true" }));
  });

  test("malformed digests never verify", () => {
    expect(verifyCommandDigest("true", "cmd:sha256:not-a-hex")).toBe(false);
    expect(verifyCommandDigest("true", "")).toBe(false);
    expect(verifyCommandDigest("true", "sha256:deadbeef")).toBe(false);
  });
});

describe("publicCommandDescriptor", () => {
  test("non-shell targets keep their command name", () => {
    expect(publicCommandDescriptor({ command: "loops", args: ["routes", "drain"], shell: false })).toBe("loops");
  });

  test("shell targets show the real resolved command, scrubbed, never the literal 'shell'", () => {
    const command = `bash /private/worktree/deploy.sh --token ${ANT_KEY} --env prod`;
    const descriptor = publicCommandDescriptor({ command, shell: true });
    expect(descriptor).not.toBe("shell");
    expect(descriptor).toBe("bash /private/worktree/deploy.sh --token [SCRUBBED] --env prod");
    expect(descriptor).not.toContain(ANT_KEY);
  });

  test("long shell commands are bounded with a length note and never reveal the tail", () => {
    const command = `bash deploy.sh --recipient private@example.test --token ${ANT_KEY} --capability NON_SECRET_SENTINEL`;
    const descriptor = publicCommandDescriptor({ command, shell: true });
    expect(descriptor).not.toBe("shell");
    expect(descriptor).toStartWith("bash deploy.sh --recipient private@example.test --token [SCRUBBED]");
    expect(descriptor).toContain("[redacted");
    expect(descriptor).not.toContain(ANT_KEY);
    expect(descriptor).not.toContain("NON_SECRET_SENTINEL");
  });

  test("short safe shell commands show in full without a truncation marker", () => {
    expect(publicCommandDescriptor({ command: "printf ok", shell: true })).toBe("printf ok");
    expect(publicCommandDescriptor({ command: "bash deploy.sh --env prod", shell: true })).toBe(
      "bash deploy.sh --env prod",
    );
  });
});
