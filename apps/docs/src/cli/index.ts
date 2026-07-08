#!/usr/bin/env node
/**
 * `docs` CLI — headless document conversions and analysis over files.
 * Uses only the framework-agnostic core (no editor, no server).
 */
import { readFileSync } from "node:fs";
import { extname } from "node:path";
import { Command } from "commander";
import chalk from "chalk";
import { Document } from "../model/document.js";
import { VERSION } from "../version.js";

type Format = "md" | "markdown" | "html" | "json" | "text" | "txt";

function loadFromFile(file: string): Document {
  const content = readFileSync(file, "utf8");
  const ext = extname(file).toLowerCase();
  if (ext === ".html" || ext === ".htm") return Document.fromHTML(content);
  if (ext === ".json") return Document.fromJSON(JSON.parse(content));
  return Document.fromMarkdown(content);
}

function render(doc: Document, to: Format): string {
  switch (to) {
    case "html":
      return doc.toHTML();
    case "json":
      return JSON.stringify(doc.toJSON(), null, 2);
    case "text":
    case "txt":
      return doc.toText();
    case "md":
    case "markdown":
    default:
      return doc.toMarkdown();
  }
}

const program = new Command();

program
  .name("docs")
  .description("Headless rich-text document toolkit (@hasna/docs)")
  .version(VERSION);

program
  .command("convert")
  .description("Convert a document file between Markdown, HTML, JSON, and text")
  .argument("<file>", "input file (.md, .html, or .json)")
  .option("-t, --to <format>", "output format: md | html | json | text", "md")
  .action((file: string, opts: { to: string }) => {
    const doc = loadFromFile(file);
    process.stdout.write(render(doc, opts.to as Format) + "\n");
  });

program
  .command("outline")
  .description("Print the heading outline of a document")
  .argument("<file>", "input file (.md, .html, or .json)")
  .action((file: string) => {
    const doc = loadFromFile(file);
    const entries = doc.outline();
    if (entries.length === 0) {
      process.stdout.write(chalk.dim("(no headings)\n"));
      return;
    }
    for (const entry of entries) {
      const indent = "  ".repeat(entry.level - 1);
      process.stdout.write(`${indent}${chalk.cyan(`h${entry.level}`)} ${entry.text}\n`);
    }
  });

program
  .command("stats")
  .description("Print word/character/reading-time statistics")
  .argument("<file>", "input file (.md, .html, or .json)")
  .action((file: string) => {
    const doc = loadFromFile(file);
    const s = doc.stats();
    const row = (label: string, value: string | number) =>
      `${chalk.dim(label.padEnd(16))} ${value}\n`;
    process.stdout.write(row("Words", s.words));
    process.stdout.write(row("Characters", s.characters));
    process.stdout.write(row("No spaces", s.charactersNoSpaces));
    process.stdout.write(row("Paragraphs", s.paragraphs));
    process.stdout.write(row("Headings", s.headings));
    process.stdout.write(row("Sentences", s.sentences));
    process.stdout.write(row("Reading time", `${s.readingTimeMinutes} min`));
  });

program.parseAsync(process.argv).catch((err: unknown) => {
  process.stderr.write(chalk.red(`docs: ${err instanceof Error ? err.message : String(err)}\n`));
  process.exitCode = 1;
});
