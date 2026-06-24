/**
 * Manpage-grade CLI help generation from cli-reference.
 */

import {
  CLI_REFERENCE_SCHEMA,
  CLI_COMMAND_GROUPS,
  ENV_VARS,
  EXIT_CODES,
  JSON_OUTPUT_CONTRACT,
  getInstallInstructions,
} from "./cli-reference.js";

export const MANPAGE_SCHEMA = "todos.cli_manpage.v1";

export function generateManpage(): string {
  const sections: string[] = [];

  sections.push(`TODOS(1)                    User Commands                    TODOS(1)`);
  sections.push("");
  sections.push("NAME");
  sections.push("       todos - universal task management for AI coding agents");
  sections.push("");
  sections.push("SYNOPSIS");
  sections.push("       todos [global-options] <command> [arguments]");
  sections.push("");
  sections.push("DESCRIPTION");
  sections.push(
    "       Local-first task management with CLI, MCP server, TUI, and REST API.",
    "       All data stored in SQLite. No cloud required.",
  );
  sections.push("");
  sections.push("GLOBAL OPTIONS");
  sections.push("       --json, -j    Emit JSON output on supported commands");
  sections.push("       --help, -h    Show help");
  sections.push("       --version     Show version");
  sections.push("");

  for (const group of CLI_COMMAND_GROUPS) {
    sections.push(`${group.name.toUpperCase()} COMMANDS`);
    sections.push(`       ${group.description}`);
    sections.push("");
    for (const cmd of group.commands) {
      const usage = cmd.usage ?? `todos ${cmd.name}`;
      sections.push(`       ${usage}`);
      sections.push(`           ${cmd.summary}`);
      if (cmd.flags?.length) sections.push(`           Options: ${cmd.flags.join(", ")}`);
      if (cmd.example) sections.push(`           Example: ${cmd.example}`);
      if (cmd.json) sections.push("           Supports --json output");
      sections.push("");
    }
  }

  sections.push("ENVIRONMENT");
  for (const env of ENV_VARS) {
    sections.push(`       ${env.name}`);
    sections.push(`           ${env.description}${env.default ? ` (default: ${env.default})` : ""}`);
  }
  sections.push("");

  sections.push("EXIT STATUS");
  for (const ec of EXIT_CODES) {
    sections.push(`       ${ec.code}    ${ec.meaning}`);
  }
  sections.push("");

  sections.push("JSON OUTPUT");
  sections.push(`       ${JSON_OUTPUT_CONTRACT.description}`);
  sections.push(`       Stable fields: ${JSON_OUTPUT_CONTRACT.stable_fields.join(", ")}`);
  sections.push("");

  sections.push("COMPLETIONS");
  sections.push("       todos completion bash|zsh|fish");
  sections.push("       todos completion install --shell bash");
  for (const shell of ["bash", "zsh", "fish"] as const) {
    sections.push(`       ${getInstallInstructions(shell)[0]}`);
  }
  sections.push("");

  sections.push("SEE ALSO");
  sections.push("       todos-mcp(1), todos-serve(1), AGENTS.md");
  sections.push("");
  sections.push(`SCHEMA  ${MANPAGE_SCHEMA} / ${CLI_REFERENCE_SCHEMA}`);

  return sections.join("\n");
}

export function generateCliReferenceMarkdown(): string {
  const lines: string[] = [
    "# todos CLI Reference",
    "",
    `Schema: \`${CLI_REFERENCE_SCHEMA}\``,
    "",
    "## Global flags",
    "",
    "- `--json` / `-j` — machine-readable output",
    "- `--help` / `-h` — command help",
    "",
    "Human list/search/detail commands are compact by default. Use `--limit` and `--cursor` to page rows, `--verbose` for expanded human detail, or `--json` for explicit machine-readable records.",
    "",
    "## Command groups",
    "",
  ];

  for (const group of CLI_COMMAND_GROUPS) {
    lines.push(`### ${group.name}`);
    lines.push("");
    lines.push(group.description);
    lines.push("");
    lines.push("| Command | Summary | Example |");
    lines.push("|---------|---------|---------|");
    for (const cmd of group.commands) {
      lines.push(`| \`${cmd.name}\` | ${cmd.summary} | ${cmd.example ?? "—"} |`);
    }
    lines.push("");
  }

  lines.push("## Environment variables");
  lines.push("");
  lines.push("| Variable | Description | Default |");
  lines.push("|----------|-------------|---------|");
  for (const env of ENV_VARS) {
    lines.push(`| \`${env.name}\` | ${env.description} | ${env.default ?? "—"} |`);
  }
  lines.push("");

  lines.push("## Exit codes");
  lines.push("");
  for (const ec of EXIT_CODES) {
    lines.push(`- **${ec.code}** — ${ec.meaning}`);
  }
  lines.push("");

  lines.push("## JSON output contract");
  lines.push("");
  lines.push(JSON_OUTPUT_CONTRACT.description);
  lines.push("");

  lines.push("## Shell completions");
  lines.push("");
  lines.push("```bash");
  lines.push(getInstallInstructions("bash").join("\n"));
  lines.push("```");
  lines.push("");

  return lines.join("\n");
}
