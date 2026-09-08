import { expect, test } from "bun:test";
import { closeSync, existsSync, mkdtempSync, openSync, readFileSync, readdirSync, rmSync, statSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { publishLoopbackReadiness } from "./loopback-api-readiness.js";

test("ready becomes visible only after complete JSON is written", () => {
  const root = mkdtempSync(join(tmpdir(), "conversations-ready-publication-"));
  const ready = join(root, "ready.json");
  const payload = { url: "http://127.0.0.1:8123" };
  let observedEmptyReady = false;
  let observedReadyDuringWrite = false;
  try {
    publishLoopbackReadiness(ready, payload, (path, content, options) => {
      // Reproduce the exact cross-process window in writeFileSync: the file has
      // been created, but its JSON has not been written. No clock race required.
      const descriptor = openSync(path, options.flag, options.mode);
      try {
        observedReadyDuringWrite = existsSync(ready);
        if (observedReadyDuringWrite) {
          try { JSON.parse(readFileSync(ready, "utf8")); }
          catch { observedEmptyReady = true; }
        }
        writeFileSync(descriptor, content);
      } finally { closeSync(descriptor); }
    });
    expect(observedReadyDuringWrite).toBe(false);
    expect(observedEmptyReady).toBe(false);
    expect(JSON.parse(readFileSync(ready, "utf8"))).toEqual(payload);
    expect(statSync(ready).mode & 0o777).toBe(0o600);
    expect(readdirSync(root)).toEqual(["ready.json"]);
  } finally { rmSync(root, { recursive: true, force: true }); }
});

test("a partial readiness write never publishes or leaves a staging file", () => {
  const root = mkdtempSync(join(tmpdir(), "conversations-ready-failure-"));
  const ready = join(root, "ready.json");
  const failure = new Error("fictional ready write failed");
  try {
    expect(() => publishLoopbackReadiness(ready, { url: "http://127.0.0.1:8123" }, (path, _content, options) => {
      writeFileSync(path, "{", options);
      throw failure;
    })).toThrow(failure);
    expect(existsSync(ready)).toBe(false);
    expect(readdirSync(root)).toEqual([]);
  } finally { rmSync(root, { recursive: true, force: true }); }
});
