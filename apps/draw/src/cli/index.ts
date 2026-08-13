#!/usr/bin/env node
/**
 * `draw` CLI — headless board operations over board JSON files.
 *
 * Uses only the framework agnostic core (no React, no server): it can create a
 * board, add note and drawing cards, list and filter cards, export to JSON or
 * Excalidraw, and print statistics. Board files are the versioned
 * `hasna.draw.board` envelope produced by {@link serializeBoard}.
 */
import { readFileSync, writeFileSync } from "node:fs";
import { Command } from "commander";
import chalk from "chalk";
import { BoardModel, createBoard } from "../model/board.js";
import { CARD_COLORS, isCardColor } from "../model/card.js";
import { createScene } from "../model/scene.js";
import { fromExcalidraw, toExcalidraw } from "../serialize/excalidraw.js";
import { VERSION } from "../version.js";
import type { Card, CardColor, CardKind, CardQuery, CardSort } from "../types/index.js";

// --- Helpers ---------------------------------------------------------------

function readBoard(file: string): BoardModel {
  return BoardModel.fromJSON(readFileSync(file, "utf8"));
}

function writeBoard(file: string, model: BoardModel): void {
  writeFileSync(file, model.serialize(true) + "\n");
}

function shortId(id: string): string {
  return id.length > 8 ? id.slice(0, 8) : id;
}

function parseColor(value: string | undefined): CardColor {
  if (value === undefined) return "default";
  if (!isCardColor(value)) {
    throw new Error(`invalid color "${value}"; expected one of: ${CARD_COLORS.join(", ")}`);
  }
  return value;
}

function parseKind(value: string | undefined): CardKind | undefined {
  if (value === undefined) return undefined;
  if (value !== "note" && value !== "drawing") {
    throw new Error(`invalid kind "${value}"; expected "note" or "drawing"`);
  }
  return value;
}

function parseSort(value: string | undefined): CardSort {
  if (value === undefined) return "order";
  if (value !== "order" && value !== "updated" && value !== "created") {
    throw new Error(`invalid sort "${value}"; expected "order", "updated", or "created"`);
  }
  return value;
}

/** Resolve a card by exact id or a unique id prefix. */
function findCard(model: BoardModel, ref: string): Card | undefined {
  const cards = model.cards;
  const exact = cards.find((c) => c.id === ref);
  if (exact) return exact;
  const prefixed = cards.filter((c) => c.id.startsWith(ref));
  if (prefixed.length > 1) throw new Error(`ambiguous card id prefix "${ref}"`);
  return prefixed[0];
}

/** A one line snippet for the list table. */
function snippet(card: Card): string {
  if (card.kind === "drawing") {
    const count = card.scene?.elements.length ?? 0;
    return chalk.dim(`<drawing, ${count} element${count === 1 ? "" : "s"}>`);
  }
  const first = (card.text ?? "").split("\n").find((line) => line.trim().length > 0) ?? "";
  return first.length > 48 ? first.slice(0, 47) + "…" : first;
}

// --- Program ---------------------------------------------------------------

const program = new Command();

program
  .name("draw")
  .description("Headless board toolkit for notes and freehand drawings (@hasna/draw)")
  .version(VERSION);

program
  .command("create")
  .description("Create a new empty board and write it to a file (or stdout)")
  .argument("[file]", "output file; writes to stdout when omitted")
  .option("-t, --title <title>", "board title")
  .action((file: string | undefined, opts: { title?: string }) => {
    const model = createBoard(opts.title !== undefined ? { title: opts.title } : {});
    if (file) {
      writeBoard(file, model);
      process.stdout.write(chalk.green(`Created board ${shortId(model.id)} at ${file}\n`));
    } else {
      process.stdout.write(model.serialize(true) + "\n");
    }
  });

program
  .command("add")
  .description("Add a note or drawing card to a board file")
  .argument("<file>", "board file to update")
  .option("-n, --note <text>", "add a note card with this text")
  .option("-d, --drawing", "add an (empty) drawing card")
  .option("-t, --title <title>", "card title")
  .option("-c, --color <color>", "card color", "default")
  .option("-l, --label <label...>", "labels (repeatable)")
  .option("-p, --pin", "pin the card")
  .option("-s, --scene <file>", "import a drawing scene from an Excalidraw JSON file (also adds a drawing card)")
  .action(
    (
      file: string,
      opts: {
        note?: string;
        drawing?: boolean;
        title?: string;
        color?: string;
        label?: string[];
        pin?: boolean;
        scene?: string;
      },
    ) => {
      const model = readBoard(file);
      const color = parseColor(opts.color);
      const labels = opts.label ?? [];
      const pinned = Boolean(opts.pin);
      const isDrawing = Boolean(opts.drawing) || opts.scene !== undefined;

      if (isDrawing) {
        const scene = opts.scene !== undefined
          ? fromExcalidraw(readFileSync(opts.scene, "utf8"))
          : createScene();
        model.addDrawing({
          scene,
          color,
          labels,
          pinned,
          ...(opts.title !== undefined ? { title: opts.title } : {}),
        });
      } else if (opts.note !== undefined) {
        model.addNote({
          text: opts.note,
          color,
          labels,
          pinned,
          ...(opts.title !== undefined ? { title: opts.title } : {}),
        });
      } else {
        throw new Error("nothing to add: pass --note <text> or --drawing (optionally with --scene <file>)");
      }

      const added = model.cards.at(-1);
      writeBoard(file, model);
      process.stdout.write(
        chalk.green(`Added ${added?.kind ?? "card"} card ${added ? shortId(added.id) : ""}\n`),
      );
    },
  );

program
  .command("list")
  .description("List cards in a board, with optional filters")
  .argument("<file>", "board file to read")
  .option("-k, --kind <kind>", "filter by kind: note | drawing")
  .option("-c, --color <color>", "filter by color")
  .option("-l, --label <label>", "filter by label")
  .option("-p, --pinned", "only pinned cards")
  .option("-a, --archived", "only archived cards")
  .option("-s, --search <term>", "match title and note text")
  .option("--sort <sort>", "sort order: order | updated | created", "order")
  .action(
    (
      file: string,
      opts: {
        kind?: string;
        color?: string;
        label?: string;
        pinned?: boolean;
        archived?: boolean;
        search?: string;
        sort?: string;
      },
    ) => {
      const model = readBoard(file);
      const query: CardQuery = {};
      const kind = parseKind(opts.kind);
      if (kind !== undefined) query.kind = kind;
      if (opts.color !== undefined) query.color = parseColor(opts.color);
      if (opts.label !== undefined) query.label = opts.label;
      if (opts.pinned) query.pinned = true;
      if (opts.archived) query.archived = true;
      if (opts.search !== undefined) query.search = opts.search;

      const cards = model.query(query, parseSort(opts.sort));
      if (cards.length === 0) {
        process.stdout.write(chalk.dim("(no cards)\n"));
        return;
      }
      for (const card of cards) {
        const pin = card.pinned ? chalk.yellow("PIN") : "   ";
        const kindTag = chalk.cyan(card.kind.padEnd(7));
        const colorTag = chalk.dim(card.color.padEnd(7));
        const labels = card.labels.length > 0 ? chalk.dim(` [${card.labels.join(", ")}]`) : "";
        const title = card.title ? chalk.bold(card.title) + " " : "";
        process.stdout.write(
          `${String(card.order).padStart(2)} ${chalk.dim(shortId(card.id))} ${pin} ${kindTag} ${colorTag} ${title}${snippet(card)}${labels}\n`,
        );
      }
    },
  );

program
  .command("export")
  .description("Export a board to JSON, or a drawing card to an Excalidraw file")
  .argument("<file>", "board file to read")
  .option("-t, --to <format>", "output format: json | excalidraw", "json")
  .option("--card <id>", "export a single card by id (or unique id prefix)")
  .action((file: string, opts: { to?: string; card?: string }) => {
    const model = readBoard(file);
    const to = opts.to ?? "json";

    if (to === "excalidraw") {
      let card: Card | undefined;
      if (opts.card !== undefined) {
        card = findCard(model, opts.card);
        if (!card) throw new Error(`card not found: ${opts.card}`);
        if (card.kind !== "drawing") throw new Error(`card ${opts.card} is not a drawing`);
      } else {
        card = model.cards.find((c) => c.kind === "drawing");
        if (!card) throw new Error("board has no drawing card to export; pass --card <id>");
      }
      const scene = card.scene ?? createScene();
      process.stdout.write(JSON.stringify(toExcalidraw(scene), null, 2) + "\n");
      return;
    }

    if (to === "json") {
      if (opts.card !== undefined) {
        const card = findCard(model, opts.card);
        if (!card) throw new Error(`card not found: ${opts.card}`);
        process.stdout.write(JSON.stringify(card, null, 2) + "\n");
      } else {
        process.stdout.write(model.serialize(true) + "\n");
      }
      return;
    }

    throw new Error(`invalid format "${to}"; expected "json" or "excalidraw"`);
  });

program
  .command("stats")
  .description("Print card counts for a board")
  .argument("<file>", "board file to read")
  .action((file: string) => {
    const model = readBoard(file);
    const s = model.stats();
    const row = (label: string, value: string | number) =>
      `${chalk.dim(label.padEnd(14))} ${value}\n`;
    process.stdout.write(row("Total", s.total));
    process.stdout.write(row("Notes", s.notes));
    process.stdout.write(row("Drawings", s.drawings));
    process.stdout.write(row("Pinned", s.pinned));
    process.stdout.write(row("Archived", s.archived));
    for (const color of CARD_COLORS) {
      const n = s.colors[color];
      if (n > 0) process.stdout.write(row(`  ${color}`, n));
    }
  });

program.parseAsync(process.argv).catch((err: unknown) => {
  process.stderr.write(chalk.red(`draw: ${err instanceof Error ? err.message : String(err)}\n`));
  process.exitCode = 1;
});
