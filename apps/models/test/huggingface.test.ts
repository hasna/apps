import { expect, test } from "bun:test";
import { existsSync, mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { downloadPlannedFiles, listHuggingFaceFiles, matchesFilePattern } from "../src/huggingface.js";

test("include patterns match exact basenames without substring bleed", () => {
  expect(matchesFilePattern("config.json", "config.json")).toBe(true);
  expect(matchesFilePattern("tokenizer_config.json", "config.json")).toBe(false);
  expect(matchesFilePattern("onnx/model.onnx", "*.onnx")).toBe(true);
  expect(matchesFilePattern("onnx/model.onnx", "onnx/")).toBe(true);
  expect(matchesFilePattern("nested/config.json", "config.json")).toBe(true);
});

test("file listing surfaces Hub auth failures instead of falling back to siblings", async () => {
  const originalFetch = globalThis.fetch;
  const calls: string[] = [];
  globalThis.fetch = async (input) => {
    calls.push(String(input));
    return new Response("private repo", { status: 401, statusText: "Unauthorized" });
  };

  try {
    await expect(listHuggingFaceFiles("hf:owner/private")).rejects.toThrow("401 Unauthorized");
    expect(calls).toHaveLength(1);
    expect(calls[0]).toContain("/api/models/owner/private/tree/main");
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test("file listing falls back to repo siblings when tree endpoint is missing", async () => {
  const originalFetch = globalThis.fetch;
  const calls: string[] = [];
  globalThis.fetch = async (input) => {
    calls.push(String(input));
    if (calls.length === 1) {
      return new Response("not found", { status: 404, statusText: "Not Found" });
    }
    return Response.json({
      siblings: [
        { rfilename: "config.json", size: 42, oid: "abc123" },
      ],
    });
  };

  try {
    const files = await listHuggingFaceFiles("hf:owner/repo");
    expect(files).toHaveLength(1);
    expect(files[0]).toMatchObject({
      provider: "huggingface",
      entityKind: "model",
      repoId: "owner/repo",
      revision: "main",
      path: "config.json",
      size: 42,
      oid: "abc123",
      format: "json",
    });
    expect(calls).toHaveLength(2);
    expect(calls[1]).toContain("/api/models/owner/repo/revision/main");
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test("file listing uses revision-scoped siblings for an explicit main fallback", async () => {
  const originalFetch = globalThis.fetch;
  const calls: string[] = [];
  globalThis.fetch = async (input) => {
    calls.push(String(input));
    if (calls.length === 1) {
      return new Response("tree not found", { status: 404, statusText: "Not Found" });
    }
    return Response.json({
      siblings: [
        { rfilename: "config.json", size: 42, oid: "abc123" },
      ],
    });
  };

  try {
    const files = await listHuggingFaceFiles("hf:owner/repo@main");
    expect(files).toHaveLength(1);
    expect(files[0]?.revision).toBe("main");
    expect(calls).toHaveLength(2);
    expect(calls[0]).toContain("/api/models/owner/repo/tree/main");
    expect(calls[1]).toContain("/api/models/owner/repo/revision/main");
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test("file listing does not fall back to unversioned siblings for a missing explicit revision", async () => {
  const originalFetch = globalThis.fetch;
  const calls: string[] = [];
  globalThis.fetch = async (input) => {
    calls.push(String(input));
    return new Response("revision not found", { status: 404, statusText: "Not Found" });
  };

  try {
    await expect(listHuggingFaceFiles("hf:owner/repo@missing-revision")).rejects.toThrow("404 Not Found");
    expect(calls).toHaveLength(2);
    expect(calls[0]).toContain("/api/models/owner/repo/tree/missing-revision");
    expect(calls[1]).toContain("/api/models/owner/repo/revision/missing-revision");
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test("download rejects remote paths that escape install root", async () => {
  await expect(downloadPlannedFiles({
    ref: { provider: "huggingface", entityKind: "model", repoId: "owner/repo", revision: "main" },
    files: [{
      provider: "huggingface",
      entityKind: "model",
      repoId: "owner/repo",
      revision: "main",
      path: "../../escaped.txt",
      size: 1,
      oid: null,
      lfsOid: null,
      format: null,
      downloadUrl: "data:text/plain,escape",
      metadata: {},
    }],
    totalBytes: 1,
    unknownSizeFiles: [],
    destinationRoot: "/tmp/open-models-test-root",
    exceedsMaxBytes: false,
    maxBytes: 10,
  })).rejects.toThrow("Unsafe remote file path");
});

test("download rejects known-size mismatches and removes the final file", async () => {
  const destinationRoot = mkdtempSync(join(tmpdir(), "models-download-"));

  await expect(downloadPlannedFiles({
    ref: { provider: "huggingface", entityKind: "model", repoId: "owner/repo", revision: "main" },
    files: [{
      provider: "huggingface",
      entityKind: "model",
      repoId: "owner/repo",
      revision: "main",
      path: "weights.bin",
      size: 64,
      oid: null,
      lfsOid: null,
      format: null,
      downloadUrl: "data:application/octet-stream,short",
      metadata: {},
    }],
    totalBytes: 64,
    unknownSizeFiles: [],
    destinationRoot,
    exceedsMaxBytes: false,
    maxBytes: 128,
  })).rejects.toThrow("Downloaded size mismatch for weights.bin");

  expect(existsSync(join(destinationRoot, "weights.bin"))).toBe(false);
});

test("download preserves an existing final file when replacement size mismatches", async () => {
  const destinationRoot = mkdtempSync(join(tmpdir(), "models-download-"));
  const destination = join(destinationRoot, "weights.bin");
  const original = Buffer.alloc(64, 7);
  writeFileSync(destination, original);

  await expect(downloadPlannedFiles({
    ref: { provider: "huggingface", entityKind: "model", repoId: "owner/repo", revision: "main" },
    files: [{
      provider: "huggingface",
      entityKind: "model",
      repoId: "owner/repo",
      revision: "main",
      path: "weights.bin",
      size: 64,
      oid: null,
      lfsOid: null,
      format: null,
      downloadUrl: "data:application/octet-stream,short",
      metadata: {},
    }],
    totalBytes: 64,
    unknownSizeFiles: [],
    destinationRoot,
    exceedsMaxBytes: false,
    maxBytes: 128,
  })).rejects.toThrow("Downloaded size mismatch for weights.bin");

  expect(readFileSync(destination).toString("hex")).toBe(original.toString("hex"));
});
