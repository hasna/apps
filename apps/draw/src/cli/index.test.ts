/**
 * End to end tests for the `draw` CLI. Each case runs the CLI as a subprocess
 * against a real board file in a temp directory, exercising the full
 * create / add / list / export / stats surface plus the error paths. Color is
 * disabled so stdout assertions are stable regardless of the host environment.
 */
import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

const CLI = join(import.meta.dir, "index.ts");

let dir: string;
let board: string;

interface RunResult {
  code: number | null;
  stdout: string;
  stderr: string;
}

function run(...args: string[]): RunResult {
  const res = Bun.spawnSync([process.execPath, CLI, ...args], {
    cwd: dir,
    env: { ...process.env, NO_COLOR: "1", FORCE_COLOR: "0" },
  });
  return {
    code: res.exitCode,
    stdout: res.stdout.toString(),
    stderr: res.stderr.toString(),
  };
}

function readDoc(): { schema: string; version: number; board: { title?: string; cards: any[] } } {
  return JSON.parse(readFileSync(board, "utf8"));
}

beforeAll(() => {
  dir = mkdtempSync(join(tmpdir(), "draw-cli-"));
  board = join(dir, "board.json");
});

afterAll(() => {
  rmSync(dir, { recursive: true, force: true });
});

describe("draw create", () => {
  test("writes a versioned envelope to a file", () => {
    const r = run("create", board, "--title", "My Board");
    expect(r.code).toBe(0);
    const doc = readDoc();
    expect(doc.schema).toBe("hasna.draw.board");
    expect(doc.version).toBe(1);
    expect(doc.board.title).toBe("My Board");
    expect(doc.board.cards).toEqual([]);
  });

  test("writes to stdout when no file is given", () => {
    const r = run("create");
    expect(r.code).toBe(0);
    const doc = JSON.parse(r.stdout);
    expect(doc.schema).toBe("hasna.draw.board");
    expect(doc.board.cards).toEqual([]);
  });
});

describe("draw add", () => {
  test("adds a note card with all options", () => {
    const r = run(
      "add",
      board,
      "--note",
      "buy milk",
      "--title",
      "Groceries",
      "--color",
      "yellow",
      "--label",
      "home",
      "--label",
      "urgent",
      "--pin",
    );
    expect(r.code).toBe(0);
    expect(r.stdout).toContain("Added note card");
    const cards = readDoc().board.cards;
    expect(cards.length).toBe(1);
    expect(cards[0]).toMatchObject({
      kind: "note",
      text: "buy milk",
      title: "Groceries",
      color: "yellow",
      labels: ["home", "urgent"],
      pinned: true,
      order: 0,
    });
  });

  test("adds a drawing card importing an Excalidraw scene", () => {
    const scenePath = join(dir, "scene.excalidraw.json");
    const excalidraw = {
      type: "excalidraw",
      version: 2,
      source: "test",
      elements: [
        {
          id: "e1",
          type: "freedraw",
          x: 0,
          y: 0,
          width: 10,
          height: 10,
          points: [
            [0, 0],
            [10, 10],
          ],
          strokeColor: "#ff0000",
          strokeWidth: 2,
          pressures: [0.5, 0.9],
          opacity: 80,
        },
        { id: "e2", type: "rectangle", x: 5, y: 5, width: 20, height: 20 },
        { id: "e3", type: "image", x: 0, y: 0, width: 1, height: 1 },
      ],
      appState: { viewBackgroundColor: "#fafafa" },
      files: {},
    };
    writeFileSync(scenePath, JSON.stringify(excalidraw));

    const r = run("add", board, "--scene", scenePath, "--title", "Sketch");
    expect(r.code).toBe(0);
    expect(r.stdout).toContain("Added drawing card");

    const cards = readDoc().board.cards;
    expect(cards.length).toBe(2);
    const draw = cards[1];
    expect(draw.kind).toBe("drawing");
    expect(draw.title).toBe("Sketch");
    expect(draw.scene.background).toBe("#fafafa");
    // The unknown "image" element is dropped; freedraw + rectangle survive.
    expect(draw.scene.elements.length).toBe(2);
    expect(draw.scene.elements[0].type).toBe("freedraw");
    expect(draw.scene.elements[0].points).toEqual([
      [0, 0],
      [10, 10],
    ]);
    expect(draw.scene.elements[0].pressures).toEqual([0.5, 0.9]);
    expect(draw.scene.elements[1].type).toBe("rectangle");
  });

  test("errors when neither --note nor --drawing is given", () => {
    const r = run("add", board);
    expect(r.code).toBe(1);
    expect(r.stderr).toContain("nothing to add");
  });

  test("errors on an invalid color", () => {
    const r = run("add", board, "--note", "x", "--color", "chartreuse");
    expect(r.code).toBe(1);
    expect(r.stderr.toLowerCase()).toContain("invalid color");
  });
});

describe("draw list", () => {
  test("lists every card by default", () => {
    const r = run("list", board);
    expect(r.code).toBe(0);
    expect(r.stdout).toContain("Groceries");
    expect(r.stdout).toContain("buy milk");
    expect(r.stdout).toContain("Sketch");
    expect(r.stdout).toContain("PIN");
  });

  test("filters by kind", () => {
    const r = run("list", board, "--kind", "drawing");
    expect(r.code).toBe(0);
    expect(r.stdout).toContain("Sketch");
    expect(r.stdout).not.toContain("buy milk");
  });

  test("filters by search term", () => {
    const r = run("list", board, "--search", "milk");
    expect(r.code).toBe(0);
    expect(r.stdout).toContain("buy milk");
    expect(r.stdout).not.toContain("Sketch");
  });

  test("errors on an invalid kind", () => {
    const r = run("list", board, "--kind", "sticky");
    expect(r.code).toBe(1);
    expect(r.stderr.toLowerCase()).toContain("invalid kind");
  });
});

describe("draw export", () => {
  test("exports the whole board as JSON", () => {
    const r = run("export", board, "--to", "json");
    expect(r.code).toBe(0);
    const doc = JSON.parse(r.stdout);
    expect(doc.schema).toBe("hasna.draw.board");
    expect(doc.board.cards.length).toBe(2);
  });

  test("exports the first drawing card as an Excalidraw file", () => {
    const r = run("export", board, "--to", "excalidraw");
    expect(r.code).toBe(0);
    const ex = JSON.parse(r.stdout);
    expect(ex.type).toBe("excalidraw");
    expect(ex.version).toBe(2);
    expect(ex.source).toBe("@hasna/draw");
    expect(ex.elements.length).toBe(2);
    expect(ex.elements[0].type).toBe("freedraw");
  });

  test("refuses to export a note card as Excalidraw", () => {
    const noteId = readDoc().board.cards.find((c) => c.kind === "note")?.id as string;
    const r = run("export", board, "--to", "excalidraw", "--card", noteId);
    expect(r.code).toBe(1);
    expect(r.stderr).toContain("not a drawing");
  });
});

describe("draw stats", () => {
  test("prints board counts", () => {
    const r = run("stats", board);
    expect(r.code).toBe(0);
    expect(r.stdout).toContain("Total");
    expect(r.stdout).toMatch(/Notes\s+1/);
    expect(r.stdout).toMatch(/Drawings\s+1/);
    expect(r.stdout).toMatch(/yellow\s+1/);
  });
});

describe("draw --version", () => {
  test("prints the package version", () => {
    const r = run("--version");
    expect(r.code).toBe(0);
    expect(r.stdout.trim()).toBe("0.1.0");
  });
});
