import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { createHash } from "node:crypto";
import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { join, resolve } from "node:path";
import { tmpdir } from "node:os";
import {
  artifactStorePath,
  artifactStoreRoot,
  buildArtifactExportManifest,
  computeContentHash,
  deleteStoredArtifactFile,
  exportStoredArtifactContent,
  getArtifactStoreRoot,
  importStoredArtifactContent,
  isArtifactExpired,
  redactArtifactMetadata,
  storeArtifactContent,
  storeArtifactFile,
  verifyStoredArtifact,
  writeArtifactExportManifest,
  type ArtifactIntegrityInput,
} from "./artifact-store.js";

const ENV_KEYS = [
  "HASNA_TODOS_ARTIFACTS_DIR",
  "TODOS_ARTIFACTS_DIR",
  "HASNA_TODOS_DB_PATH",
  "TODOS_DB_PATH",
] as const;

let originalEnv: Partial<Record<(typeof ENV_KEYS)[number], string>>;
let tempDir: string;
let storeDir: string;

beforeEach(() => {
  originalEnv = {};
  for (const key of ENV_KEYS) {
    const value = process.env[key];
    if (value !== undefined) originalEnv[key] = value;
    delete process.env[key];
  }
  tempDir = mkdtempSync(join(tmpdir(), "todos-artifact-store-test-"));
  storeDir = join(tempDir, "store");
  process.env["HASNA_TODOS_ARTIFACTS_DIR"] = storeDir;
  process.env["TODOS_DB_PATH"] = ":memory:";
});

afterEach(() => {
  rmSync(tempDir, { recursive: true, force: true });
  for (const key of ENV_KEYS) {
    const value = originalEnv[key];
    if (value === undefined) delete process.env[key];
    else process.env[key] = value;
  }
});

function integrityInput(
  id: string,
  path: string,
  stored: NonNullable<ReturnType<typeof storeArtifactContent>>,
): ArtifactIntegrityInput {
  return {
    id,
    path,
    size_bytes: stored.size_bytes,
    sha256: stored.sha256,
    metadata: { artifact_store: stored.store },
  };
}

function credentialFixture(): { key: string; value: string; assignment: string; redactedAssignment: string } {
  const key = ["api", "_key"].join("");
  const value = "x".repeat(24);
  return {
    key,
    value,
    assignment: `${key}=${value}`,
    redactedAssignment: `${key}=[REDACTED]`,
  };
}

describe("artifact store paths", () => {
  test("honors environment precedence and resolves safe relative paths", () => {
    const fallbackDir = join(tempDir, "fallback");
    process.env["TODOS_ARTIFACTS_DIR"] = fallbackDir;

    expect(artifactStoreRoot()).toBe(resolve(storeDir));
    expect(getArtifactStoreRoot(join(tempDir, "todos.db"))).toBe(resolve(storeDir));
    expect(artifactStorePath("nested/evidence.log")).toBe(join(resolve(storeDir), "nested/evidence.log"));

    delete process.env["HASNA_TODOS_ARTIFACTS_DIR"];
    expect(artifactStoreRoot()).toBe(resolve(fallbackDir));
    expect(getArtifactStoreRoot()).toBe(resolve(fallbackDir));
  });

  test("rejects empty, absolute, and traversal paths", () => {
    for (const unsafePath of ["", "/tmp/evidence", "../evidence", "safe/../evidence", "..\\evidence"]) {
      expect(() => artifactStorePath(unsafePath)).toThrow("Invalid artifact store path");
    }
  });
});

describe("content-addressed artifact storage", () => {
  test("redacts text, records retention, and verifies and exports stored bytes", () => {
    const sourcePath = join(tempDir, "evidence.txt");
    const credential = credentialFixture();
    writeFileSync(sourcePath, credential.assignment);

    const stored = storeArtifactContent({
      path: sourcePath,
      created_at: "2026-07-01T00:00:00.000Z",
      retention_days: 2,
    });

    expect(stored).not.toBeNull();
    expect(stored!.store.redaction).toEqual({ checked: true, status: "redacted" });
    expect(stored!.store.retention).toEqual({ days: 2, expires_at: "2026-07-03T00:00:00.000Z" });
    expect(stored!.store.media_type).toBe("text/plain");
    expect(readFileSync(artifactStorePath(stored!.store.relative_path), "utf8")).toBe(
      credential.redactedAssignment,
    );

    const input = integrityInput("artifact-1", sourcePath, stored!);
    expect(verifyStoredArtifact(input)).toMatchObject({
      status: "ok",
      actual_sha256: stored!.sha256,
      actual_size_bytes: stored!.size_bytes,
    });
    expect(exportStoredArtifactContent(input)).toMatchObject({
      artifact_id: "artifact-1",
      sha256: stored!.sha256,
      size_bytes: stored!.size_bytes,
    });
  });

  test("reports metadata-only, missing, and mismatched content without throwing", () => {
    const metadataOnly = verifyStoredArtifact({
      id: "metadata-only",
      path: "remote.log",
      size_bytes: 12,
      sha256: "expected",
      metadata: {},
    });
    expect(metadataOnly.status).toBe("metadata_only");

    const sourcePath = join(tempDir, "integrity.log");
    writeFileSync(sourcePath, "original\n");
    const stored = storeArtifactContent({ path: sourcePath })!;
    const input = integrityInput("artifact-2", sourcePath, stored);
    const destination = artifactStorePath(stored.store.relative_path);

    writeFileSync(destination, "tampered\n");
    expect(verifyStoredArtifact(input)).toMatchObject({ status: "mismatch", expected_sha256: stored.sha256 });
    expect(exportStoredArtifactContent(input)).toBeNull();

    rmSync(destination);
    expect(verifyStoredArtifact(input)).toMatchObject({ status: "missing", actual_sha256: null });
  });

  test("imports valid exports and refuses checksum or size mismatches", () => {
    const bytes = Buffer.from("portable artifact\n");
    const sha256 = createHash("sha256").update(bytes).digest("hex");
    const content = {
      artifact_id: "portable",
      sha256,
      size_bytes: bytes.length,
      relative_path: `sha256/${sha256.slice(0, 2)}/${sha256}`,
      base64: bytes.toString("base64"),
    };

    expect(importStoredArtifactContent(content)).toMatchObject({ status: "ok", actual_sha256: sha256 });
    expect(readFileSync(artifactStorePath(content.relative_path))).toEqual(bytes);

    const badContent = { ...content, relative_path: "sha256/bad/content", size_bytes: bytes.length + 1 };
    expect(importStoredArtifactContent(badContent)).toMatchObject({
      status: "mismatch",
      expected_size_bytes: bytes.length + 1,
      actual_size_bytes: bytes.length,
    });
    expect(existsSync(artifactStorePath(badContent.relative_path))).toBe(false);
  });

  test("handles missing sources, directories, invalid retention, binary content, and metadata redaction", () => {
    expect(storeArtifactContent({ path: join(tempDir, "missing.log") })).toBeNull();
    expect(() => storeArtifactContent({ path: tempDir })).toThrow("Artifact path is not a file");

    const textPath = join(tempDir, "retention.txt");
    writeFileSync(textPath, "text\n");
    expect(() => storeArtifactContent({ path: textPath, retention_days: -1 })).toThrow(
      "retention_days must be a non-negative number",
    );

    const binaryPath = join(tempDir, "image.png");
    writeFileSync(binaryPath, Buffer.from([0, 1, 2, 3]));
    const binary = storeArtifactContent({ path: binaryPath })!;
    expect(binary.store.media_type).toBe("image/png");
    expect(binary.store.redaction).toEqual({ checked: false, status: "binary_or_unknown" });

    const credential = credentialFixture();
    expect(redactArtifactMetadata({ [credential.key]: credential.value, note: credential.assignment })).toEqual({
      [credential.key]: "[REDACTED]",
      note: credential.redactedAssignment,
    });
  });
});

describe("file-oriented artifact helpers", () => {
  test("copies or references files and computes hashes from observable bytes", () => {
    const sourcePath = join(tempDir, "source.log");
    writeFileSync(sourcePath, "test output\n");
    const expectedHash = createHash("sha256").update("test output\n").digest("hex");

    expect(computeContentHash(sourcePath)).toBe(expectedHash);
    const copied = storeArtifactFile({
      artifactId: "artifact-copy",
      sourcePath,
      name: "../renamed.log",
      dbPath: join(tempDir, "todos.db"),
    });
    expect(copied).toMatchObject({ contentHash: expectedHash, mimeType: "text/plain", sizeBytes: 12 });
    expect(copied.localPath).toBe(join(resolve(storeDir), "artifact-copy", "renamed.log"));
    expect(readFileSync(copied.localPath, "utf8")).toBe("test output\n");

    const referenced = storeArtifactFile({ artifactId: "artifact-ref", sourcePath, storageMode: "reference" });
    expect(referenced.localPath).toBe(resolve(sourcePath));
    expect(deleteStoredArtifactFile(referenced.localPath, "reference")).toBe(false);
    expect(existsSync(sourcePath)).toBe(true);

    expect(deleteStoredArtifactFile(copied.localPath, "copy")).toBe(true);
    expect(deleteStoredArtifactFile(copied.localPath, "copy")).toBe(false);
    expect(deleteStoredArtifactFile(null, "copy")).toBe(false);
  });

  test("rejects missing sources and directories", () => {
    expect(() => storeArtifactFile({
      artifactId: "missing",
      sourcePath: join(tempDir, "missing.log"),
    })).toThrow("Source file not found");
    expect(() => storeArtifactFile({ artifactId: "directory", sourcePath: tempDir })).toThrow(
      "Source path is not a file",
    );
    expect(() => computeContentHash(join(tempDir, "missing.log"))).toThrow();
  });

  test("applies strict retention boundaries and writes export manifests", () => {
    const now = new Date("2026-07-31T00:00:00.000Z");
    expect(isArtifactExpired(null, { now })).toBe(false);
    expect(isArtifactExpired("2026-07-01T00:00:00.000Z", { deleted_retention_days: 30, now })).toBe(false);
    expect(isArtifactExpired("2026-06-30T23:59:59.999Z", { deleted_retention_days: 30, now })).toBe(true);

    const dbPath = join(tempDir, "database", "todos.db");
    const manifest = buildArtifactExportManifest([], dbPath);
    expect(manifest).toMatchObject({
      schema_version: "todos.artifacts.v1",
      store_root: resolve(storeDir),
      artifacts: [],
    });
    expect(new Date(manifest.exported_at).toISOString()).toBe(manifest.exported_at);

    const outputPath = join(tempDir, "exports", "manifest.json");
    expect(writeArtifactExportManifest(manifest, outputPath)).toBe(resolve(outputPath));
    expect(JSON.parse(readFileSync(outputPath, "utf8"))).toEqual(manifest);
    expect(readFileSync(outputPath, "utf8").endsWith("\n")).toBe(true);
  });
});
