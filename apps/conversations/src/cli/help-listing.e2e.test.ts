import { describe, expect, test } from "bun:test";

// Regression for todos afda2dcf: the top-level `conversations --help`
// command listing derives each subcommand row's argument list from the
// commander .argument() declarations in declaration order. PR #1068 fixed
// the `send` SUBCOMMAND usage line via a .usage() override
// ("Usage: conversations send [options] <channel> <message>"), but the
// parent listing still rendered `send [options] <message> [channel]` from
// the declarations, so the contradiction the original bug named persisted
// one surface up.
//
// The fix must make the parent row agree with the corrected subcommand
// usage while leaving the parsing behavior untouched: the two-positional
// form (`send <channel> "<message>"`) and the single-positional flag forms
// (`send "<message>" --channel X`, `send "<message>" --to A`) are covered
// by send-positional-channel.e2e.test.ts and must keep passing unchanged.

const CLI = ["bun", "run", "./src/cli/index.tsx"];

function runCli(args: string[]) {
  const result = Bun.spawnSync({
    cmd: [...CLI, ...args],
    cwd: process.cwd(),
    env: {
      ...process.env,
      CONVERSATIONS_AGENT_ID: "alice",
      FORCE_COLOR: "0",
    },
    stdout: "pipe",
    stderr: "pipe",
  });
  return {
    exitCode: result.exitCode,
    stdout: new TextDecoder().decode(result.stdout),
    stderr: new TextDecoder().decode(result.stderr),
  };
}

describe("help listing consistency (todos afda2dcf)", () => {
  test("parent `--help` lists send with the channel-first argument order", () => {
    const help = runCli(["--help"]);
    expect(help.exitCode, help.stderr).toBe(0);
    // The parent row must agree with the corrected subcommand usage
    // `Usage: conversations send [options] <channel> <message>`.
    expect(help.stdout).toContain("send [options] <channel> <message>");
    // The declaration-order rendering (<message> [channel]) must be gone.
    expect(help.stdout).not.toContain("send [options] <message> [channel]");
  });

  test("`send --help` keeps the corrected usage line", () => {
    const help = runCli(["send", "--help"]);
    expect(help.exitCode, help.stderr).toBe(0);
    expect(help.stdout).toContain("Usage: conversations send [options] <channel> <message>");
  });
});
