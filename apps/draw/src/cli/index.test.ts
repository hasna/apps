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

describe("draw list filters (Sol-guided)", () => {
  let fboard: string;

  beforeAll(() => {
    fboard = join(dir, "filters.json");
    run("create", fboard);
    run("add", fboard, "--note", "alpha", "--color", "red", "--label", "work", "--pin");
    run("add", fboard, "--note", "beta", "--color", "blue", "--label", "home");
  });

  test("filters by label", () => {
    const r = run("list", fboard, "--label", "work");
    expect(r.code).toBe(0);
    expect(r.stdout).toContain("alpha");
    expect(r.stdout).not.toContain("beta");
  });

  test("filters by color", () => {
    const r = run("list", fboard, "--color", "blue");
    expect(r.stdout).toContain("beta");
    expect(r.stdout).not.toContain("alpha");
  });

  test("filters pinned to only pinned cards", () => {
    const r = run("list", fboard, "--pinned");
    expect(r.stdout).toContain("alpha");
    expect(r.stdout).not.toContain("beta");
  });

  test("archived filter shows nothing when nothing is archived", () => {
    const r = run("list", fboard, "--archived");
    expect(r.code).toBe(0);
    expect(r.stdout).toContain("(no cards)");
  });
});

describe("draw sort (Sol-guided)", () => {
  let sboard: string;

  beforeAll(() => {
    sboard = join(dir, "sort.json");
    run("create", sboard);
    run("add", sboard, "--note", "first");
    run("add", sboard, "--note", "second");
    run("add", sboard, "--note", "third");
  });

  test("created sort lists the newest card first", () => {
    const r = run("list", sboard, "--sort", "created");
    const lines = r.stdout.split("\n").filter((l) => l.trim().length > 0);
    expect(lines[0]).toContain("third");
    expect(lines[2]).toContain("first");
  });

  test("updated sort lists the most recently updated card first", () => {
    // Without an update verb the CLI can only bump updatedAt via add, so the
    // expected updated order is the add order (third, second, first).
    const r = run("list", sboard, "--sort", "updated");
    const lines = r.stdout.split("\n").filter((l) => l.trim().length > 0);
    expect(lines[0]).toContain("third");
    expect(lines[2]).toContain("first");
  });

  test("rejects an unknown sort", () => {
    const r = run("list", sboard, "--sort", "priority");
    expect(r.code).toBe(1);
    expect(r.stderr).toContain("invalid sort");
  });
});

describe("draw export edges (Sol-guided)", () => {
  test("exports a single card as JSON by exact id", () => {
    const id = readDoc().board.cards[0]!.id as string;
    const r = run("export", board, "--to", "json", "--card", id);
    expect(r.code).toBe(0);
    const card = JSON.parse(r.stdout);
    expect(card.id).toBe(id);
    expect(card.kind).toBe("note");
  });

  test("missing card id errors with card not found", () => {
    const r = run("export", board, "--to", "json", "--card", "does-not-exist");
    expect(r.code).toBe(1);
    expect(r.stderr).toContain("card not found");
  });

  test("ambiguous id prefix errors (Sol-guided)", () => {
    const crafted = join(dir, "ambiguous.json");
    writeFileSync(
      crafted,
      JSON.stringify({
        schema: "hasna.draw.board",
        version: 1,
        board: {
          id: "b1",
          cards: [
            {
              id: "abc123def",
              kind: "note",
              text: "one",
              color: "default",
              labels: [],
              pinned: false,
              archived: false,
              order: 0,
              createdAt: "2020-01-01T00:00:00.000Z",
              updatedAt: "2020-01-01T00:00:00.000Z",
            },
            {
              id: "abc456ghi",
              kind: "note",
              text: "two",
              color: "default",
              labels: [],
              pinned: false,
              archived: false,
              order: 1,
              createdAt: "2020-01-01T00:00:00.000Z",
              updatedAt: "2020-01-01T00:00:00.000Z",
            },
          ],
          createdAt: "2020-01-01T00:00:00.000Z",
          updatedAt: "2020-01-01T00:00:00.000Z",
        },
      }),
    );
    const r = run("export", crafted, "--to", "json", "--card", "abc");
    expect(r.code).toBe(1);
    expect(r.stderr).toContain("ambiguous card id prefix");
  });

  test("invalid output format errors (Sol-guided)", () => {
    const r = run("export", board, "--to", "yaml");
    expect(r.code).toBe(1);
    expect(r.stderr).toContain("invalid format");
  });

  test("a notes-only board refuses excalidraw export (Sol-guided)", () => {
    const notes = join(dir, "notes-only.json");
    run("create", notes);
    run("add", notes, "--note", "only a note");
    const r = run("export", notes, "--to", "excalidraw");
    expect(r.code).toBe(1);
    expect(r.stderr).toContain("no drawing card");
  });
});

describe("draw add --drawing without --scene (Sol-guided)", () => {
  test("adds an empty drawing card", () => {
    const d = join(dir, "drawing-only.json");
    run("create", d);
    const r = run("add", d, "--drawing");
    expect(r.code).toBe(0);
    expect(r.stdout).toContain("Added drawing card");
    const doc = JSON.parse(readFileSync(d, "utf8"));
    expect(doc.board.cards[0]!.kind).toBe("drawing");
    expect(doc.board.cards[0]!.scene.elements).toEqual([]);
  });
});

describe("draw missing board and empty board (Sol-guided)", () => {
  test("a missing board file exits 1 with the ENOENT error", () => {
    const r = run("list", join(dir, "does-not-exist.json"));
    expect(r.code).toBe(1);
    expect(r.stderr).toContain("ENOENT");
  });

  test("an empty board lists (no cards)", () => {
    const e = join(dir, "empty-list.json");
    run("create", e);
    const r = run("list", e);
    expect(r.code).toBe(0);
    expect(r.stdout).toContain("(no cards)");
  });

  test("an empty board stats prints zeros", () => {
    const e = join(dir, "empty-stats.json");
    run("create", e);
    const r = run("stats", e);
    expect(r.code).toBe(0);
    expect(r.stdout).toMatch(/Total\s+0/);
    expect(r.stdout).toMatch(/Notes\s+0/);
    expect(r.stdout).toMatch(/Drawings\s+0/);
  });
});
