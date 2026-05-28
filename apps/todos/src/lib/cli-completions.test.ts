import { describe, it, expect } from "bun:test";
import {
  COMPLETIONS_SCHEMA,
  generateBashCompletion,
  generateZshCompletion,
  generateFishCompletion,
} from "./cli-completions.js";
import { generateManpage, generateCliReferenceMarkdown, MANPAGE_SCHEMA } from "./cli-manpage.js";
import { listTopLevelCommands, CLI_REFERENCE_SCHEMA } from "./cli-reference.js";

describe("cli completions and manpage", () => {
  it("lists top-level commands", () => {
    const cmds = listTopLevelCommands();
    expect(cmds.length).toBeGreaterThan(20);
    expect(cmds).toContain("add");
    expect(cmds).toContain("claim");
    expect(cmds).toContain("completion");
  });

  it("generates bash completion script", () => {
    const script = generateBashCompletion();
    expect(script).toContain(COMPLETIONS_SCHEMA);
    expect(script).toContain("complete -F _todos_completions todos");
    expect(script).toContain("bridge");
    expect(script).toContain("claim");
  });

  it("generates zsh completion script", () => {
    const script = generateZshCompletion();
    expect(script).toContain("#compdef todos");
    expect(script).toContain("bridge");
  });

  it("generates fish completion script", () => {
    const script = generateFishCompletion();
    expect(script).toContain("complete -c todos");
    expect(script).toContain("__fish_seen_subcommand_from bridge");
  });

  it("generates manpage with env and exit codes", () => {
    const page = generateManpage();
    expect(page).toContain("TODOS(1)");
    expect(page).toContain("TODOS_DB_PATH");
    expect(page).toContain("EXIT STATUS");
    expect(page).toContain(MANPAGE_SCHEMA);
  });

  it("generates markdown CLI reference", () => {
    const md = generateCliReferenceMarkdown();
    expect(md).toContain(CLI_REFERENCE_SCHEMA);
    expect(md).toContain("## Command groups");
    expect(md).toContain("todos completion bash");
  });

  it("keeps bash completion snapshot stable for core commands", () => {
    const script = generateBashCompletion();
    expect(script).toMatchSnapshot();
  });
});
