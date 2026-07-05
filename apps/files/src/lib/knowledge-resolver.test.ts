import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

const ENV_KEYS = [
  "HASNA_FILES_DATA_DIR",
  "HASNA_FILES_DB_PATH",
  "AWS_ACCESS_KEY_ID",
  "AWS_SECRET_ACCESS_KEY",
] as const;
const savedEnv = new Map<string, string | undefined>();
let testDir: string | undefined;

for (const key of ENV_KEYS) savedEnv.set(key, process.env[key]);

beforeEach(() => {
  testDir = mkdtempSync(join(tmpdir(), "files-knowledge-resolver-"));
  process.env.HASNA_FILES_DATA_DIR = testDir;
  process.env.HASNA_FILES_DB_PATH = join(testDir, "files.db");
  process.env.AWS_ACCESS_KEY_ID = "test-access-key";
  process.env.AWS_SECRET_ACCESS_KEY = "test-secret-key";
});

afterEach(async () => {
  const { closeDb } = await import("../db/database.js");
  closeDb();
  for (const key of ENV_KEYS) {
    const value = savedEnv.get(key);
    if (value === undefined) delete process.env[key];
    else process.env[key] = value;
  }
  if (testDir) rmSync(testDir, { recursive: true, force: true });
  testDir = undefined;
});

describe("knowledge source resolver", () => {
  test("performs bounded local content reads and writes audit metadata when an agent is supplied", async () => {
    const { getCurrentMachine } = await import("../db/machines.js");
    const { createSource } = await import("../db/sources.js");
    const { upsertFile } = await import("../db/files.js");
    const { registerAgent } = await import("../db/agents.js");
    const { getAgentActivity } = await import("../db/activity.js");
    const { buildOpenFilesFileRef } = await import("./source-ref.js");
    const { resolveKnowledgeSourceRef } = await import("./knowledge-resolver.js");

    const sourceRoot = join(testDir!, "source");
    mkdirSync(sourceRoot, { recursive: true });
    const text = "First line\nSecond line\nThird line\n";
    writeFileSync(join(sourceRoot, "notes.md"), text);

    const machine = getCurrentMachine();
    const source = createSource({
      name: "Resolver docs",
      type: "local",
      path: sourceRoot,
      machine_id: machine.id,
    });
    const file = upsertFile({
      id: "f_resolverLocal",
      source_id: source.id,
      machine_id: machine.id,
      path: "notes.md",
      name: "notes.md",
      ext: ".md",
      size: Buffer.byteLength(text),
      mime: "text/markdown",
      hash: "a".repeat(64),
      status: "active",
      modified_at: "2026-06-09T00:00:00.000Z",
    });
    const agent = registerAgent("resolver-test-agent", "sess_resolver");

    const result = await resolveKnowledgeSourceRef(buildOpenFilesFileRef(file.id), {
      mode: "content",
      max_bytes: 12,
      agent_id: agent.id,
      session_id: "sess_resolver",
    });

    expect(result.status).toBe("too_large");
    expect(result.source_ref).toMatch(/^open-files:\/\/file\/f_resolverLocal\/revision\/rev_/);
    expect(result.permissions).toMatchObject({ mode: "read_only", write: false, requested_mode: "content" });
    expect(result.content).toMatchObject({
      mime: "text/markdown",
      bytes_read: 12,
      truncated: true,
      encoding: "utf-8",
      text: "First line\nS",
    });
    expect(result.storage).toMatchObject({ provider: "local", source_id: source.id });

    const events = getAgentActivity(agent.id, { action: "read" });
    expect(events).toHaveLength(1);
    expect(events[0]!.metadata).toMatchObject({
      resolver: "knowledge_source",
      mode: "content",
      purpose: "knowledge_index",
      status: "too_large",
      bytes_read: 12,
    });
    expect(JSON.stringify(events[0]!.metadata)).not.toContain("First line");
  });

  test("returns extracted text snapshots through the same read-only policy", async () => {
    const { getCurrentMachine } = await import("../db/machines.js");
    const { createSource } = await import("../db/sources.js");
    const { upsertFile } = await import("../db/files.js");
    const { buildOpenFilesFileRef } = await import("./source-ref.js");
    const { resolveKnowledgeSourceRef } = await import("./knowledge-resolver.js");

    const sourceRoot = join(testDir!, "snapshot-source");
    mkdirSync(sourceRoot, { recursive: true });
    const text = "# Heading\nBody text for semantic chunking.\n";
    writeFileSync(join(sourceRoot, "snapshot.md"), text);

    const machine = getCurrentMachine();
    const source = createSource({
      name: "Snapshot docs",
      type: "local",
      path: sourceRoot,
      machine_id: machine.id,
    });
    const file = upsertFile({
      id: "f_resolverSnapshot",
      source_id: source.id,
      machine_id: machine.id,
      path: "snapshot.md",
      name: "snapshot.md",
      ext: ".md",
      size: Buffer.byteLength(text),
      mime: "text/markdown",
      hash: "b".repeat(64),
      status: "active",
      modified_at: "2026-06-09T00:00:00.000Z",
    });

    const result = await resolveKnowledgeSourceRef(buildOpenFilesFileRef(file.id), {
      mode: "snapshot",
      max_segment_chars: 80,
    });

    expect(result.status).toBe("ready");
    expect(result.extracted_text?.status).toBe("ready");
    expect(result.snapshot?.snapshot_id).toMatch(/^snap_/);
    expect(result.snapshot?.sections[0]?.title).toBe("Heading");
    expect(result.content.extraction).toMatchObject({
      status: "ready",
      extractor: "open-files-text-v1",
      snapshot_id: result.snapshot?.snapshot_id,
    });
  });

  test("denies unsafe source path refs before touching storage", async () => {
    const { getCurrentMachine } = await import("../db/machines.js");
    const { createSource } = await import("../db/sources.js");
    const { buildOpenFilesSourcePathRef } = await import("./source-ref.js");
    const { resolveKnowledgeSourceRef } = await import("./knowledge-resolver.js");

    const machine = getCurrentMachine();
    const source = createSource({
      name: "Unsafe source",
      type: "local",
      path: join(testDir!, "safe-root"),
      machine_id: machine.id,
    });

    const result = await resolveKnowledgeSourceRef(buildOpenFilesSourcePathRef(source.id, "../secret.txt"), {
      mode: "content",
    });

    expect(result.status).toBe("denied");
    expect(result.status_reason).toContain("unsafe path segments");
    expect(result.source_id).toBe(source.id);
    expect(result.content.text).toBeUndefined();
  });

  test("resolves private evidence asset refs as metadata-only", async () => {
    const { createFileAsset, updateFileAssetStatus } = await import("../db/evidence.js");
    const { buildOpenFilesAssetRef } = await import("./source-ref.js");
    const { resolveKnowledgeSourceRef } = await import("./knowledge-resolver.js");

    createFileAsset({
      id: "asset_resolver_fleet",
      org_id: "org_1",
      app: "machines",
      kind: "fleet_manifest",
      classification: "restricted",
      original_name: "fleet-manifest.json",
      content_type: "application/json",
      size: 2048,
      checksum: "8".repeat(64),
      checksum_algorithm: "sha256",
      storage_provider: "s3",
      bucket: "hasna-xyz-opensource-files-prod",
      region: "us-east-1",
      object_key: "private/fleet/manifests/asset_resolver_fleet.json",
    });
    updateFileAssetStatus({ id: "asset_resolver_fleet", status: "verified", scan_status: "clean", verified: true });

    const sourceRef = buildOpenFilesAssetRef("asset_resolver_fleet");
    const metadata = await resolveKnowledgeSourceRef(sourceRef, {
      mode: "metadata",
      purpose: "agent_context",
    });
    const content = await resolveKnowledgeSourceRef(sourceRef, {
      mode: "content",
      purpose: "agent_context",
    });

    expect(metadata).toMatchObject({
      source_ref: sourceRef,
      requested_ref: sourceRef,
      status: "ready",
      storage: {
        provider: "s3",
        bucket: "hasna-xyz-opensource-files-prod",
        key: "private/fleet/manifests/asset_resolver_fleet.json",
      },
      content: {
        mime: "application/json",
        size: 2048,
        hash: `sha256:${"8".repeat(64)}`,
        text_available: false,
      },
      permissions: {
        mode: "read_only",
        purpose: "agent_context",
        requested_mode: "metadata",
        write: false,
      },
    });
    expect(metadata.content.text).toBeUndefined();
    expect(content.status).toBe("unsupported");
    expect(content.status_reason).toContain("metadata-only");
    expect(content.content.text).toBeUndefined();
  });

  test("denies reads from disabled sources", async () => {
    const { getCurrentMachine } = await import("../db/machines.js");
    const { createSource, updateSource } = await import("../db/sources.js");
    const { upsertFile } = await import("../db/files.js");
    const { buildOpenFilesFileRef } = await import("./source-ref.js");
    const { resolveKnowledgeSourceRef } = await import("./knowledge-resolver.js");

    const sourceRoot = join(testDir!, "disabled-source");
    mkdirSync(sourceRoot, { recursive: true });
    writeFileSync(join(sourceRoot, "blocked.txt"), "blocked");

    const machine = getCurrentMachine();
    const source = createSource({
      name: "Disabled docs",
      type: "local",
      path: sourceRoot,
      machine_id: machine.id,
    });
    const file = upsertFile({
      id: "f_disabledResolver",
      source_id: source.id,
      machine_id: machine.id,
      path: "blocked.txt",
      name: "blocked.txt",
      ext: ".txt",
      size: 7,
      mime: "text/plain",
      status: "active",
    });
    updateSource(source.id, { enabled: false });

    const result = await resolveKnowledgeSourceRef(buildOpenFilesFileRef(file.id), { mode: "content" });

    expect(result.status).toBe("denied");
    expect(result.status_reason).toBe("Source is disabled.");
    expect(result.content.text).toBeUndefined();
  });

  test("creates read-only S3 signed URLs only for scoped source buckets", async () => {
    const { getCurrentMachine } = await import("../db/machines.js");
    const { createSource } = await import("../db/sources.js");
    const { upsertFile } = await import("../db/files.js");
    const { buildOpenFilesFileRef } = await import("./source-ref.js");
    const { resolveKnowledgeSourceRef } = await import("./knowledge-resolver.js");

    const machine = getCurrentMachine();
    const source = createSource({
      name: "S3 docs",
      type: "s3",
      bucket: "hasna-xyz-opensource-files-test",
      region: "us-east-1",
      config: {},
      machine_id: machine.id,
    });
    const file = upsertFile({
      id: "f_s3Resolver",
      source_id: source.id,
      machine_id: machine.id,
      path: "docs/readme.md",
      name: "readme.md",
      ext: ".md",
      size: 20,
      mime: "text/markdown",
      hash: "etag-value",
      status: "active",
    });

    const result = await resolveKnowledgeSourceRef(buildOpenFilesFileRef(file.id), {
      mode: "signed_url",
      signed_url_expires_in: 120,
    });

    expect(result.status).toBe("ready");
    expect(result.storage).toMatchObject({
      provider: "s3",
      bucket: "hasna-xyz-opensource-files-test",
      key: "docs/readme.md",
    });
    expect(result.access).toMatchObject({ kind: "signed_url", method: "GET" });
    expect(result.access?.url).toContain("X-Amz-Signature");
    expect(decodeURIComponent(result.access?.url ?? "")).toContain("docs/readme.md");
    expect(result.permissions.write).toBe(false);
  });

  test("denies S3 revision reads when the revision bucket is outside the source credential scope", async () => {
    const { getCurrentMachine } = await import("../db/machines.js");
    const { createSource } = await import("../db/sources.js");
    const { upsertFile } = await import("../db/files.js");
    const { createFileVersion } = await import("../db/file-versions.js");
    const { resolveKnowledgeSourceRef } = await import("./knowledge-resolver.js");

    const machine = getCurrentMachine();
    const source = createSource({
      name: "Scoped S3 docs",
      type: "s3",
      bucket: "allowed-bucket",
      region: "us-east-1",
      config: {},
      machine_id: machine.id,
    });
    const file = upsertFile({
      id: "f_s3ScopeResolver",
      source_id: source.id,
      machine_id: machine.id,
      path: "docs/current.md",
      name: "current.md",
      ext: ".md",
      size: 10,
      mime: "text/markdown",
      hash: "current-etag",
      status: "active",
    });
    const foreignRevision = createFileVersion({
      file_id: file.id,
      source_id: source.id,
      content_hash_algorithm: "sha256",
      content_hash: "c".repeat(64),
      size: 10,
      mime: "text/markdown",
      storage_provider: "s3",
      bucket: "foreign-bucket",
      region: "us-east-1",
      object_key: "docs/current.md",
      source_path: "docs/current.md",
      indexed_at: "2026-06-09T00:00:00.000Z",
      state: "active",
    });

    const result = await resolveKnowledgeSourceRef(foreignRevision.source_ref, { mode: "signed_url" });

    expect(result.status).toBe("unsupported");
    expect(result.status_reason).toContain("No scoped S3 credentials");
    expect(result.access).toBeUndefined();
  });
});
