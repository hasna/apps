import { resolve } from "path";
import type { Command } from "commander";
import { jsonOut } from "../../lib/format.js";
import {
  STYLES,
  getStyle,
  findSimilarStyles,
  getStylesByCategory,
  CATEGORIES,
} from "../../lib/registry.js";
import { getExample, listExamples, PATTERNS } from "../../lib/examples.js";
import type { Pattern } from "../../lib/examples.js";

const isTTY = (process.stdout.isTTY ?? false) && (process.stdin.isTTY ?? false);

export function registerMiscCommands(program: Command) {
  // ── styles list ─────────────────────────────────────────────────────────────

  program
    .command("list")
    .description("List all available styles")
    .option("-c, --category <cat>", "Filter by category")
    .action(async (opts: { category?: string }) => {
      let styles = STYLES;

      if (opts.category) {
        styles = getStylesByCategory(opts.category);
        if (styles.length === 0) {
          const validCats = CATEGORIES.join(", ");
          const { error } = await import("../../lib/format.js");
          error(`No styles found for category "${opts.category}"`, [`Valid categories: ${validCats}`]);
        }
      }

      if (!isTTY) { jsonOut(styles); return; }

      const React = await import("react");
      const { render } = await import("ink");
      const { App } = await import("../components/App.js");
      const { waitUntilExit } = render(React.default.createElement(App, { styles }));
      await waitUntilExit();
    });

  // ── styles info ─────────────────────────────────────────────────────────────

  program
    .command("info <name>")
    .description("Show full info for a style")
    .action((name: string) => {
      const { error } = require("../../lib/format.js");
      const style = getStyle(name);
      if (!style) {
        const similar = findSimilarStyles(name);
        error(`Style not found: "${name}"`, similar.length ? [`Did you mean: ${similar.join(", ")}`] : undefined);
        return;
      }

      if (!isTTY) { jsonOut(style); return; }

      const chalk = require("chalk");
      console.log();
      console.log(chalk.bold.cyan(style.displayName));
      console.log(chalk.dim(`Category: ${style.category}`));
      console.log();
      console.log(style.description);
      console.log();
      console.log(chalk.bold("Principles:"));
      for (const p of style.principles) console.log(`  ${chalk.cyan("•")} ${p}`);
      console.log();
      console.log(chalk.dim("Tags: " + style.tags.join(", ")));
      console.log();
    });

  // ── styles example ──────────────────────────────────────────────────────────

  program
    .command("example <pattern>")
    .description("Show a code example for a UI pattern in the active style")
    .option("-s, --style <name>", "Style name (default: active project style or minimalist)")
    .option("-p, --project <path>", "Project path (default: cwd)")
    .action(async (pattern: string, opts: { style?: string; project?: string }) => {
      const { error } = await import("../../lib/format.js");
      const { getActiveProfile } = await import("../../lib/profiles.js");
      const projectPath = resolve(opts.project ?? process.cwd());

      let styleName: string;
      if (opts.style) {
        styleName = opts.style;
      } else {
        const profile = getActiveProfile(projectPath);
        styleName = profile?.name ?? "minimalist";
      }

      if (!PATTERNS.includes(pattern as Pattern)) {
        error(`Unknown pattern: "${pattern}"`, [`Valid patterns: ${PATTERNS.join(", ")}`]);
      }

      const code = getExample(styleName, pattern as Pattern);

      if (!code) {
        const available = listExamples(styleName);
        error(
          `No example found for pattern "${pattern}" in style "${styleName}"`,
          [`Available patterns for ${styleName}: ${available.length > 0 ? available.join(", ") : "none"}`]
        );
        return;
      }

      process.stdout.write(code);
    });

  // ── styles mcp ──────────────────────────────────────────────────────────────

  program
    .command("mcp")
    .description("Start the MCP server (stdio transport)")
    .action(async () => {
      const { startMcpServer } = await import("../../mcp/index.js");
      await startMcpServer();
    });
}
