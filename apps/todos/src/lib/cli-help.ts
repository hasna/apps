import type { Command, Option } from "commander";

export type CompletionShell = "bash" | "zsh" | "fish";

export interface CliOptionEntry {
  flags: string;
  description: string;
  longFlag: string | null;
  shortFlag: string | null;
}

export interface CliCommandEntry {
  path: string[];
  command: string;
  description: string;
  aliases: string[];
  usage: string;
  options: CliOptionEntry[];
}

export interface CliManual {
  title: string;
  synopsis: string;
  package_name: string;
  local_only: true;
  install: string[];
  update: string[];
  completion_shells: CompletionShell[];
  examples: string[];
  json_contracts: string[];
  error_codes: { code: string; meaning: string }[];
  commands: CliCommandEntry[];
}

export const COMPLETION_SHELLS: CompletionShell[] = ["bash", "zsh", "fish"];

const CORE_EXAMPLES = [
  "todos project-bootstrap . --json",
  "todos add \"Ship CLI help\" --priority high --json",
  "todos ready --json",
  "todos usage report --max-tasks 1000 --max-projects 10 --json",
  "todos runs command <run-id> \"bun test\" --status passed --summary \"1836 pass, 0 fail\"",
  "todos mcp",
];

const JSON_CONTRACTS = [
  "local_task",
  "local_project",
  "task_run",
  "local_usage_ledger",
  "structured_error",
  "api_error",
];

const ERROR_CODES = [
  { code: "0", meaning: "Command completed successfully." },
  { code: "1", meaning: "Validation, lookup, database, or runtime failure. In JSON mode the CLI prints {\"error\":\"message\"}." },
  { code: "structured_error", meaning: "Machine-readable error contract used by local MCP and SDK surfaces." },
  { code: "api_error", meaning: "HTTP API error envelope for the optional local server." },
];

function optionEntry(option: Option): CliOptionEntry {
  return {
    flags: option.flags,
    description: option.description || "",
    longFlag: option.long || null,
    shortFlag: option.short || null,
  };
}

export function collectCliCommandEntries(program: Command, prefix: string[] = []): CliCommandEntry[] {
  const entries: CliCommandEntry[] = [];
  for (const command of program.commands) {
    const path = [...prefix, command.name()];
    entries.push({
      path,
      command: path.join(" "),
      description: command.description() || "",
      aliases: command.aliases(),
      usage: command.usage(),
      options: command.options.map(optionEntry),
    });
    entries.push(...collectCliCommandEntries(command, path));
  }
  return entries;
}

export function createCliManual(program: Command): CliManual {
  return {
    title: "todos(1)",
    synopsis: "todos [global options] <command> [command options]",
    package_name: "@hasna/todos",
    local_only: true,
    install: ["bun install -g @hasna/todos"],
    update: ["bun install -g @hasna/todos", "todos upgrade"],
    completion_shells: COMPLETION_SHELLS,
    examples: CORE_EXAMPLES,
    json_contracts: JSON_CONTRACTS,
    error_codes: ERROR_CODES,
    commands: collectCliCommandEntries(program),
  };
}

function escapeMarkdownCell(value: string): string {
  return value.replaceAll("|", "\\|").replaceAll("\n", " ");
}

export function renderCliManualMarkdown(manual: CliManual): string {
  const lines = [
    `# ${manual.title}`,
    "",
    "## Name",
    "",
    "todos - local task, plan, run, and MCP workflows for AI coding agents",
    "",
    "## Synopsis",
    "",
    "```bash",
    manual.synopsis,
    "```",
    "",
    "## Install",
    "",
    "```bash",
    ...manual.install,
    "```",
    "",
    "## Update",
    "",
    "```bash",
    ...manual.update,
    "```",
    "",
    "## Shell Completions",
    "",
    "```bash",
    "todos completions bash > ~/.local/share/bash-completion/completions/todos",
    "todos completions zsh > ~/.zsh/completions/_todos",
    "todos completions fish > ~/.config/fish/completions/todos.fish",
    "```",
    "",
    "## Examples",
    "",
    "```bash",
    ...manual.examples,
    "```",
    "",
    "## JSON Output Contracts",
    "",
    "The CLI keeps JSON output stable for scripts and MCP adapters. Use `--json` or `-j` when a command supports machine output.",
    "",
    ...manual.json_contracts.map(contract => `- \`${contract}\``),
    "",
    "## Error Codes",
    "",
    "| Code | Meaning |",
    "| --- | --- |",
    ...manual.error_codes.map(error => `| \`${escapeMarkdownCell(error.code)}\` | ${escapeMarkdownCell(error.meaning)} |`),
    "",
    "## Command Catalog",
    "",
    "| Command | Description | Options |",
    "| --- | --- | --- |",
    ...manual.commands.map(command => {
      const options = command.options.map(option => `\`${option.flags}\``).join("<br>");
      return `| \`todos ${escapeMarkdownCell(command.command)}\` | ${escapeMarkdownCell(command.description)} | ${options || "-"} |`;
    }),
    "",
  ];
  return lines.join("\n");
}

function shellWords(values: string[]): string {
  return values.map(value => value.replaceAll("'", "'\\''")).join(" ");
}

function zshEntry(name: string, description: string): string {
  return `'${name.replaceAll("'", "'\\''")}:${description.replaceAll("'", "'\\''")}'`;
}

function fishEscape(value: string): string {
  return value.replaceAll("\\", "\\\\").replaceAll("\"", "\\\"");
}

function rootCommandNames(entries: CliCommandEntry[]): string[] {
  return entries.filter(entry => entry.path.length === 1).map(entry => entry.path[0]).filter((value): value is string => Boolean(value));
}

function optionFlags(options: CliOptionEntry[]): string[] {
  const flags = new Set<string>();
  for (const option of options) {
    if (option.longFlag) flags.add(option.longFlag);
    if (option.shortFlag) flags.add(option.shortFlag);
  }
  return [...flags].sort();
}

function commandOptions(program: Command, entry: CliCommandEntry): string[] {
  return optionFlags([...program.options.map(optionEntry), ...entry.options]);
}

export function generateCompletionScript(program: Command, shell: CompletionShell): string {
  const entries = collectCliCommandEntries(program);
  const roots = rootCommandNames(entries);

  if (shell === "bash") {
    const rootCases = entries
      .filter(entry => entry.path.length === 1)
      .map(entry => {
        const children = entries.filter(child => child.path.length === 2 && child.path[0] === entry.path[0]).map(child => child.path[1]).filter((value): value is string => Boolean(value));
        const options = commandOptions(program, entry);
        return `    ${entry.path[0]})\n      COMPREPLY=($(compgen -W '${shellWords([...children, ...options])}' -- "$cur"))\n      return\n      ;;`;
      })
      .join("\n");

    return [
      "# todos bash completion. Generated by `todos completions bash`.",
      "_todos_completion() {",
      "  local cur",
      "  COMPREPLY=()",
      "  cur=\"${COMP_WORDS[COMP_CWORD]}\"",
      "  if [[ \"$cur\" == -* ]]; then",
      `    COMPREPLY=($(compgen -W '${shellWords(optionFlags(program.options.map(optionEntry)))}' -- "$cur"))`,
      "    return",
      "  fi",
      "  case \"${COMP_WORDS[1]}\" in",
      rootCases,
      "  esac",
      `  COMPREPLY=($(compgen -W '${shellWords(roots)}' -- "$cur"))`,
      "}",
      "complete -F _todos_completion todos",
      "",
    ].join("\n");
  }

  if (shell === "zsh") {
    const commandEntries = entries.filter(entry => entry.path.length === 1).map(entry => zshEntry(entry.path[0] || "", entry.description));
    const optionEntries = optionFlags(program.options.map(optionEntry)).map(flag => `'${flag}'`);
    const childCases = entries
      .filter(entry => entry.path.length === 1)
      .map(entry => {
        const children = entries.filter(child => child.path.length === 2 && child.path[0] === entry.path[0]);
        if (children.length === 0) return "";
        const childEntries = children.map(child => zshEntry(child.path[1] || "", child.description)).join(" ");
        return `    ${entry.path[0]}) local -a subcommands; subcommands=(${childEntries}); _describe 'subcommand' subcommands ;;`;
      })
      .filter(Boolean)
      .join("\n");

    return [
      "#compdef todos",
      "# todos zsh completion. Generated by `todos completions zsh`.",
      "_todos() {",
      `  local -a commands; commands=(${commandEntries.join(" ")})`,
      `  local -a global_options; global_options=(${optionEntries.join(" ")})`,
      "  if (( CURRENT == 2 )); then",
      "    _describe 'command' commands",
      "    return",
      "  fi",
      "  case $words[2] in",
      childCases,
      "  esac",
      "  _arguments $global_options '*::arg:->args'",
      "}",
      "_todos \"$@\"",
      "",
    ].join("\n");
  }

  const fishLines = [
    "# todos fish completion. Generated by `todos completions fish`.",
    "complete -c todos -f",
  ];
  for (const option of program.options.map(optionEntry)) {
    const parts = ["complete -c todos"];
    if (option.longFlag) parts.push(`-l ${option.longFlag.replace(/^--/, "")}`);
    if (option.shortFlag) parts.push(`-s ${option.shortFlag.replace(/^-/, "")}`);
    parts.push(`-d "${fishEscape(option.description)}"`);
    fishLines.push(parts.join(" "));
  }
  for (const entry of entries) {
    if (entry.path.length === 1) {
      fishLines.push(`complete -c todos -n "__fish_use_subcommand" -a "${entry.path[0]}" -d "${fishEscape(entry.description)}"`);
    } else if (entry.path.length === 2) {
      fishLines.push(`complete -c todos -n "__fish_seen_subcommand_from ${entry.path[0]}" -a "${entry.path[1]}" -d "${fishEscape(entry.description)}"`);
    }
  }
  fishLines.push("");
  return fishLines.join("\n");
}
