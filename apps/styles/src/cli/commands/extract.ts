import chalk from "chalk";
import { writeFileSync } from "fs";
import type { Command } from "commander";
import { jsonOut, error } from "../../lib/format.js";

const isTTY = (process.stdout.isTTY ?? false) && (process.stdin.isTTY ?? false);

export function registerExtractCommand(program: Command) {
  program
    .command("extract [url]")
    .description("Extract design tokens from a URL or local CSS file")
    .option("-n, --name <name>", "Name to save the kit as")
    .option("-s, --save", "Save extracted kit to database")
    .option("-f, --format <format>", "Output format: shadcn|tailwind|css-vars|mui|radix|w3c|scss|style-dictionary", "shadcn")
    .option("-o, --output <file>", "Write config to file instead of stdout")
    .option("-t, --tags <tags>", "Comma-separated tags")
    .option("--file <path>", "Extract from a local CSS/SCSS file instead of URL")
    .option("--screenshot <path>", "Extract from a screenshot/image using AI vision")
    .option("--pages <n>", "Crawl N pages (default: 1)", "1")
    .option("--responsive", "Sample at mobile/tablet/desktop viewports")
    .option("--states", "Capture hover/focus state style deltas")
    .option("--audit", "Run WCAG accessibility contrast audit on extracted colors")
    .action(async (url: string | undefined, opts: { name?: string; save?: boolean; format?: string; output?: string; tags?: string; file?: string; screenshot?: string; pages?: string; responsive?: boolean; states?: boolean; audit?: boolean }) => {
      const { extractStylesFromUrl, extractStylesFromFile, extractStylesFromScreenshot, enrichTokensWithAi } = await import("../../lib/extractor.js");
      const { tokenizeStyles } = await import("../../lib/tokenizer.js");
      const transformMod = await import("../../lib/transformer.js");
      const { saveKit } = await import("../../lib/kits.js");

      if (!url && !opts.file && !opts.screenshot) error("Provide a URL, --file <path>, or --screenshot <path>");
      const isFile = !!opts.file;
      const isScreenshot = !!opts.screenshot;
      const source = opts.screenshot ?? opts.file ?? url!;
      if (isTTY) console.log(chalk.dim(`Extracting styles from ${source}...`));

      try {
        const pages = Math.max(1, Math.min(parseInt(opts.pages ?? "1", 10), 10));
        const raw = isScreenshot
          ? await extractStylesFromScreenshot(source)
          : isFile
            ? extractStylesFromFile(source)
            : await extractStylesFromUrl(source, { pages, viewports: opts.responsive, states: opts.states });
        const tokens = tokenizeStyles(raw);

        let enrichment = null;
        if (!isFile && !isScreenshot && process.env["CEREBRAS_API_KEY"]) {
          if (isTTY) process.stdout.write(chalk.dim("  Running AI enrichment..."));
          enrichment = await enrichTokensWithAi(tokens, source);
          for (const color of tokens.colors) {
            const name = enrichment.colorNames[color.value];
            if (name) color.name = name;
          }
          if (isTTY) process.stdout.write(chalk.green(" done\n"));
        }

        const format = (opts.format ?? "shadcn") as Parameters<typeof transformMod.transform>[1];
        const result = transformMod.transform(tokens, format);

        let a11yReport = null;
        if (opts.audit) {
          const { auditColorContrast } = await import("../../lib/a11y.js");
          a11yReport = auditColorContrast(tokens, raw);
        }

        if (isTTY) {
          console.log(chalk.green("\n✔ Extraction complete\n"));
          console.log(chalk.bold("  Colors found:   ") + tokens.colors.length);
          console.log(chalk.bold("  Fonts found:    ") + tokens.typography.fontFamilies.length);
          console.log(chalk.bold("  Radii found:    ") + tokens.borderRadius.length);
          console.log(chalk.bold("  Shadows found:  ") + tokens.shadows.length);
          if (enrichment) {
            console.log(chalk.bold("  Style detected: ") + chalk.cyan(enrichment.detectedStyle));
            console.log(chalk.bold("  Suggested name: ") + chalk.cyan(enrichment.suggestedName));
            console.log(chalk.dim(`  ${enrichment.profileDescription}`));
          }
          if (a11yReport) {
            console.log();
            const scoreColor = a11yReport.score >= 80 ? chalk.green : a11yReport.score >= 50 ? chalk.yellow : chalk.red;
            console.log(chalk.bold("  A11y score:     ") + scoreColor(`${a11yReport.score}/100`) + chalk.dim(` (${a11yReport.passCount} pass, ${a11yReport.failCount} fail)`));
            const fails = a11yReport.pairs.filter((p) => p.level === "fail").slice(0, 3);
            if (fails.length) {
              console.log(chalk.dim("  Failing pairs:"));
              for (const f of fails) console.log(chalk.dim(`    ${f.foreground} on ${f.background} → ${f.ratio}:1`));
            }
          }
          console.log();
          console.log(chalk.bold(`  Config (${format}):\n`));
          console.log(result.code);
        } else {
          jsonOut({ tokens, code: result.code, config: result.config, format, enrichment, a11y: a11yReport });
        }

        if (opts.save) {
          if (!opts.name) {
            if (isTTY) console.error(chalk.red("--name is required when using --save"));
            process.exit(1);
          }
          const tags = opts.tags ? opts.tags.split(",").map((t) => t.trim()) : [];
          const kit = saveKit({ name: opts.name!, url: source, tokens, raw, tags, extractedAt: raw.extractedAt });
          if (isTTY) console.log(chalk.green(`\n  Saved as "${kit.name}" (${kit.id})`));
        }

        if (opts.output) {
          writeFileSync(opts.output, result.code, "utf-8");
          if (isTTY) console.log(chalk.green(`\n  Written to ${opts.output}`));
        }
      } catch (e) {
        error((e as Error).message);
      }
    });

  program
    .command("serve")
    .description("Start the HTTP dashboard server")
    .option("--port <n>", "Port number", "3421")
    .action(async (opts: { port: string }) => {
      const port = parseInt(opts.port, 10);
      if (isTTY) console.log(chalk.dim(`Starting dashboard server on port ${port}...`));
      const proc = Bun.spawn(["bun", "run", "src/server/serve.ts"], {
        env: { ...process.env, PORT: String(port) },
        stdout: "inherit",
        stderr: "inherit",
      });
      await proc.exited;
    });
}
