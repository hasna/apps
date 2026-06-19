import { expect, test } from "bun:test";
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
