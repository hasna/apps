import { describe, test, expect } from "bun:test";
import { writeFileSync, mkdirSync } from "fs";
import { tmpdir } from "os";
import { join } from "path";
import { loadDataset, streamDataset } from "./loader.js";

function tmpFile(name: string, content: string): string {
  const dir = join(tmpdir(), "evals-test-" + Date.now());
  mkdirSync(dir, { recursive: true });
  const path = join(dir, name);
  writeFileSync(path, content);
  return path;
}

describe("loadDataset — JSONL", () => {
  test("loads valid JSONL cases", async () => {
    const path = tmpFile("test.jsonl", [
      '{"id":"case-1","input":"hello"}',
      '{"id":"case-2","input":"world"}',
    ].join("\n"));
    const { cases, warnings } = await loadDataset(path);
    expect(cases.length).toBe(2);
    expect(warnings.length).toBe(0);
    expect(cases[0]!.id).toBe("case-1");
  });

  test("skips blank and comment lines", async () => {
    const path = tmpFile("test2.jsonl", [
      "",
      "// comment",
      '{"id":"c1","input":"x"}',
    ].join("\n"));
    const { cases } = await loadDataset(path);
    expect(cases.length).toBe(1);
  });

  test("warns on malformed line, skips it", async () => {
    const path = tmpFile("test3.jsonl", [
      '{"id":"good","input":"x"}',
      'NOT JSON',
    ].join("\n"));
    const { cases, warnings, skipped } = await loadDataset(path);
    expect(cases.length).toBe(1);
    expect(warnings.length).toBe(1);
    expect(skipped).toBe(1);
  });

  test("strict mode throws on malformed line", async () => {
    const path = tmpFile("strict.jsonl", 'BAD JSON\n');
    await expect(loadDataset(path, { strict: true })).rejects.toThrow();
  });

  test("filters by tags", async () => {
    const path = tmpFile("tagged.jsonl", [
      '{"id":"t1","input":"x","tags":["smoke"]}',
      '{"id":"t2","input":"y","tags":["slow"]}',
    ].join("\n"));
    const { cases } = await loadDataset(path, { tags: ["smoke"] });
    expect(cases.length).toBe(1);
    expect(cases[0]!.id).toBe("t1");
  });
});

describe("loadDataset — JSON array", () => {
  test("loads JSON array file", async () => {
    const path = tmpFile("cases.json", JSON.stringify([
      { id: "j1", input: "hello" },
      { id: "j2", input: "world" },
    ]));
    const { cases } = await loadDataset(path);
    expect(cases.length).toBe(2);
  });

  test("throws if not an array", async () => {
    const path = tmpFile("bad.json", '{"id":"x","input":"y"}');
    await expect(loadDataset(path)).rejects.toThrow("must be an array");
  });
});

describe("validation", () => {
  test("throws if id is missing", async () => {
    const path = tmpFile("noid.jsonl", '{"input":"hello"}');
    const { warnings } = await loadDataset(path);
    expect(warnings.length).toBeGreaterThan(0);
  });

  test("throws if neither input nor turns present", async () => {
    const path = tmpFile("noinput.jsonl", '{"id":"x"}');
    const { warnings } = await loadDataset(path);
    expect(warnings.length).toBeGreaterThan(0);
  });
});

describe("streamDataset", () => {
  test("yields cases one by one", async () => {
    const path = tmpFile("stream.jsonl", [
      '{"id":"s1","input":"a"}',
      '{"id":"s2","input":"b"}',
      '{"id":"s3","input":"c"}',
    ].join("\n"));
    const ids: string[] = [];
    for await (const c of streamDataset(path)) ids.push(c.id);
    expect(ids).toEqual(["s1", "s2", "s3"]);
  });

  test("filters by tags in stream mode", async () => {
    const path = tmpFile("stream-tags.jsonl", [
      '{"id":"t1","input":"a","tags":["smoke"]}',
      '{"id":"t2","input":"b","tags":["slow"]}',
      '{"id":"t3","input":"c","tags":["smoke"]}',
    ].join("\n"));
    const ids: string[] = [];
    for await (const c of streamDataset(path, { tags: ["smoke"] })) ids.push(c.id);
    expect(ids).toEqual(["t1", "t3"]);
  });

  test("skips malformed lines silently in stream mode", async () => {
    const path = tmpFile("stream-bad.jsonl", [
      '{"id":"good","input":"x"}',
      'NOT JSON',
      '{"id":"also-good","input":"y"}',
    ].join("\n"));
    const ids: string[] = [];
    for await (const c of streamDataset(path)) ids.push(c.id);
    expect(ids).toEqual(["good", "also-good"]);
  });
});

describe("loadDataset — JSON array strict mode", () => {
  test("strict mode throws on malformed item in JSON array", async () => {
    const path = tmpFile("strict-array.json", JSON.stringify([
      { id: "ok", input: "hello" },
      { not_a_case: true }, // missing id
    ]));
    await expect(loadDataset(path, { strict: true })).rejects.toThrow();
  });

  test("non-strict skips bad items in JSON array with warning", async () => {
    const path = tmpFile("bad-array.json", JSON.stringify([
      { id: "ok", input: "hello" },
      { not_a_case: true },
    ]));
    const { cases, warnings, skipped } = await loadDataset(path);
    expect(cases.length).toBe(1);
    expect(warnings.length).toBe(1);
    expect(skipped).toBe(1);
  });
});

describe("loadDataset — no files matched", () => {
  test("throws when glob matches no files", async () => {
    await expect(
      loadDataset("/tmp/evals-no-such-dir-*/nonexistent-*.jsonl")
    ).rejects.toThrow("No files matched");
  });
});
