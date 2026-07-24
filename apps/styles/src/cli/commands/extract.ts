import chalk from "chalk";
import { writeFileSync } from "fs";
import type { Command } from "commander";
import { jsonOut, error, truncateText } from "../../lib/format.js";

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
    .option("-v, --verbose", "Print generated config in addition to the compact summary")
    .option("--json", "Output full tokens/config JSON")
    .action(async (url: string | undefined, opts: { name?: string; save?: boolean; format?: string; output?: string; tags?: string; file?: string; screenshot?: string; pages?: string; responsive?: boolean; states?: boolean; audit?: boolean; verbose?: boolean; json?: boolean }) => {
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

        let savedKit: ReturnType<typeof saveKit> | null = null;
        if (opts.save) {
          if (!opts.name) {
            if (isTTY) console.error(chalk.red("--name is required when using --save"));
            process.exit(1);
          }
          const tags = opts.tags ? opts.tags.split(",").map((t) => t.trim()) : [];
          savedKit = saveKit({ name: opts.name!, url: source, tokens, raw, tags, extractedAt: raw.extractedAt });
        }

        let outputPath: string | null = null;
        if (opts.output) {
          writeFileSync(opts.output, result.code, "utf-8");
          outputPath = opts.output;
        }

        const payload = { tokens, code: result.code, config: result.config, format, enrichment, a11y: a11yReport, kit: savedKit ? { id: savedKit.id, name: savedKit.name } : null, output: outputPath };
        if (opts.json) {
          jsonOut(payload);
        } else {
          writeExtractionSummary({
            source,
            format,
            tokens,
            enrichment,
            a11yReport,
            code: result.code,
            savedKit,
            outputPath,
            showCode: opts.verbose ?? false,
          });
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

function writeExtractionSummary(args: {
  source: string;
  format: string;
  tokens: {
    colors: Array<unknown>;
    typography: { fontFamilies: string[] };
    borderRadius: Array<unknown>;
    shadows: Array<unknown>;
  };
  enrichment: { detectedStyle?: string; suggestedName?: string; profileDescription?: string } | null;
  a11yReport: { score: number; passCount: number; failCount: number; pairs: Array<{ level: string; foreground: string; background: string; ratio: number }> } | null;
  code: string;
  savedKit: { id: string; name: string } | null;
  outputPath: string | null;
  showCode: boolean;
}) {
  console.log(chalk.green("Extraction complete"));
  console.log(chalk.dim(`Source: ${args.source}`));
  console.log(`Format: ${args.format}`);
  console.log(`Tokens: ${args.tokens.colors.length} colors, ${args.tokens.typography.fontFamilies.length} fonts, ${args.tokens.borderRadius.length} radii, ${args.tokens.shadows.length} shadows`);

  if (args.enrichment) {
    if (args.enrichment.detectedStyle) console.log(`Style detected: ${args.enrichment.detectedStyle}`);
    if (args.enrichment.suggestedName) console.log(`Suggested name: ${args.enrichment.suggestedName}`);
    if (args.enrichment.profileDescription) console.log(chalk.dim(truncateText(args.enrichment.profileDescription, 120)));
  }

  if (args.a11yReport) {
    console.log(`A11y: ${args.a11yReport.score}/100 (${args.a11yReport.passCount} pass, ${args.a11yReport.failCount} fail)`);
    const fails = args.a11yReport.pairs.filter((pair) => pair.level === "fail").slice(0, 3);
    for (const fail of fails) {
      console.log(chalk.dim(`  fail: ${fail.foreground} on ${fail.background} ${fail.ratio}:1`));
    }
  }

  if (args.savedKit) console.log(`Saved kit: ${args.savedKit.name} (${args.savedKit.id})`);
  if (args.outputPath) console.log(`Written: ${args.outputPath}`);
  if (args.showCode) {
    console.log(`\nConfig (${args.format}):\n`);
    console.log(args.code);
  } else if (!args.outputPath) {
    console.log(chalk.dim("Use --verbose to print generated config, --output <file> to write it, or --json for full tokens/config."));
  } else {
    console.log(chalk.dim("Use --json for full tokens/config."));
  }
}
