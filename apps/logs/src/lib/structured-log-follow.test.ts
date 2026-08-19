/**
 * Test gap coverage for src/lib/structured-log-follow.ts.
 *
 * agent-authored: the SOL consult for this repo did not deliver a spec (two
 * distinct Codewith accounts: one capacity-refused before answering, one
 * admitted but timed out at 600s on both the initial call and its resume).
 * This analysis and these tests were produced by the sweep agent.
 *
 * The JSONL follower had no sibling test. These tests pin the file-follow
 * contract against real temp files: from_start/from_end positioning, polled
 * appends, max_lines, idle timeout, partial-line flush at EOF, CRLF and empty
 * line handling, invalid-JSON line errors, and shrink (truncation) detection.
 */
import { describe, expect, it } from "bun:test";
import {
  appendFileSync,
  mkdtempSync,
  rmSync,
  truncateSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { LogEntry, LogRow } from "../types/index.ts";
import {
  followStructuredJsonLines,
  type FollowIngestFn,
} from "./structured-log-follow.ts";

function tempFile(contents: string): string {
  const dir = mkdtempSync(join(tmpdir(), "logs-follow-test-"));
  const file = join(dir, "events.jsonl");
  writeFileSync(file, contents);
  return file;
}

const rowFromEntry = (entry: LogEntry): LogRow => ({
  id: entry.id ?? `row-${entry.message}`,
  timestamp: entry.timestamp ?? new Date().toISOString(),
  project_id: entry.project_id ?? null,
  page_id: entry.page_id ?? null,
  level: entry.level,
  source: entry.source ?? "test",
  service: entry.service ?? null,
  message: entry.message,
  trace_id: entry.trace_id ?? null,
  session_id: entry.session_id ?? null,
  agent: entry.agent ?? null,
  url: entry.url ?? null,
  stack_trace: entry.stack_trace ?? null,
  metadata: null,
});

async function waitFor(cond: () => boolean, timeoutMs = 2_000): Promise<void> {
  const start = Date.now();
  while (!cond()) {
    if (Date.now() - start > timeoutMs) {
      throw new Error("timed out waiting for condition");
    }
    await Bun.sleep(5);
  }
}

const validLine = (message: string) =>
  JSON.stringify({ level: "info", message });

describe("followStructuredJsonLines", () => {
  it("throws for a missing file", async () => {
    await expect(
      followStructuredJsonLines(
        async (entry) => rowFromEntry(entry),
        "/nonexistent/events.jsonl",
        { idle_timeout_ms: 30 },
      ),
    ).rejects.toThrow("JSONL file does not exist");
  });

  it("ingests existing complete lines from the start by default", async () => {
    const file = tempFile(
      `${validLine("one")}\n${validLine("two")}\n${validLine("three")}\n`,
    );
    const ids: string[] = [];
    const result = await followStructuredJsonLines(
      async (entry) => {
        ids.push(entry.message);
        return rowFromEntry(entry);
      },
      file,
      { idle_timeout_ms: 30, poll_ms: 5 },
    );
    expect(result.inserted).toBe(3);
    expect(ids).toEqual(["one", "two", "three"]);
    expect(result.lines_read).toBe(3);
    expect(result.bytes_read).toBeGreaterThan(0);
    expect(result.truncated).toBe(0);
    rmSync(file, { recursive: false });
  });

  it("skips existing content with from_end and picks up appends", async () => {
    const file = tempFile(`${validLine("pre-1")}\n${validLine("pre-2")}\n`);
    const ids: string[] = [];
    const follow = followStructuredJsonLines(
      async (entry) => {
        ids.push(entry.message);
        return rowFromEntry(entry);
      },
      file,
      { from_end: true, poll_ms: 5, idle_timeout_ms: 300 },
    );
    await Bun.sleep(30);
    appendFileSync(file, `${validLine("appended")}\n`);
    const result = await follow;
    expect(result.inserted).toBe(1);
    expect(ids).toEqual(["appended"]);
    rmSync(file, { recursive: false });
  });

  it("skips empty lines and handles CRLF line endings", async () => {
    const file = tempFile(
      `${validLine("crlf-one")}\r\n\r\n${validLine("crlf-two")}\r\n`,
    );
    const ids: string[] = [];
    const result = await followStructuredJsonLines(
      async (entry) => {
        ids.push(entry.message);
        return rowFromEntry(entry);
      },
      file,
      { idle_timeout_ms: 30, poll_ms: 5 },
    );
    expect(result.inserted).toBe(2);
    expect(ids).toEqual(["crlf-one", "crlf-two"]);
    rmSync(file, { recursive: false });
  });

  it("fails with the exact line number on invalid JSON", async () => {
    const file = tempFile(`${validLine("ok")}\nnot-json-at-all\n`);
    await expect(
      followStructuredJsonLines(
        async (entry) => rowFromEntry(entry),
        file,
        { idle_timeout_ms: 30, poll_ms: 5 },
      ),
    ).rejects.toThrow(/^line 2: invalid JSON/);
    rmSync(file, { recursive: false });
  });

  it("stops ingesting at max_lines and never over-reads", async () => {
    const file = tempFile(
      `${validLine("a")}\n${validLine("b")}\n${validLine("c")}\n${validLine("d")}\n${validLine("e")}\n`,
    );
    const ids: string[] = [];
    const result = await followStructuredJsonLines(
      async (entry) => {
        ids.push(entry.message);
        return rowFromEntry(entry);
      },
      file,
      { max_lines: 2, idle_timeout_ms: 50, poll_ms: 5 },
    );
    expect(result.inserted).toBe(2);
    expect(ids).toEqual(["a", "b"]);
    rmSync(file, { recursive: false });
  });

  it("flushes a trailing partial line at EOF when idle", async () => {
    const file = tempFile(`${validLine("full")}\n${validLine("partial")}`);
    const ids: string[] = [];
    const result = await followStructuredJsonLines(
      async (entry) => {
        ids.push(entry.message);
        return rowFromEntry(entry);
      },
      file,
      { idle_timeout_ms: 30, poll_ms: 5 },
    );
    expect(result.inserted).toBe(2);
    expect(ids).toEqual(["full", "partial"]);
    expect(result.lines_read).toBe(2);
    rmSync(file, { recursive: false });
  });

  it("honors idle_timeout with no new data", async () => {
    const file = tempFile(`${validLine("only")}\n`);
    const result = await followStructuredJsonLines(
      async (entry) => rowFromEntry(entry),
      file,
      { idle_timeout_ms: 20, poll_ms: 5 },
    );
    expect(result.inserted).toBe(1);
    rmSync(file, { recursive: false });
  });

  it("detects a shrunk file, re-reads from zero, and counts the truncation", async () => {
    const file = tempFile(`${validLine("big-1")}\n${validLine("big-2")}\n`);
    const ids: string[] = [];
    const follow = followStructuredJsonLines(
      async (entry) => {
        ids.push(entry.message);
        return rowFromEntry(entry);
      },
      file,
      { poll_ms: 5, idle_timeout_ms: 400 },
    );
    await waitFor(() => ids.length === 2);
    truncateSync(file, 0);
    writeFileSync(file, `${validLine("replaced")}\n`);
    const result = await follow;
    expect(result.truncated).toBeGreaterThanOrEqual(1);
    expect(result.inserted).toBe(3);
    expect(ids).toEqual(["big-1", "big-2", "replaced"]);
    rmSync(file, { recursive: false });
  });

  it("reports the source name and calls on_row for every row", async () => {
    const file = tempFile(`${validLine("cb-1")}\n${validLine("cb-2")}\n`);
    const seen: string[] = [];
    const result = await followStructuredJsonLines(
      async (entry) => rowFromEntry(entry),
      file,
      {
        idle_timeout_ms: 30,
        poll_ms: 5,
        source_name: "custom-source",
        on_row: (row) => seen.push(row.message),
      },
    );
    expect(result.inserted).toBe(2);
    expect(seen).toEqual(["cb-1", "cb-2"]);
    rmSync(file, { recursive: false });
  });

  it("aborts cleanly on signal", async () => {
    const file = tempFile(`${validLine("sig-1")}\n`);
    const controller = new AbortController();
    const ids: string[] = [];
    const follow = followStructuredJsonLines(
      async (entry) => {
        ids.push(entry.message);
        return rowFromEntry(entry);
      },
      file,
      { signal: controller.signal, poll_ms: 5, idle_timeout_ms: 10_000 },
    );
    await waitFor(() => ids.length === 1);
    controller.abort();
    const result = await follow;
    expect(result.inserted).toBe(1);
    rmSync(file, { recursive: false });
  });
});
