import { describe, expect, test } from "bun:test";
import { mkdtempSync, mkdirSync, writeFileSync, rmSync, existsSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { useDefaultTestTimeout } from "../test-preload.js";

useDefaultTestTimeout();
import { createEstateSync } from "@hasna/estate-sync";
import {
  createSkillsEstateSync,
  pushSkillBundleToEstate,
  pullSkillBundleFromEstate,
  resolveSkillsEstateSyncConfig,
  SKILLS_ESTATE_PREFIX,
} from "./estate-sync.js";

const BUCKET = "hasna-apps-prod-store-789877399345";
const CREDS = { accessKeyId: "test-access-key", secretAccessKey: "test-secret-key" };
const SIGNING_KEY = "skills-test-signing-key-32-bytes!";

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
    if (method === "HEAD") {
      return objects.has(key) ? new Response("", { status: 200 }) : new Response("", { status: 404 });
    }
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

function makeSkillDir(): string {
  const dir = mkdtempSync(join(tmpdir(), "skills-estate-test-"));
  mkdirSync(join(dir, "src"), { recursive: true });
  writeFileSync(join(dir, "SKILL.md"), "---\nname: estate-probe\n---\n# estate probe\n");
  writeFileSync(join(dir, "src", "index.ts"), "export const x = 1;\n");
  writeFileSync(join(dir, "package.json"), JSON.stringify({ name: "estate-probe", version: "1.0.0" }));
  return dir;
}

describe("skills estate-sync adapter", () => {
  test("resolveSkillsEstateSyncConfig defaults the prefix to the skills base prefix and requires a bucket", () => {
    const config = resolveSkillsEstateSyncConfig({
      HASNA_SKILLS_S3_BUCKET: BUCKET,
      HASNA_SKILLS_S3_PREFIX: "skills",
      ESTATE_SYNC_SIGNING_KEY: SIGNING_KEY,
    });
    expect(config.bucket).toBe(BUCKET);
    expect(config.prefix).toBe("skills");
    expect(config.signingKey).toBe(SIGNING_KEY);
    expect(SKILLS_ESTATE_PREFIX).toBe("skills");
    expect(() => resolveSkillsEstateSyncConfig({})).toThrow("HASNA_SKILLS_S3_BUCKET is required");
  });

  test("push writes a digest bundle and a signed index under the skills prefix", async () => {
    const { fetch, objects } = createMemoryS3Fetch();
    const client = createEstateSync({
      bucket: BUCKET,
      prefix: "skills",
      region: "us-east-1",
      credentials: CREDS,
      signingKey: SIGNING_KEY,
      fetch,
    });
    const dir = makeSkillDir();
    try {
      const result = await pushSkillBundleToEstate("estate-probe", dir, { client });
      expect(result.bundleKey.startsWith("skills/bundles/")).toBe(true);
      expect(result.indexKey).toBe("skills/index/estate-probe.json");
      const index = JSON.parse(new TextDecoder().decode(objects.get(result.indexKey)!)) as Record<string, unknown>;
      expect(index.digest).toBe(result.digest);
      expect(typeof index.signature).toBe("string");
      for (const key of objects.keys()) expect(key.startsWith("skills/")).toBe(true);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  test("pull resolves the index, verifies sha256, and hydrates the bundle bytes", async () => {
    const { fetch } = createMemoryS3Fetch();
    const client = createEstateSync({
      bucket: BUCKET,
      prefix: "skills",
      region: "us-east-1",
      credentials: CREDS,
      signingKey: SIGNING_KEY,
      fetch,
    });
    const dir = makeSkillDir();
    const outDir = mkdtempSync(join(tmpdir(), "skills-estate-out-"));
    const target = join(outDir, "bundle.tar.gz");
    try {
      const pushed = await pushSkillBundleToEstate("estate-probe", dir, { client });
      const pulled = await pullSkillBundleFromEstate("estate-probe", { hydrateTo: target, client });
      expect(pulled.digest).toBe(pushed.digest);
      expect(pulled.signatureVerified).toBe(true);
      expect(existsSync(target)).toBe(true);
    } finally {
      rmSync(dir, { recursive: true, force: true });
      rmSync(outDir, { recursive: true, force: true });
    }
  });
});
