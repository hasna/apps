import { expect, test } from "bun:test";
import { existsSync, mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { downloadPlannedFiles, matchesFilePattern } from "../src/huggingface.js";

test("include patterns match exact basenames without substring bleed", () => {
  expect(matchesFilePattern("config.json", "config.json")).toBe(true);
  expect(matchesFilePattern("tokenizer_config.json", "config.json")).toBe(false);
  expect(matchesFilePattern("onnx/model.onnx", "*.onnx")).toBe(true);
  expect(matchesFilePattern("onnx/model.onnx", "onnx/")).toBe(true);
  expect(matchesFilePattern("nested/config.json", "config.json")).toBe(true);
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
