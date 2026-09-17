import { expect, test } from "bun:test";
import { captureSchema, compactEntry, listSchema, parseInput, stationSchema, requestDigest } from "./domain.js";

const capture = {
  id: "10000000-0000-4000-8000-000000000001", stationId: "20000000-0000-4000-8000-000000000001",
  originalPath: "/work/report.txt", kind: "file", sizeBytes: 12, sha256: "a".repeat(64), mode: 0o640,
  artifact: { sha256: "b".repeat(64), sizeBytes: 512, format: "hasna.trash.capsule.v1" },
  agent: { name: "fixture-agent", harness: "codex", session: "fixture-session" },
} as const;

test("capture validates a bounded manifest and defaults to 90 days", () => {
  expect(parseInput(captureSchema, capture).retentionDays).toBe(90);
  expect(() => parseInput(captureSchema, { ...capture, originalPath: "relative/path" })).toThrow();
  expect(() => parseInput(captureSchema, { ...capture, originalPath: "/bad\0path" })).toThrow();
  expect(() => parseInput(captureSchema, { ...capture, retentionDays: -1 })).toThrow();
  expect(() => parseInput(captureSchema, { ...capture, pinned: false })).toThrow();
  expect(() => parseInput(captureSchema, { ...capture, artifact: { ...capture.artifact, sizeBytes: 3e9 } })).toThrow();
});

test("list defaults are compact and bounded; invalid or unknown options fail closed", () => {
  expect(parseInput(listSchema, {})).toEqual({ limit: 20 });
  expect(parseInput(listSchema, { limit: "5", station: "station06" }).limit).toBe(5);
  for (const input of [{ limit: 101 }, { limit: 0 }, { limit: "all" }, { content: "true" }, { cursor: "x".repeat(4097) }]) {
    expect(() => parseInput(listSchema, input)).toThrow();
  }
});

test("compact reads contain no artifact authority or full agent/session document", () => {
  const result = compactEntry({ ...capture, retentionDays: 90, version: 1, stationName: "station06", state: "trashed",
    capturedAt: "2026-09-17T00:00:00.000Z", expiresAt: "2026-12-16T00:00:00.000Z", held: false,
    backup: "none", objectKey: "private/object", objectVersion: "version", agent: capture.agent });
  expect(Object.keys(result).sort()).toEqual(["id", "version", "path", "kind", "bytes", "station", "capturedAt", "expiresAt", "held", "backup", "state"].sort());
  expect(JSON.stringify(result).length).toBeLessThan(400);
});

test("compact paths are bounded with an explicit truncation marker and a mutation version", () => {
  const result = compactEntry({ ...capture, originalPath: "/" + "x".repeat(4000), retentionDays: 90, version: 7, stationName: "station06", state: "trashed",
    capturedAt: "2026-09-17T00:00:00.000Z", expiresAt: null, held: false, backup: "none", objectKey: "private/object", objectVersion: "version" });
  expect(result.path.length).toBeLessThanOrEqual(241);
  expect(result).toHaveProperty("pathTruncated", true);
  expect(result).toHaveProperty("version", 7);
  expect(JSON.stringify(result).length).toBeLessThan(600);
});

test("station registration records detection provenance without accepting client authority fields", () => {
  const input = { name: "station04", hostname: "Mac", source: "tailscale", platform: "darwin", architecture: "arm64" };
  expect(parseInput(stationSchema, input).name).toBe("station04");
  expect(() => parseInput(stationSchema, { ...input, principal: "admin" })).toThrow();
});

test("idempotency hashes canonical JSON and distinguishes changed nested content", () => {
  expect(requestDigest({ b: [1, { z: true, a: false }], a: "x" }))
    .toBe(requestDigest({ a: "x", b: [1, { a: false, z: true }] }));
  expect(requestDigest({ a: 1 })).not.toBe(requestDigest({ a: "1" }));
  expect(() => requestDigest({ x: undefined })).toThrow();
});
