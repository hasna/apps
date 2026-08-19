import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { DATASETS_DB_PATH_ENV, DATASETS_HOME_ENV } from "../storage.js";

const repoRoot = join(import.meta.dir, "..", "..");
const cliEntry = join(repoRoot, "src", "cli", "index.ts");
const ENV_KEYS = [DATASETS_HOME_ENV, DATASETS_DB_PATH_ENV] as const;
const savedEnv = new Map<string, string | undefined>();
let testDir: string | undefined;

for (const key of ENV_KEYS) savedEnv.set(key, process.env[key]);

beforeEach(() => {
  testDir = mkdtempSync(join(tmpdir(), "datasets-cli-"));
  process.env[DATASETS_HOME_ENV] = testDir;
  process.env[DATASETS_DB_PATH_ENV] = join(testDir, "datasets.db");
});

afterEach(() => {
  for (const key of ENV_KEYS) {
    const value = savedEnv.get(key);
    if (value === undefined) delete process.env[key];
    else process.env[key] = value;
  }
  if (testDir) rmSync(testDir, { recursive: true, force: true });
  testDir = undefined;
});

describe("datasets CLI", () => {
  test("registers, ingests, previews, and emits project panel JSON", async () => {
    const fixtureDir = join(testDir!, "fixtures");
    mkdirSync(fixtureDir, { recursive: true });
    const csvPath = join(fixtureDir, "banks.csv");
    writeFileSync(csvPath, "Bank,Status,Formula\nMirabaud,research,=cmd\nUBS,research,+cmd\n");

    const source = await runJson(["sources", "add", csvPath, "--name", "Swiss bank CSV", "--project", "swiss-bank-account", "--json"]);
    expect(source.kind).toBe("csv");

    const result = await runJson(["ingest", source.id, "--name", "Bank shortlist", "--project", "swiss-bank-account", "--classification", "public", "--json"]);
    expect(result.dataset.rowCount).toBe(2);

    const preview = await runJson(["preview", "bank-shortlist", "--project", "swiss-bank-account", "--limit", "2", "--json"]);
    expect(preview.rows[0]).toMatchObject({ bank: "Mirabaud", formula: "'=cmd" });
    expect(preview.rows[1]).toMatchObject({ bank: "UBS", formula: "'+cmd" });

    const panel = await runJson(["project-panel", "--project", "swiss-bank-account", "--contract"]);
    expect(panel.provider.sourcePackage).toBe("@hasna/datasets");
    expect(panel.metrics.find((metric: { id: string }) => metric.id === "datasets")?.value).toBe(1);

    const render = await runJson(["render", "bank-shortlist", "--project", "swiss-bank-account"]);
    expect(render.elements.root.type).toBe("Table");
  });

  test("rejects invalid classification values", async () => {
    const fixtureDir = join(testDir!, "fixtures");
    mkdirSync(fixtureDir, { recursive: true });
    const jsonPath = join(fixtureDir, "rows.json");
    writeFileSync(jsonPath, JSON.stringify([{ id: "row-1" }]));

    const proc = Bun.spawn({
      cmd: ["bun", "run", cliEntry, "ingest", jsonPath, "--name", "Bad", "--classification", "banana", "--json"],
      cwd: repoRoot,
      env: {
        ...process.env,
        [DATASETS_HOME_ENV]: process.env[DATASETS_HOME_ENV]!,
        [DATASETS_DB_PATH_ENV]: process.env[DATASETS_DB_PATH_ENV]!,
      },
      stdout: "pipe",
      stderr: "pipe",
    });
    const [stderr, exitCode] = await Promise.all([
      new Response(proc.stderr).text(),
      proc.exited,
    ]);

    expect(exitCode).not.toBe(0);
    expect(stderr).toContain("Invalid enum value");
  });

  test("ingests project-style JSON records wrappers", async () => {
    const fixtureDir = join(testDir!, "fixtures");
    mkdirSync(fixtureDir, { recursive: true });
    const jsonPath = join(fixtureDir, "records-wrapper.json");
    writeFileSync(jsonPath, JSON.stringify({
      schema_version: "hasna.project.dataset.v1",
      dataset: { slug: "records-wrapper" },
      records: [
        { id: "BANK-MIRABAUD", status: "candidate" },
        { id: "BANK-IBS", status: "needs-verification" },
      ],
    }));

    const result = await runJson([
      "ingest",
      jsonPath,
      "--name",
      "Records Wrapper",
      "--project",
      "swiss-bank-account",
      "--classification",
      "private",
      "--json",
    ]);

    expect(result.dataset.rowCount).toBe(2);
    expect(Object.keys(result.dataset.schema.properties ?? {})).toEqual(["id", "status"]);
  });

  test("parses quoted CSV commas, escaped quotes, embedded newlines, and CRLF endings", async () => {
    const fixtureDir = join(testDir!, "fixtures");
    mkdirSync(fixtureDir, { recursive: true });
    const csvPath = join(fixtureDir, "tricky.csv");
    writeFileSync(csvPath, 'name,note\r\n"Bank, A","He said ""hi"""\r\n"line1\nline2",x\r\n');

    const result = await runJson(["ingest", csvPath, "--name", "Tricky", "--classification", "public", "--json"]);
    const preview = await runJson(["preview", result.dataset.slug, "--limit", "10", "--json"]);

    expect(preview.rows).toEqual([
      { name: "Bank, A", note: 'He said "hi"' },
      { name: "line1\nline2", note: "x" },
    ]);
  });

  test("drops blank CSV rows, falls back for empty headers, and neutralizes formula cells", async () => {
    const fixtureDir = join(testDir!, "fixtures");
    mkdirSync(fixtureDir, { recursive: true });
    const csvPath = join(fixtureDir, "dirty.csv");
    writeFileSync(csvPath, "name,,Bank Name,a,b,c,d\nx,y,z,=cmd,+cmd,-cmd,@cmd\n\n,,  \nq,r,s,plain,t,u,v\n");

    const result = await runJson(["ingest", csvPath, "--name", "Dirty", "--classification", "public", "--json"]);
    const preview = await runJson(["preview", result.dataset.slug, "--limit", "10", "--json"]);

    expect(preview.rows).toEqual([
      { name: "x", dataset: "y", bank_name: "z", a: "'=cmd", b: "'+cmd", c: "'-cmd", d: "'@cmd" },
      { name: "q", dataset: "r", bank_name: "s", a: "plain", b: "t", c: "u", d: "v" },
    ]);
  });

  test("ingests a headers-only CSV as an empty dataset", async () => {
    const fixtureDir = join(testDir!, "fixtures");
    mkdirSync(fixtureDir, { recursive: true });
    const csvPath = join(fixtureDir, "headers-only.csv");
    writeFileSync(csvPath, "a,b\n");

    const result = await runJson(["ingest", csvPath, "--name", "Headers Only", "--classification", "public", "--json"]);

    expect(result.dataset.rowCount).toBe(0);
  });

  test("ingests JSONL files and bare JSON objects as single-row datasets", async () => {
    const fixtureDir = join(testDir!, "fixtures");
    mkdirSync(fixtureDir, { recursive: true });
    const jsonlPath = join(fixtureDir, "rows.jsonl");
    writeFileSync(jsonlPath, '{"id":"j1","v":1}\n{"id":"j2","v":2}\n');
    const objectPath = join(fixtureDir, "bare.json");
    writeFileSync(objectPath, '{"id":"only","v":1}\n');

    const jsonl = await runJson(["ingest", jsonlPath, "--name", "Jsonl Rows", "--classification", "public", "--json"]);
    const bare = await runJson(["ingest", objectPath, "--name", "Bare Object", "--classification", "public", "--json"]);

    expect(jsonl.dataset.rowCount).toBe(2);
    expect(bare.dataset.rowCount).toBe(1);
  });

  test("fails the ingest when a JSONL line is malformed", async () => {
    const fixtureDir = join(testDir!, "fixtures");
    mkdirSync(fixtureDir, { recursive: true });
    const jsonlPath = join(fixtureDir, "bad.jsonl");
    writeFileSync(jsonlPath, '{"id":"a"}\nnot-json\n{"id":"b"}\n');

    const proc = Bun.spawn({
      cmd: ["bun", "run", cliEntry, "ingest", jsonlPath, "--name", "Bad", "--classification", "public", "--json"],
      cwd: repoRoot,
      env: {
        ...process.env,
        [DATASETS_HOME_ENV]: process.env[DATASETS_HOME_ENV]!,
        [DATASETS_DB_PATH_ENV]: process.env[DATASETS_DB_PATH_ENV]!,
      },
      stdout: "pipe",
      stderr: "pipe",
    });
    const [stderr, exitCode] = await Promise.all([
      new Response(proc.stderr).text(),
      proc.exited,
    ]);

    expect(exitCode).not.toBe(0);
    expect(stderr).toContain("Unexpected");
  });

  test("fails closed on unredacted previews without the allow env var and opens with it", async () => {
    const fixtureDir = join(testDir!, "fixtures");
    mkdirSync(fixtureDir, { recursive: true });
    const jsonPath = join(fixtureDir, "rows.json");
    writeFileSync(jsonPath, JSON.stringify([{ id: "p1", tax_id: "secret" }]));
    await runJson(["ingest", jsonPath, "--name", "Private", "--classification", "private", "--json"]);

    const denied = Bun.spawn({
      cmd: ["bun", "run", cliEntry, "preview", "private", "--unredacted", "--json"],
      cwd: repoRoot,
      env: {
        ...process.env,
        [DATASETS_HOME_ENV]: process.env[DATASETS_HOME_ENV]!,
        [DATASETS_DB_PATH_ENV]: process.env[DATASETS_DB_PATH_ENV]!,
      },
      stdout: "pipe",
      stderr: "pipe",
    });
    const [deniedStderr, deniedExit] = await Promise.all([
      new Response(denied.stderr).text(),
      denied.exited,
    ]);
    expect(deniedExit).not.toBe(0);
    expect(deniedStderr).toContain("OPEN_DATASETS_ALLOW_SENSITIVE_READS");

    const allowed = await runJson(["preview", "private", "--unredacted", "--json"], {
      OPEN_DATASETS_ALLOW_SENSITIVE_READS: "1",
    });
    expect(allowed.rows[0]).toMatchObject({ id: "p1", tax_id: "secret" });
  });

  test("builds a react-flow canvas scoped to the slugified project and rejects unknown renderers", async () => {
    const fixtureDir = join(testDir!, "fixtures");
    mkdirSync(fixtureDir, { recursive: true });
    const jsonPath = join(fixtureDir, "rows.json");
    writeFileSync(jsonPath, JSON.stringify([{ id: "p1" }]));
    await runJson(["ingest", jsonPath, "--name", "Canvas", "--project", "alpha", "--classification", "public", "--json"]);

    const canvas = await runJson(["render", "canvas", "--renderer", "react-flow", "--project", "alpha", "--json"]);
    expect(canvas.metadata.renderer).toBe("react_flow");

    const wrongProject = Bun.spawn({
      cmd: ["bun", "run", cliEntry, "render", "canvas", "--renderer", "react-flow", "--project", "beta", "--json"],
      cwd: repoRoot,
      env: {
        ...process.env,
        [DATASETS_HOME_ENV]: process.env[DATASETS_HOME_ENV]!,
        [DATASETS_DB_PATH_ENV]: process.env[DATASETS_DB_PATH_ENV]!,
      },
      stdout: "pipe",
      stderr: "pipe",
    });
    const [wrongProjectStderr, wrongProjectExit] = await Promise.all([
      new Response(wrongProject.stderr).text(),
      wrongProject.exited,
    ]);
    expect(wrongProjectExit).not.toBe(0);
    expect(wrongProjectStderr).toContain("Dataset not found");

    const badRenderer = Bun.spawn({
      cmd: ["bun", "run", cliEntry, "render", "canvas", "--renderer", "bogus", "--json"],
      cwd: repoRoot,
      env: {
        ...process.env,
        [DATASETS_HOME_ENV]: process.env[DATASETS_HOME_ENV]!,
        [DATASETS_DB_PATH_ENV]: process.env[DATASETS_DB_PATH_ENV]!,
      },
      stdout: "pipe",
      stderr: "pipe",
    });
    const [badRendererStderr, badRendererExit] = await Promise.all([
      new Response(badRenderer.stderr).text(),
      badRenderer.exited,
    ]);
    expect(badRendererExit).not.toBe(0);
    expect(badRendererStderr).toContain("Unsupported renderer");
  });

  test("clamps preview limits to the 1..500 range", async () => {
    const fixtureDir = join(testDir!, "fixtures");
    mkdirSync(fixtureDir, { recursive: true });
    const csvPath = join(fixtureDir, "three.csv");
    writeFileSync(csvPath, "id\n1\n2\n3\n");
    await runJson(["ingest", csvPath, "--name", "Three", "--classification", "public", "--json"]);

    const zero = await runJson(["preview", "three", "--limit", "0", "--json"]);
    const huge = await runJson(["preview", "three", "--limit", "999", "--json"]);

    expect(zero.rows).toHaveLength(1);
    expect(huge.rows).toHaveLength(3);
  });

  test("registers URI sources as manual without a path", async () => {
    const source = await runJson(["sources", "add", "https://example.com/data.csv", "--name", "Remote", "--json"]);

    expect(source).toMatchObject({ kind: "manual", uri: "https://example.com/data.csv", path: null });
  });

  test("fails with a named error when showing a missing dataset", async () => {
    const proc = Bun.spawn({
      cmd: ["bun", "run", cliEntry, "show", "does-not-exist", "--json"],
      cwd: repoRoot,
      env: {
        ...process.env,
        [DATASETS_HOME_ENV]: process.env[DATASETS_HOME_ENV]!,
        [DATASETS_DB_PATH_ENV]: process.env[DATASETS_DB_PATH_ENV]!,
      },
      stdout: "pipe",
      stderr: "pipe",
    });
    const [stderr, exitCode] = await Promise.all([
      new Response(proc.stderr).text(),
      proc.exited,
    ]);

    expect(exitCode).not.toBe(0);
    expect(stderr).toContain("Dataset not found: does-not-exist");
  });

  test("infers a schema from a raw file path", async () => {
    const fixtureDir = join(testDir!, "fixtures");
    mkdirSync(fixtureDir, { recursive: true });
    const csvPath = join(fixtureDir, "infer.csv");
    writeFileSync(csvPath, "name,amount\nx,1\ny,2\n");

    const schema = await runJson(["schema", "infer", csvPath, "--json"]);

    expect(Object.keys(schema.properties ?? {})).toEqual(["name", "amount"]);
  });

  test("prints the package version and exits cleanly on help", async () => {
    const proc = Bun.spawn({
      cmd: ["bun", "run", cliEntry, "--version"],
      cwd: repoRoot,
      env: {
        ...process.env,
        [DATASETS_HOME_ENV]: process.env[DATASETS_HOME_ENV]!,
        [DATASETS_DB_PATH_ENV]: process.env[DATASETS_DB_PATH_ENV]!,
      },
      stdout: "pipe",
      stderr: "pipe",
    });
    const [stdout, stderr, exitCode] = await Promise.all([
      new Response(proc.stdout).text(),
      new Response(proc.stderr).text(),
      proc.exited,
    ]);
    expect(exitCode).toBe(0);
    expect(stdout.trim()).toBe("0.1.5");
    expect(stderr).toBe("");

    const helpProc = Bun.spawn({
      cmd: ["bun", "run", cliEntry, "--help"],
      cwd: repoRoot,
      env: {
        ...process.env,
        [DATASETS_HOME_ENV]: process.env[DATASETS_HOME_ENV]!,
        [DATASETS_DB_PATH_ENV]: process.env[DATASETS_DB_PATH_ENV]!,
      },
      stdout: "pipe",
      stderr: "pipe",
    });
    const [helpOut, helpErr, helpExit] = await Promise.all([
      new Response(helpProc.stdout).text(),
      new Response(helpProc.stderr).text(),
      helpProc.exited,
    ]);
    expect(helpExit).toBe(0);
    expect(helpOut).toContain("Usage: datasets");
    expect(helpErr).toBe("");
  });
});

async function runJson(args: string[], env: Record<string, string> = {}): Promise<any> {
  const proc = Bun.spawn({
    cmd: ["bun", "run", cliEntry, ...args],
    cwd: repoRoot,
    env: {
      ...process.env,
      [DATASETS_HOME_ENV]: process.env[DATASETS_HOME_ENV]!,
      [DATASETS_DB_PATH_ENV]: process.env[DATASETS_DB_PATH_ENV]!,
      ...env,
    },
    stdout: "pipe",
    stderr: "pipe",
  });
  const [stdout, stderr, exitCode] = await Promise.all([
    new Response(proc.stdout).text(),
    new Response(proc.stderr).text(),
    proc.exited,
  ]);
  if (exitCode !== 0) {
    throw new Error(`datasets CLI failed (${exitCode})\nstdout:\n${stdout}\nstderr:\n${stderr}`);
  }
  return JSON.parse(stdout);
}

