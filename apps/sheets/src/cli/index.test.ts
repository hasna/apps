import { afterEach, describe, expect, test } from "bun:test";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createWorkbook, serializeWorkbook, setCell } from "../index.js";

const cli = new URL("./index.ts", import.meta.url).pathname;
const temporaryDirectories: string[] = [];

async function runCli(args: string[]) {
  const child = Bun.spawn([process.execPath, "run", cli, ...args], {
    stdout: "pipe",
    stderr: "pipe",
  });
  const [stdout, stderr, exitCode] = await Promise.all([
    new Response(child.stdout).text(),
    new Response(child.stderr).text(),
    child.exited,
  ]);
  return { stdout, stderr, exitCode };
}

async function workbookFixture(): Promise<string> {
  const directory = await mkdtemp(join(tmpdir(), "sheets-cli-"));
  temporaryDirectories.push(directory);
  const file = join(directory, "workbook.json");
  const workbook = createWorkbook({
    id: "workbook-test",
    sheetName: "Q1: revenue, draft",
    rows: 12,
    columns: 8,
  });
  const sheet = workbook.sheets[0];
  if (!sheet) throw new Error("Fixture workbook has no sheet");
  sheet.id = "sheet-test";
  workbook.activeSheetId = sheet.id;
  setCell(workbook, "B1", "null");
  await writeFile(file, serializeWorkbook(workbook, true));
  return file;
}

afterEach(async () => {
  await Promise.all(
    temporaryDirectories.splice(0).map((directory) => rm(directory, { recursive: true })),
  );
});

describe("sheets CLI JSON output", () => {
  test("info --json preserves structured sheet metadata", async () => {
    const file = await workbookFixture();
    const result = await runCli(["--json", "info", file]);

    expect(result.exitCode).toBe(0);
    expect(JSON.parse(result.stdout)).toEqual({
      workbookId: "workbook-test",
      sheets: [
        {
          id: "sheet-test",
          name: "Q1: revenue, draft",
          rows: 12,
          columns: 8,
          cellCount: 1,
          active: true,
        },
      ],
    });
  });

  test("get --json distinguishes an empty cell from the string null", async () => {
    const file = await workbookFixture();
    const empty = await runCli(["--json", "get", file, "A1"]);
    const stringNull = await runCli(["--json", "get", file, "B1"]);

    expect(empty.exitCode).toBe(0);
    expect(stringNull.exitCode).toBe(0);
    expect(JSON.parse(empty.stdout)).toEqual({
      sheet: { id: "sheet-test", name: "Q1: revenue, draft" },
      cell: "A1",
      value: null,
    });
    expect(JSON.parse(stringNull.stdout)).toEqual({
      sheet: { id: "sheet-test", name: "Q1: revenue, draft" },
      cell: "B1",
      value: "null",
    });
  });

  test("human info and get output remains unchanged", async () => {
    const file = await workbookFixture();
    const info = await runCli(["info", file]);
    const empty = await runCli(["get", file, "A1"]);
    const stringNull = await runCli(["get", file, "B1"]);

    expect(info.stdout).toBe(
      "Workbook workbook-test (1 sheet(s))\n" +
        "  - Q1: revenue, draft: 12x8, 1 cell(s) [active]\n",
    );
    expect(empty.stdout).toBe("\n");
    expect(stringNull.stdout).toBe("null\n");
  });

  test("errors under --json are emitted on stderr", async () => {
    const actionError = await runCli(["--json", "info", "/does/not/exist.json"]);
    const parseError = await runCli(["--json", "get"]);

    for (const result of [actionError, parseError]) {
      expect(result.exitCode).not.toBe(0);
      expect(result.stdout).toBe("");
      expect(JSON.parse(result.stderr)).toEqual({
        error: expect.any(String),
      });
    }
  });
});
