import { describe, expect, test } from "bun:test";
import { mkdtempSync, mkdirSync, writeFileSync, rmSync, existsSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createEstateSync } from "@hasna/estate-sync";
import {
  createLoopsEstateSync,
  loopDir,
  loopPromptDir,
  loopScriptsDir,
  loopsEstateRoot,
  pullLoopFromEstate,
  pushLoopToEstate,
  resolveLoopsEstateSyncConfig,
  LOOPS_ESTATE_PREFIX,
} from "./estate-sync.js";

const BUCKET = "hasna-apps-prod-store-123456789012";
const CREDS = { accessKeyId: "test-access-key", secretAccessKey: "test-secret-key" };
const SIGNING_KEY = "loops-test-signing-key-32-bytes!";

function createMemoryS3Fetch() {
  const objects = new Map<string, Uint8Array>();
  const fetch = async (input: string | URL | Request, init?: RequestInit) => {
    const url = String(input);
    const method = (init?.method ?? "GET").toUpperCase();
    const parsed = new URL(url);
    const raw = parsed.pathname.replace(/^\/+/, "").replace(/\/+$/, "");
    const key = parsed.hostname.includes(".s3.") || parsed.hostname.endsWith(".s3.amazonaws.com")
      ? raw
      : raw.split("/").slice(1).join("/");
    if (method === "PUT") {
      objects.set(key, new Uint8Array(await new Response(init?.body as BodyInit).arrayBuffer()));
      return new Response("", { status: 200 });
    }
    if (method === "HEAD") return objects.has(key) ? new Response("", { status: 200 }) : new Response("", { status: 404 });
    const bytes = objects.get(key);
    if (!bytes) return new Response("", { status: 404 });
    return new Response(toArrayBuffer(bytes), { status: 200 });
  };
  return { fetch, objects };
}

function toArrayBuffer(bytes: Uint8Array): ArrayBuffer {
  const buffer = new ArrayBuffer(bytes.byteLength);
  new Uint8Array(buffer).set(bytes);
  return buffer;
}

describe("loops estate-sync adapter", () => {
  test("resolveLoopsEstateSyncConfig defaults the prefix to loops/ and requires a bucket", () => {
    const config = resolveLoopsEstateSyncConfig({ HASNA_LOOPS_S3_BUCKET: BUCKET, ESTATE_SYNC_SIGNING_KEY: SIGNING_KEY });
    expect(config.bucket).toBe(BUCKET);
    expect(config.prefix).toBe("loops");
    expect(config.signingKey).toBe(SIGNING_KEY);
    expect(LOOPS_ESTATE_PREFIX).toBe("loops");
    expect(() => resolveLoopsEstateSyncConfig({})).toThrow("HASNA_LOOPS_S3_BUCKET is required");
  });

  test("canonical local layout is ~/.hasna/loops/loops/<name>/ with prompt/ + scripts/ subdirs", () => {
    const oldDataDir = process.env.LOOPS_DATA_DIR;
    const base = mkdtempSync(join(tmpdir(), "loops-layout-test-"));
    process.env.LOOPS_DATA_DIR = base;
    try {
      expect(loopsEstateRoot()).toBe(join(base, "loops"));
      expect(loopDir("watch")).toBe(join(base, "loops", "watch"));
      expect(loopPromptDir("watch")).toBe(join(base, "loops", "watch", "prompt"));
      expect(loopScriptsDir("watch")).toBe(join(base, "loops", "watch", "scripts"));
      expect(() => loopDir("../escape")).toThrow("Invalid loop name");
    } finally {
      process.env.LOOPS_DATA_DIR = oldDataDir;
      rmSync(base, { recursive: true, force: true });
    }
  });

  test("push writes a digest bundle and a signed index under the loops prefix", async () => {
    const { fetch, objects } = createMemoryS3Fetch();
    const client = createEstateSync({
      bucket: BUCKET,
      prefix: "loops",
      region: "us-east-1",
      credentials: CREDS,
      signingKey: SIGNING_KEY,
      fetch,
    });
    const dir = mkdtempSync(join(tmpdir(), "loops-push-test-"));
    mkdirSync(join(dir, "prompt"), { recursive: true });
    mkdirSync(join(dir, "scripts"), { recursive: true });
    writeFileSync(join(dir, "prompt", "loop.txt"), "run every 30m\n");
    writeFileSync(join(dir, "scripts", "run.sh"), "#!/usr/bin/env bash\n");
    try {
      const result = await pushLoopToEstate("watch", dir, { client });
      expect(result.bundleKey.startsWith("loops/bundles/")).toBe(true);
      expect(result.indexKey).toBe("loops/index/watch.json");
      const index = JSON.parse(new TextDecoder().decode(objects.get(result.indexKey)!)) as Record<string, unknown>;
      expect(index.digest).toBe(result.digest);
      expect(typeof index.signature).toBe("string");
      for (const key of objects.keys()) expect(key.startsWith("loops/")).toBe(true);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  test("pull resolves the index, verifies sha256, and hydrates the bundle bytes", async () => {
    const { fetch } = createMemoryS3Fetch();
    const client = createEstateSync({
      bucket: BUCKET,
      prefix: "loops",
      region: "us-east-1",
      credentials: CREDS,
      signingKey: SIGNING_KEY,
      fetch,
    });
    const dir = mkdtempSync(join(tmpdir(), "loops-pull-src-"));
    const outDir = mkdtempSync(join(tmpdir(), "loops-pull-out-"));
    const target = join(outDir, "watch.tar.gz");
    try {
      const pushed = await pushLoopToEstate("watch", dir, { client });
      const pulled = await pullLoopFromEstate("watch", { hydrateTo: target, client });
      expect(pulled.digest).toBe(pushed.digest);
      expect(pulled.signatureVerified).toBe(true);
      expect(existsSync(target)).toBe(true);
    } finally {
      rmSync(dir, { recursive: true, force: true });
      rmSync(outDir, { recursive: true, force: true });
    }
  });
});
