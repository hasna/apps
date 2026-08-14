import { describe, expect, test } from "bun:test";
import { Command } from "commander";
import { registerSecretsCommand, resolveSecretExposureSources } from "./secrets.js";

describe("secret exposure source flags", () => {
  test("defaults every non-file source off", () => {
    expect(resolveSecretExposureSources({})).toEqual({
      include_git_history: false,
      include_processes: false,
      include_tmux: false,
    });
  });

  test("requires a separate explicit opt-in for each source", () => {
    expect(resolveSecretExposureSources({ gitHistory: true })).toEqual({
      include_git_history: true,
      include_processes: false,
      include_tmux: false,
    });
    expect(resolveSecretExposureSources({ processes: true, tmux: true })).toEqual({
      include_git_history: false,
      include_processes: true,
      include_tmux: true,
    });
  });

  test("files-only wins over every ambient or historical opt-in", () => {
    expect(resolveSecretExposureSources({
      filesOnly: true,
      gitHistory: true,
      processes: true,
      tmux: true,
    })).toEqual({
      include_git_history: false,
      include_processes: false,
      include_tmux: false,
    });
  });

  test("repo-only blocks live sources while allowing explicit git history", () => {
    expect(resolveSecretExposureSources({
      repoOnly: true,
      gitHistory: true,
      processes: true,
      tmux: true,
    })).toEqual({
      include_git_history: true,
      include_processes: false,
      include_tmux: false,
    });
  });

  test("Commander help keeps compatibility flags while positive source flags default off", () => {
    const program = new Command();
    registerSecretsCommand(program);
    const command = program.commands.find((candidate) => candidate.name() === "secrets");

    expect(command).toBeDefined();
    expect(command?.options.find((option) => option.long === "--git-history")?.defaultValue).toBe(false);
    expect(command?.options.find((option) => option.long === "--processes")?.defaultValue).toBe(false);
    expect(command?.options.find((option) => option.long === "--tmux")?.defaultValue).toBe(false);
    expect(command?.options.some((option) => option.long === "--no-git-history")).toBe(true);
    expect(command?.options.some((option) => option.long === "--no-processes")).toBe(true);
    expect(command?.options.some((option) => option.long === "--no-tmux")).toBe(true);
    expect(command?.helpInformation()).toContain("file-only");
  });
});
