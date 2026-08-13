import { expect, test } from "bun:test";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, symlinkSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { createDownloadPlan, downloadPlannedFiles, getHuggingFaceInfo, listHuggingFaceFiles, matchesFilePattern } from "../src/huggingface.js";

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

test("info fetches revision-scoped metadata for explicit refs", async () => {
  const originalFetch = globalThis.fetch;
  const calls: string[] = [];
  globalThis.fetch = async (input) => {
    calls.push(String(input));
    return Response.json({
      id: "owner/repo",
      sha: "resolved-commit",
      tags: ["text-generation"],
      private: false,
      gated: false,
    });
  };

  try {
    const info = await getHuggingFaceInfo("hf:owner/repo@feature-branch");
    expect(info.revision).toBe("resolved-commit");
    expect(calls).toHaveLength(1);
    expect(calls[0]).toContain("/api/models/owner/repo/revision/feature-branch");
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test("info preserves the requested revision when metadata omits sha", async () => {
  const originalFetch = globalThis.fetch;
  globalThis.fetch = async () => Response.json({
    id: "owner/repo",
    tags: [],
    private: false,
    gated: false,
  });

  try {
    const info = await getHuggingFaceInfo("hf:owner/repo@v1.2.3");
    expect(info.revision).toBe("v1.2.3");
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

test("download rejects dot-segment remote paths", async () => {
  await expect(downloadPlannedFiles({
    ref: { provider: "huggingface", entityKind: "model", repoId: "owner/repo", revision: "main" },
    files: [{
      provider: "huggingface",
      entityKind: "model",
      repoId: "owner/repo",
      revision: "main",
      path: ".",
      size: 1,
      oid: null,
      lfsOid: null,
      format: null,
      downloadUrl: "data:text/plain,root",
      metadata: {},
    }],
    totalBytes: 1,
    unknownSizeFiles: [],
    destinationRoot: "/tmp/open-models-test-root",
    exceedsMaxBytes: false,
    maxBytes: 10,
  })).rejects.toThrow("Unsafe remote file path");
});

test("download rejects separator alias remote paths", async () => {
  for (const path of ["a//b", "a\\b"]) {
    await expect(downloadPlannedFiles({
      ref: { provider: "huggingface", entityKind: "model", repoId: "owner/repo", revision: "main" },
      files: [{
        provider: "huggingface",
        entityKind: "model",
        repoId: "owner/repo",
        revision: "main",
        path,
        size: 1,
        oid: null,
        lfsOid: null,
        format: null,
        downloadUrl: "data:text/plain,x",
        metadata: {},
      }],
      totalBytes: 1,
      unknownSizeFiles: [],
      destinationRoot: mkdtempSync(join(tmpdir(), "models-download-")),
      exceedsMaxBytes: false,
      maxBytes: 10,
    })).rejects.toThrow("Unsafe remote file path");
  }
});

test("download rejects duplicate destination paths before writing", async () => {
  const destinationRoot = mkdtempSync(join(tmpdir(), "models-download-"));

  await expect(downloadPlannedFiles({
    ref: { provider: "huggingface", entityKind: "model", repoId: "owner/repo", revision: "main" },
    files: [
      {
        provider: "huggingface",
        entityKind: "model",
        repoId: "owner/repo",
        revision: "main",
        path: "weights.bin",
        size: 3,
        oid: null,
        lfsOid: null,
        format: null,
        downloadUrl: "data:text/plain,one",
        metadata: {},
      },
      {
        provider: "huggingface",
        entityKind: "model",
        repoId: "owner/repo",
        revision: "main",
        path: "weights.bin",
        size: 3,
        oid: null,
        lfsOid: null,
        format: null,
        downloadUrl: "data:text/plain,two",
        metadata: {},
      },
    ],
    totalBytes: 6,
    unknownSizeFiles: [],
    destinationRoot,
    exceedsMaxBytes: false,
    maxBytes: 10,
  })).rejects.toThrow("same destination");

  expect(existsSync(join(destinationRoot, "weights.bin"))).toBe(false);
});

test("download rejects symlinked parent directories under the install root", async () => {
  const destinationRoot = mkdtempSync(join(tmpdir(), "models-download-"));
  const outsideRoot = mkdtempSync(join(tmpdir(), "models-outside-"));
  symlinkSync(outsideRoot, join(destinationRoot, "link"), "dir");

  try {
    await expect(downloadPlannedFiles({
      ref: { provider: "huggingface", entityKind: "model", repoId: "owner/repo", revision: "main" },
      files: [{
        provider: "huggingface",
        entityKind: "model",
        repoId: "owner/repo",
        revision: "main",
        path: "link/owned.txt",
        size: 5,
        oid: null,
        lfsOid: null,
        format: null,
        downloadUrl: "data:text/plain,owned",
        metadata: {},
      }],
      totalBytes: 5,
      unknownSizeFiles: [],
      destinationRoot,
      exceedsMaxBytes: false,
      maxBytes: 10,
    })).rejects.toThrow("symlink");

    expect(existsSync(join(outsideRoot, "owned.txt"))).toBe(false);
  } finally {
    rmSync(destinationRoot, { recursive: true, force: true });
    rmSync(outsideRoot, { recursive: true, force: true });
  }
});

test("download rejects a symlinked install root", async () => {
  const linkParent = mkdtempSync(join(tmpdir(), "models-link-parent-"));
  const outsideRoot = mkdtempSync(join(tmpdir(), "models-outside-"));
  const destinationRoot = join(linkParent, "root-link");
  symlinkSync(outsideRoot, destinationRoot, "dir");

  try {
    await expect(downloadPlannedFiles({
      ref: { provider: "huggingface", entityKind: "model", repoId: "owner/repo", revision: "main" },
      files: [{
        provider: "huggingface",
        entityKind: "model",
        repoId: "owner/repo",
        revision: "main",
        path: "owned.txt",
        size: 5,
        oid: null,
        lfsOid: null,
        format: null,
        downloadUrl: "data:text/plain,owned",
        metadata: {},
      }],
      totalBytes: 5,
      unknownSizeFiles: [],
      destinationRoot,
      exceedsMaxBytes: false,
      maxBytes: 10,
    })).rejects.toThrow("Install root cannot be a symlink");

    expect(existsSync(join(outsideRoot, "owned.txt"))).toBe(false);
  } finally {
    rmSync(linkParent, { recursive: true, force: true });
    rmSync(outsideRoot, { recursive: true, force: true });
  }
});

test("download rejects symlinked install root ancestors", async () => {
  const baseRoot = mkdtempSync(join(tmpdir(), "models-base-"));
  const outsideRoot = mkdtempSync(join(tmpdir(), "models-outside-"));
  const linkParent = join(baseRoot, "link-parent");
  const destinationRoot = join(linkParent, "root");
  symlinkSync(outsideRoot, linkParent, "dir");

  try {
    await expect(downloadPlannedFiles({
      ref: { provider: "huggingface", entityKind: "model", repoId: "owner/repo", revision: "main" },
      files: [{
        provider: "huggingface",
        entityKind: "model",
        repoId: "owner/repo",
        revision: "main",
        path: "owned.txt",
        size: 5,
        oid: null,
        lfsOid: null,
        format: null,
        downloadUrl: "data:text/plain,owned",
        metadata: {},
      }],
      totalBytes: 5,
      unknownSizeFiles: [],
      destinationRoot,
      exceedsMaxBytes: false,
      maxBytes: 10,
    })).rejects.toThrow("Install root cannot contain symlink components");

    expect(existsSync(join(outsideRoot, "root", "owned.txt"))).toBe(false);
  } finally {
    rmSync(baseRoot, { recursive: true, force: true });
    rmSync(outsideRoot, { recursive: true, force: true });
  }
});

test("download rechecks a symlinked install root after fetch", async () => {
  const originalFetch = globalThis.fetch;
  const parentRoot = mkdtempSync(join(tmpdir(), "models-parent-"));
  const destinationRoot = join(parentRoot, "root");
  const outsideRoot = mkdtempSync(join(tmpdir(), "models-outside-"));
  mkdirSync(destinationRoot);
  globalThis.fetch = async () => {
    rmSync(destinationRoot, { recursive: true, force: true });
    symlinkSync(outsideRoot, destinationRoot, "dir");
    return new Response("owned", { status: 200, statusText: "OK" });
  };

  try {
    await expect(downloadPlannedFiles({
      ref: { provider: "huggingface", entityKind: "model", repoId: "owner/repo", revision: "main" },
      files: [{
        provider: "huggingface",
        entityKind: "model",
        repoId: "owner/repo",
        revision: "main",
        path: "sub/owned.txt",
        size: 5,
        oid: null,
        lfsOid: null,
        format: null,
        downloadUrl: "ignored",
        metadata: {},
      }],
      totalBytes: 5,
      unknownSizeFiles: [],
      destinationRoot,
      exceedsMaxBytes: false,
      maxBytes: 10,
    })).rejects.toThrow("Install root cannot be a symlink");

    expect(existsSync(join(outsideRoot, "sub", "owned.txt"))).toBe(false);
  } finally {
    globalThis.fetch = originalFetch;
    rmSync(parentRoot, { recursive: true, force: true });
    rmSync(outsideRoot, { recursive: true, force: true });
  }
});

test("download rechecks symlinked parent directories after fetch", async () => {
  const originalFetch = globalThis.fetch;
  const destinationRoot = mkdtempSync(join(tmpdir(), "models-download-"));
  const outsideRoot = mkdtempSync(join(tmpdir(), "models-outside-"));
  const parent = join(destinationRoot, "parent");
  globalThis.fetch = async () => {
    rmSync(parent, { recursive: true, force: true });
    symlinkSync(outsideRoot, parent, "dir");
    return new Response("owned", { status: 200, statusText: "OK" });
  };

  try {
    await expect(downloadPlannedFiles({
      ref: { provider: "huggingface", entityKind: "model", repoId: "owner/repo", revision: "main" },
      files: [{
        provider: "huggingface",
        entityKind: "model",
        repoId: "owner/repo",
        revision: "main",
        path: "parent/sub/owned.txt",
        size: 5,
        oid: null,
        lfsOid: null,
        format: null,
        downloadUrl: "ignored",
        metadata: {},
      }],
      totalBytes: 5,
      unknownSizeFiles: [],
      destinationRoot,
      exceedsMaxBytes: false,
      maxBytes: 10,
    })).rejects.toThrow("symlink");

    expect(existsSync(join(outsideRoot, "sub"))).toBe(false);
    expect(existsSync(join(outsideRoot, "sub", "owned.txt"))).toBe(false);
  } finally {
    globalThis.fetch = originalFetch;
    rmSync(destinationRoot, { recursive: true, force: true });
    rmSync(outsideRoot, { recursive: true, force: true });
  }
});

test("download recomputes trusted Hugging Face URLs instead of using plan URLs", async () => {
  const originalFetch = globalThis.fetch;
  const destinationRoot = mkdtempSync(join(tmpdir(), "models-download-"));
  let requestedUrl: string | null = null;
  globalThis.fetch = async (input) => {
    requestedUrl = String(input);
    return new Response("x", { status: 200, statusText: "OK" });
  };

  try {
    await downloadPlannedFiles({
      ref: { provider: "huggingface", entityKind: "model", repoId: "owner/repo", revision: "main" },
      files: [{
        provider: "huggingface",
        entityKind: "model",
        repoId: "owner/repo",
        revision: "main",
        path: "weights.bin",
        size: 1,
        oid: null,
        lfsOid: null,
        format: null,
        downloadUrl: "https://attacker.example/steal-token",
        metadata: {},
      }],
      totalBytes: 1,
      unknownSizeFiles: [],
      destinationRoot,
      exceedsMaxBytes: false,
      maxBytes: 10,
    });

    expect(requestedUrl).toBe("https://huggingface.co/owner/repo/resolve/main/weights.bin");
  } finally {
    globalThis.fetch = originalFetch;
    rmSync(destinationRoot, { recursive: true, force: true });
  }
});

test("download plan rejects remote paths that escape install root", async () => {
  const originalFetch = globalThis.fetch;
  globalThis.fetch = async () => Response.json([
    { type: "file", path: "../escaped.txt", size: 1 },
  ]);

  try {
    await expect(createDownloadPlan({
      ref: { provider: "huggingface", entityKind: "model", repoId: "owner/repo", revision: "main" },
      destinationRoot: "/tmp/open-models-test-root",
    })).rejects.toThrow("Unsafe remote file path");
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test("download plan rejects dot-segment remote paths", async () => {
  const originalFetch = globalThis.fetch;
  globalThis.fetch = async () => Response.json([
    { type: "file", path: ".", size: 1 },
  ]);

  try {
    await expect(createDownloadPlan({
      ref: { provider: "huggingface", entityKind: "model", repoId: "owner/repo", revision: "main" },
      destinationRoot: "/tmp/open-models-test-root",
    })).rejects.toThrow("Unsafe remote file path");
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test("download plan rejects separator alias remote paths", async () => {
  const originalFetch = globalThis.fetch;

  try {
    for (const path of ["a//b", "a\\b"]) {
      globalThis.fetch = async () => Response.json([
        { type: "file", path, size: 1 },
      ]);

      await expect(createDownloadPlan({
        ref: { provider: "huggingface", entityKind: "model", repoId: "owner/repo", revision: "main" },
        destinationRoot: "/tmp/open-models-test-root",
      })).rejects.toThrow("Unsafe remote file path");
    }
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test("download plan rejects duplicate destination paths", async () => {
  const originalFetch = globalThis.fetch;
  globalThis.fetch = async () => Response.json([
    { type: "file", path: "weights.bin", size: 1 },
    { type: "file", path: "weights.bin", size: 1 },
  ]);

  try {
    await expect(createDownloadPlan({
      ref: { provider: "huggingface", entityKind: "model", repoId: "owner/repo", revision: "main" },
      destinationRoot: "/tmp/open-models-test-root",
    })).rejects.toThrow("same destination");
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test("download plan rejects symlinked parent directories under the install root", async () => {
  const originalFetch = globalThis.fetch;
  const destinationRoot = mkdtempSync(join(tmpdir(), "models-download-"));
  const outsideRoot = mkdtempSync(join(tmpdir(), "models-outside-"));
  symlinkSync(outsideRoot, join(destinationRoot, "link"), "dir");
  globalThis.fetch = async () => Response.json([
    { type: "file", path: "link/owned.txt", size: 5 },
  ]);

  try {
    await expect(createDownloadPlan({
      ref: { provider: "huggingface", entityKind: "model", repoId: "owner/repo", revision: "main" },
      destinationRoot,
    })).rejects.toThrow("symlink");
  } finally {
    globalThis.fetch = originalFetch;
    rmSync(destinationRoot, { recursive: true, force: true });
    rmSync(outsideRoot, { recursive: true, force: true });
  }
});

test("download plan rejects a symlinked install root", async () => {
  const originalFetch = globalThis.fetch;
  const linkParent = mkdtempSync(join(tmpdir(), "models-link-parent-"));
  const outsideRoot = mkdtempSync(join(tmpdir(), "models-outside-"));
  const destinationRoot = join(linkParent, "root-link");
  symlinkSync(outsideRoot, destinationRoot, "dir");
  globalThis.fetch = async () => Response.json([
    { type: "file", path: "owned.txt", size: 5 },
  ]);

  try {
    await expect(createDownloadPlan({
      ref: { provider: "huggingface", entityKind: "model", repoId: "owner/repo", revision: "main" },
      destinationRoot,
    })).rejects.toThrow("Install root cannot be a symlink");
  } finally {
    globalThis.fetch = originalFetch;
    rmSync(linkParent, { recursive: true, force: true });
    rmSync(outsideRoot, { recursive: true, force: true });
  }
});

test("download plan rejects symlinked install root ancestors", async () => {
  const originalFetch = globalThis.fetch;
  const baseRoot = mkdtempSync(join(tmpdir(), "models-base-"));
  const outsideRoot = mkdtempSync(join(tmpdir(), "models-outside-"));
  const linkParent = join(baseRoot, "link-parent");
  const destinationRoot = join(linkParent, "root");
  symlinkSync(outsideRoot, linkParent, "dir");
  globalThis.fetch = async () => Response.json([
    { type: "file", path: "owned.txt", size: 5 },
  ]);

  try {
    await expect(createDownloadPlan({
      ref: { provider: "huggingface", entityKind: "model", repoId: "owner/repo", revision: "main" },
      destinationRoot,
    })).rejects.toThrow("Install root cannot contain symlink components");
  } finally {
    globalThis.fetch = originalFetch;
    rmSync(baseRoot, { recursive: true, force: true });
    rmSync(outsideRoot, { recursive: true, force: true });
  }
});

test("download rejects known-size mismatches and removes the final file", async () => {
  const originalFetch = globalThis.fetch;
  const destinationRoot = mkdtempSync(join(tmpdir(), "models-download-"));
  globalThis.fetch = async () => new Response("short", { status: 200, statusText: "OK" });

  try {
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
        downloadUrl: "ignored",
        metadata: {},
      }],
      totalBytes: 64,
      unknownSizeFiles: [],
      destinationRoot,
      exceedsMaxBytes: false,
      maxBytes: 128,
    })).rejects.toThrow("Downloaded size mismatch for weights.bin");
  } finally {
    globalThis.fetch = originalFetch;
  }

  expect(existsSync(join(destinationRoot, "weights.bin"))).toBe(false);
});

test("download preserves an existing final file when replacement size mismatches", async () => {
  const originalFetch = globalThis.fetch;
  const destinationRoot = mkdtempSync(join(tmpdir(), "models-download-"));
  const destination = join(destinationRoot, "weights.bin");
  const original = Buffer.alloc(64, 7);
  writeFileSync(destination, original);
  globalThis.fetch = async () => new Response("short", { status: 200, statusText: "OK" });

  try {
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
        downloadUrl: "ignored",
        metadata: {},
      }],
      totalBytes: 64,
      unknownSizeFiles: [],
      destinationRoot,
      exceedsMaxBytes: false,
      maxBytes: 128,
    })).rejects.toThrow("Downloaded size mismatch for weights.bin");
  } finally {
    globalThis.fetch = originalFetch;
  }

  expect(readFileSync(destination).toString("hex")).toBe(original.toString("hex"));
});
