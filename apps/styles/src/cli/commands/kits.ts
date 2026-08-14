import chalk from "chalk";
import type { Command } from "commander";
import { error, formatTable, jsonOut, pageHint, pageItems, truncateText } from "../../lib/format.js";
import type { StyleKit } from "../../lib/kits.js";

const isTTY = (process.stdout.isTTY ?? false) && (process.stdin.isTTY ?? false);

export function registerKitsCommands(program: Command) {
  const kitsCmd = program.command("kits").description("Manage saved style kits");

  kitsCmd
    .command("list")
    .description("List all saved style kits")
    .option("-s, --search <query>", "Search by name, URL, or tags")
    .option("--limit <n>", "Max kits to show in compact output")
    .option("--cursor <n>", "Zero-based offset for compact output pagination")
    .option("-v, --verbose", "Show token counts and tags")
    .option("--json", "Output full JSON")
    .action(async (opts: { search?: string; limit?: string; cursor?: string; verbose?: boolean; json?: boolean }) => {
      const { listKits } = await import("../../lib/kits.js");
      const kits = listKits({ search: opts.search });
      if (opts.json) { jsonOut(kits); return; }
      if (!kits.length) { console.log(chalk.dim("No kits saved yet. Run: styles extract <url> --save --name <name>")); return; }

      const page = pageItems(kits, { limit: opts.limit, cursor: opts.cursor, defaultLimit: 20, maxLimit: 100 });
      console.log(chalk.bold(`Style Kits (${kits.length})`));
      console.log(formatTable(page.items, [
        { header: "ID", value: (k) => k.id.slice(0, 8), maxWidth: 10 },
        { header: "Name", value: (k) => k.name, maxWidth: 24 },
        { header: "URL", value: (k) => k.url, maxWidth: 42 },
        { header: "Tokens", value: compactKitTokenCounts, maxWidth: 24 },
        ...(opts.verbose ? [{ header: "Tags", value: (k: StyleKit) => k.tags.join(", "), maxWidth: 36 }] : []),
      ]));
      console.log(chalk.dim(pageHint(page, "use `styles kits get <id>` for details")));
    });

  kitsCmd
    .command("get <id>")
    .description("Show details of a saved kit")
    .option("-v, --verbose", "Show sample colors and token values")
    .option("--json", "Output full JSON")
    .action(async (id: string, opts: { verbose?: boolean; json?: boolean }) => {
      const { getKit } = await import("../../lib/kits.js");
      const kit = getKit(id);
      if (!kit) error(`Kit not found: ${id}`);
      if (opts.json) { jsonOut(kit); return; }
      console.log(chalk.bold(`\n  ${kit!.name}`));
      console.log(`  URL:      ${kit!.url}`);
      console.log(`  Saved:    ${new Date(kit!.createdAt).toLocaleString()}`);
      console.log(`  Colors:   ${kit!.tokens.colors.length}`);
      console.log(`  Fonts:    ${kit!.tokens.typography.fontFamilies.join(", ") || "—"}`);
      console.log(`  Radii:    ${kit!.tokens.borderRadius.join(", ") || "—"}`);
      console.log(`  Shadows:  ${kit!.tokens.shadows.length}`);
      if (kit!.tags.length) console.log(`  Tags:     ${kit!.tags.join(", ")}`);
      if (opts.verbose) {
        const colors = kit!.tokens.colors.slice(0, 8).map((c) => c.name ? `${c.name}:${c.value}` : c.value);
        if (colors.length) console.log(`  Top colors: ${truncateText(colors.join(", "), 120)}`);
      }
      console.log(chalk.dim("  Use --json for full tokens/raw extraction data."));
    });

  kitsCmd
    .command("delete <id>")
    .description("Delete a saved kit")
    .option("--json", "Output JSON")
    .action(async (id: string, opts: { json?: boolean }) => {
      const { deleteKit } = await import("../../lib/kits.js");
      deleteKit(id);
      if (opts.json) jsonOut({ ok: true });
      else console.log(chalk.green(`  Deleted kit ${id}`));
    });

  kitsCmd
    .command("export <id>")
    .description("Export a kit as a config")
    .option("-f, --format <format>", "Format: shadcn|tailwind|css-vars|mui|radix", "shadcn")
    .option("-o, --output <file>", "Write to file")
    .option("--json", "Output config and metadata as JSON")
    .action(async (id: string, opts: { format?: string; output?: string; json?: boolean }) => {
      const { getKit } = await import("../../lib/kits.js");
      const { transform } = await import("../../lib/transformer.js");
      const kit = getKit(id);
      if (!kit) error(`Kit not found: ${id}`);
      const result = transform(kit!.tokens, (opts.format ?? "shadcn") as Parameters<typeof transform>[1]);
      if (opts.output) {
        const { writeFileSync } = await import("fs");
        writeFileSync(opts.output, result.code, "utf-8");
        if (isTTY) console.log(chalk.green(`Written to ${opts.output}`));
      } else {
        if (opts.json) jsonOut({ code: result.code, config: result.config, format: opts.format ?? "shadcn" });
        else console.log(result.code);
      }
    });

  kitsCmd
    .command("figma <id>")
    .description("Push a kit's tokens to Figma as Variables")
    .option("--file-key <key>", "Figma file key (from the URL)")
    .option("--token <token>", "Figma personal access token (or set FIGMA_ACCESS_TOKEN env var)")
    .action(async (id: string, opts: { fileKey?: string; token?: string }) => {
      const { getKit } = await import("../../lib/kits.js");
      const { publishToFigma } = await import("../../lib/figma.js");
      const kit = getKit(id);
      if (!kit) error(`Kit not found: ${id}`);
      const fileKey = opts.fileKey ?? process.env["FIGMA_FILE_KEY"];
      const token = opts.token ?? process.env["FIGMA_ACCESS_TOKEN"];
      if (!fileKey) error("--file-key or FIGMA_FILE_KEY env var required");
      if (!token) error("--token or FIGMA_ACCESS_TOKEN env var required");
      if (isTTY) process.stdout.write(chalk.dim("  Publishing to Figma..."));
      const result = await publishToFigma(kit!.tokens, fileKey!, token!);
      if (isTTY) {
        if (result.success) console.log(chalk.green(` ✔ ${result.message}`));
        else console.log(chalk.red(` ✖ ${result.message}`));
      } else jsonOut(result);
    });

  kitsCmd
    .command("diff <idA> <idB>")
    .description("Compare two saved kits and show what changed")
    .option("--json", "Output full JSON")
    .action(async (idA: string, idB: string, opts: { json?: boolean }) => {
      const { getKit } = await import("../../lib/kits.js");
      const { diffTokens } = await import("../../lib/diff.js");
      const a = getKit(idA);
      const b = getKit(idB);
      if (!a) error(`Kit not found: ${idA}`);
      if (!b) error(`Kit not found: ${idB}`);
      const diff = diffTokens(a!.tokens, b!.tokens);
      if (opts.json) { jsonOut(diff); return; }
      console.log(chalk.bold(`\n  ${a!.name} → ${b!.name}\n`));
      console.log(chalk.dim(`  ${diff.summary.description} (${diff.summary.totalChanges} total changes)\n`));
      if (diff.colors.added.length) console.log(chalk.green(`  +${diff.colors.added.length} colors: `) + diff.colors.added.slice(0, 5).map((c) => c.value).join(", "));
      if (diff.colors.removed.length) console.log(chalk.red(`  -${diff.colors.removed.length} colors: `) + diff.colors.removed.slice(0, 5).map((c) => c.value).join(", "));
      if (diff.typography.fontFamilies.added.length) console.log(chalk.green("  +fonts: ") + diff.typography.fontFamilies.added.join(", "));
      if (diff.typography.fontFamilies.removed.length) console.log(chalk.red("  -fonts: ") + diff.typography.fontFamilies.removed.join(", "));
      if (diff.borderRadius.added.length) console.log(chalk.green("  +radii: ") + diff.borderRadius.added.join(", "));
      if (diff.borderRadius.removed.length) console.log(chalk.red("  -radii: ") + diff.borderRadius.removed.join(", "));
      if (diff.shadows.added.length) console.log(chalk.green(`  +${diff.shadows.added.length} shadows`));
      if (diff.shadows.removed.length) console.log(chalk.red(`  -${diff.shadows.removed.length} shadows`));
    });

  kitsCmd
    .command("save-as-profile <id> <name>")
    .description("Convert a saved kit into a reusable style profile")
    .option("--json", "Output full JSON")
    .action(async (id: string, name: string, opts: { json?: boolean }) => {
      const { getKit, kitToProfile } = await import("../../lib/kits.js");
      const { createProfile } = await import("../../lib/profiles.js");
      const kit = getKit(id);
      if (!kit) error(`Kit not found: ${id}`);
      const profileInput = kitToProfile(kit!, name);
      const profile = createProfile(profileInput);
      if (opts.json) jsonOut(profile);
      else console.log(chalk.green(`  Created profile "${profile.name}" (${profile.id})`));
    });
}

function compactKitTokenCounts(kit: StyleKit): string {
  return [
    `${kit.tokens.colors.length} colors`,
    `${kit.tokens.typography.fontFamilies.length} fonts`,
    `${kit.tokens.shadows.length} shadows`,
  ].join(", ");
}
