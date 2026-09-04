/**
 * Immutable, versioned skill artefacts (hasna/apps#1630), end to end over HTTP against
 * every storage backend, with the bucket replaced by an in-memory S3 stand-in that records
 * exactly which keys were written.
 *
 * The claims under test are the ones the workspace-remote design makes: a push lands the
 * bundle and its manifest under skills/<org>/<slug>/<version>/; the same name@version with
 * the same bytes is idempotent; with different bytes it is refused and leaves nothing in
 * the bucket; --force-new-version publishes the next patch; an older version's bytes stay
 * retrievable, digest-verified, after the slug moved on; and other orgs see none of it.
 */
import { describe, expect, test } from "bun:test";
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { DeleteObjectCommand, GetObjectCommand, PutObjectCommand } from "@aws-sdk/client-s3";
import { pushSkill, PushSkillError } from "../cli/commands/publish.js";
import { RemoteSkillsClient } from "../lib/remote-client.js";
import { PULL_MARKER_FILE, pullSkills } from "../lib/pull.js";
import { sha256Hex } from "../lib/skill-bundle.js";
import { createSkillsFetchHandler } from "./app.js";
import { publicPrincipal } from "./auth.js";
import { MemorySkillsStore } from "./store.js";
import { ArtifactStorage, type S3ClientLike } from "./artifact-storage.js";
import { resolveStoreBackends } from "./store-fixtures.js";
import { useDefaultTestTimeout } from "../test-preload.js";

useDefaultTestTimeout();

const TOKEN = "sk_versions_org_a";
const OTHER_TOKEN = "sk_versions_org_b";
const ORG = { orgId: "org_va", orgSlug: "org-va", orgName: "Org VA", userId: "user_va", email: "va@example.com", apiKeyId: "key_va" };
const OTHER = { orgId: "org_vb", orgSlug: "org-vb", orgName: "Org VB", userId: "user_vb", email: "vb@example.com", apiKeyId: "key_vb" };
const PREFIX = "prod/artifacts";
const BUCKET = "hasna-oss-skills-test";

// A SKILL.md-first instruction skill, the shape most of the corpus has: no skill.json, so
// the strict portable contract (self-referencing content_hash) does not apply.
const SKILL_V1: Record<string, string> = {
  "SKILL.md": "---\nname: release-notes\ndescription: Draft release notes from a changelog\nversion: 2.1.0\nkind: instruction\n---\n\n# Release Notes\n\nDrafts release notes.\n",
  "references/style-guide.md": "Use the imperative mood.\n",
};

/** An S3 client that keeps objects in a Map, so a test can assert on the exact keys. */
class FakeS3 implements S3ClientLike {
  objects = new Map<string, Uint8Array>();
  async send(command: PutObjectCommand | GetObjectCommand | DeleteObjectCommand): Promise<{ Body?: unknown }> {
    const key = command.input.Key!;
    if (command instanceof PutObjectCommand) {
      const body = command.input.Body as Uint8Array | string;
      this.objects.set(key, typeof body === "string" ? new TextEncoder().encode(body) : new Uint8Array(body));
      return {};
    }
    if (command instanceof GetObjectCommand) {
      const found = this.objects.get(key);
      if (!found) throw Object.assign(new Error("NoSuchKey"), { name: "NoSuchKey" });
      return { Body: found };
    }
    this.objects.delete(key);
    return {};
  }
  keys(): string[] {
    return [...this.objects.keys()].sort();
  }
}

function makeCorpus(files: Record<string, string>): string {
  const root = mkdtempSync(join(tmpdir(), "skills-versions-corpus-"));
  for (const [path, content] of Object.entries(files)) {
    const absolute = join(root, "release-notes", path);
    mkdirSync(dirname(absolute), { recursive: true });
    writeFileSync(absolute, content);
  }
  return root;
}

const backends = await resolveStoreBackends();

for (const backend of backends) {
  describe(`skill versions over HTTP (${backend.name})`, () => {
    test("push stores bundle + manifest per version, refuses silent overwrites, and serves old versions verified", async () => {
      const fixture = await backend.create([
        { token: TOKEN, principal: ORG },
        { token: OTHER_TOKEN, principal: OTHER },
      ]);
      const s3 = new FakeS3();
      const artifactStorage = new ArtifactStorage({ bucket: BUCKET, prefix: PREFIX, client: s3 });
      const fetchHandler = await createSkillsFetchHandler({
        store: fixture.store,
        artifactStorage,
        config: { inlineWorker: false, allowEphemeralStore: true },
      });
      const server = Bun.serve({ port: 0, fetch: fetchHandler });
      const root = makeCorpus(SKILL_V1);
      try {
        const baseUrl = `http://127.0.0.1:${server.port}`;
        const client = new RemoteSkillsClient(TOKEN, baseUrl);

        // 1. First push: content-addressed object + version-addressed bundle + manifest.
        const first = await pushSkill("release-notes", { rootDir: root, client });
        expect(first.published).toBe(true);
        expect(first.version).toBe("2.1.0");
        const v1Prefix = `${PREFIX}/skills/${ORG.orgId}/release-notes/2.1.0`;
        expect(s3.keys()).toEqual([
          `${PREFIX}/bundles/${ORG.orgId}/${first.sha256}.tar.gz`,
          `${v1Prefix}/bundle.tar.gz`,
          `${v1Prefix}/manifest.json`,
        ]);
        expect(sha256Hex(s3.objects.get(`${v1Prefix}/bundle.tar.gz`)!)).toBe(first.sha256);
        const manifest = JSON.parse(new TextDecoder().decode(s3.objects.get(`${v1Prefix}/manifest.json`)!)) as Record<string, unknown>;
        expect(manifest).toMatchObject({ slug: "release-notes", version: "2.1.0", bundleSha256: first.sha256, bundleByteSize: first.bundleByteSize });
        const files = manifest.files as Array<{ path: string; sha256: string; byteSize: number }>;
        expect(files.map((f) => f.path)).toEqual(["SKILL.md", "references/style-guide.md"]);
        for (const file of files) {
          expect(file.sha256).toBe(sha256Hex(new TextEncoder().encode(SKILL_V1[file.path]!)));
        }
        expect(manifest.provenance).toMatchObject({ machine: expect.any(String), cliVersion: expect.any(String), packedAt: expect.any(String) });

        // 2. Same bytes again: idempotent, nothing new in the bucket.
        const again = await pushSkill("release-notes", { rootDir: root, client });
        expect(again.published).toBe(true);
        expect(again.sha256).toBe(first.sha256);
        expect(s3.keys()).toHaveLength(3);
        expect(await client.listSkillVersions("release-notes")).toHaveLength(1);

        // 3. Different bytes under the same version: refused, and the bucket is untouched.
        writeFileSync(join(root, "release-notes", "references", "style-guide.md"), "Use the imperative mood. Keep it short.\n");
        const keysBefore = s3.keys();
        let refused: unknown;
        try {
          await pushSkill("release-notes", { rootDir: root, client });
        } catch (error) {
          refused = error;
        }
        expect(refused).toBeInstanceOf(PushSkillError);
        expect(String((refused as Error).message)).toContain("already exists");
        expect(s3.keys()).toEqual(keysBefore);
        expect(await client.listSkillVersions("release-notes")).toHaveLength(1);

        // 4. --force-new-version publishes the next patch and keeps both versions.
        const forced = await pushSkill("release-notes", { rootDir: root, client, forceNewVersion: true });
        expect(forced.published).toBe(true);
        expect(forced.version).toBe("2.1.1");
        expect(forced.sha256).not.toBe(first.sha256);
        const versions = await client.listSkillVersions("release-notes");
        expect(versions.map((v) => [v.version, v.bundleSha256])).toEqual([
          ["2.1.1", forced.sha256],
          ["2.1.0", first.sha256],
        ]);
        expect(s3.keys()).toContain(`${PREFIX}/skills/${ORG.orgId}/release-notes/2.1.1/bundle.tar.gz`);
        expect(s3.keys()).toContain(`${PREFIX}/skills/${ORG.orgId}/release-notes/2.1.1/manifest.json`);
        // The v1 content-addressed object survived the re-publish: a version references it.
        expect(s3.keys()).toContain(`${PREFIX}/bundles/${ORG.orgId}/${first.sha256}.tar.gz`);

        // 5. Pull an exact version: bytes match the recorded digest and the header names it.
        const v1 = await client.getBundle("release-notes", "2.1.0");
        expect(v1?.status).toBe(200);
        expect(v1?.headers.get("x-skill-version")).toBe("2.1.0");
        const v1Bytes = new Uint8Array(await v1!.arrayBuffer());
        expect(sha256Hex(v1Bytes)).toBe(first.sha256);
        const current = await client.getBundle("release-notes");
        expect(sha256Hex(new Uint8Array(await current!.arrayBuffer()))).toBe(forced.sha256);
        expect(await client.getSkillVersion("release-notes", "2.1.0")).toMatchObject({ version: "2.1.0", bundleSha256: first.sha256 });
        expect(await client.getSkillVersion("release-notes", "9.9.9")).toBeNull();
        expect(await client.getBundle("release-notes", "9.9.9")).toBeNull();


        // 5b. The CLI pull path, over HTTP, into a fresh machine corpus: an OLDER version
        // installs with its own digest (no revision proof against the current row), and a
        // bare pull then installs the current one.
        const corpus = mkdtempSync(join(tmpdir(), "skills-versions-pull-corpus-"));
        try {
          const old = await pullSkills({ names: ["release-notes@2.1.0"], rootDir: corpus, client });
          expect(old.results[0]).toMatchObject({ success: true, version: "2.1.0", contentHash: first.sha256 });
          expect(readFileSync(join(corpus, "release-notes", "references", "style-guide.md"), "utf-8")).toBe("Use the imperative mood.\n");
          const marker = JSON.parse(readFileSync(join(corpus, "release-notes", PULL_MARKER_FILE), "utf-8")) as { version: string; contentHash: string; revisionId?: string };
          expect(marker).toMatchObject({ version: "2.1.0", contentHash: first.sha256 });
          expect(marker.revisionId).toBeUndefined();
          const latest = await pullSkills({ names: ["release-notes"], rootDir: corpus, client });
          expect(latest.results[0]).toMatchObject({ success: true, version: "2.1.1", contentHash: forced.sha256 });
          expect(latest.results[0].revisionId).toMatch(/^[0-9a-f]{64}$/);
          const absent = await pullSkills({ names: ["release-notes@3.0.0"], rootDir: corpus, client });
          expect(absent.results[0].success).toBe(false);
          expect(absent.results[0].error).toContain("skills versions release-notes");
        } finally {
          rmSync(corpus, { recursive: true, force: true });
        }

        // 5c. Version strings are a closed alphabet on the way in and on the way out.
        for (const bad of ["..", "a/b", "x".repeat(200), ".hidden"]) {
          const attempt = await client.publishSkill(
            { slug: "release-notes", displayName: "Release Notes", description: "d", category: "Content Generation", tags: [], kind: "instruction", version: bad, source: "custom", bundleSha256: first.sha256, contentHash: first.sha256 },
            v1Bytes,
            (await client.getSkill("release-notes"))?.revisionId as string,
          );
          expect([400, 409]).toContain(attempt.status);
          expect(attempt.status).toBe(400);
          expect(((await attempt.json()) as { code?: string }).code).toBe("INVALID_VERSION");
        }
        const traversal = await fetch(`${baseUrl}/api/v1/skills/release-notes/versions/..%2F..%2Fx/bundle`, { headers: { authorization: `Bearer ${TOKEN}` } });
        expect([400, 404]).toContain(traversal.status);
        expect(s3.keys().some((key) => key.includes(".."))).toBe(false);

        // 6. Another org sees nothing.
        const other = new RemoteSkillsClient(OTHER_TOKEN, baseUrl);
        expect(await other.listSkillVersions("release-notes")).toEqual([]);
        expect(await other.getSkillVersion("release-notes", "2.1.0")).toBeNull();

        // 7. Deleting the skill keeps the version history's bytes (they are referenced).
        const del = await fetch(`${baseUrl}/api/v1/skills/release-notes`, { method: "DELETE", headers: { authorization: `Bearer ${TOKEN}` } });
        expect([200, 204]).toContain(del.status);
        expect(s3.keys()).toContain(`${PREFIX}/bundles/${ORG.orgId}/${first.sha256}.tar.gz`);
        expect(s3.keys()).toContain(`${PREFIX}/bundles/${ORG.orgId}/${forced.sha256}.tar.gz`);
        expect(await client.listSkillVersions("release-notes")).toHaveLength(2);
        // 7b. ...but the CONTENT of a deleted slug is withheld, historic versions included.
        const withheld = await fetch(`${baseUrl}/api/v1/skills/release-notes/versions/2.1.0/bundle`, { headers: { authorization: `Bearer ${TOKEN}` } });
        expect(withheld.status).toBe(410);
        expect(((await withheld.json()) as { code?: string }).code).toBe("SKILL_DELETED");
      } finally {
        server.stop(true);
        rmSync(root, { recursive: true, force: true });
        await fixture.close();
      }
    });

    test("a version-only publish never invents a version row when no bundle bytes travel", async () => {
      const fixture = await backend.create([{ token: TOKEN, principal: ORG }]);
      const s3 = new FakeS3();
      const fetchHandler = await createSkillsFetchHandler({
        store: fixture.store,
        artifactStorage: new ArtifactStorage({ bucket: BUCKET, prefix: PREFIX, client: s3 }),
        config: { inlineWorker: false, allowEphemeralStore: true },
      });
      const server = Bun.serve({ port: 0, fetch: fetchHandler });
      try {
        const response = await fetch(`http://127.0.0.1:${server.port}/api/v1/skills`, {
          method: "POST",
          headers: { authorization: `Bearer ${TOKEN}`, "content-type": "application/json" },
          body: JSON.stringify({ slug: "prose-only", displayName: "Prose", description: "d", category: "Development Tools", tags: [], kind: "instruction", version: "1.0.0", source: "custom", skillMd: "# Prose\n" }),
        });
        expect(response.status).toBe(201);
        expect(await fixture.store.listSkillVersions({ ...ORG, role: "owner", scopes: ["skills:read"] } as never, "prose-only")).toEqual([]);
        expect(s3.keys()).toEqual([]);
      } finally {
        server.stop(true);
        await fixture.close();
      }
    });
  });
}

describe("a version-object write that fails after the row commit heals on retry", () => {
  test("the publisher is told, the row does not pretend, and the same push writes the objects", async () => {
    const store = new MemorySkillsStore();
    await store.ensureBootstrapApiKey(TOKEN, ORG);
    // Fails only the version-addressed PUTs, the way a bucket policy or a transient S3
    // error would: the content-addressed object still lands, so reads keep working and
    // the missing browsable copy is exactly the state that must not become permanent.
    class FailingVersionS3 extends FakeS3 {
      failVersionPuts = true;
      override async send(command: PutObjectCommand | GetObjectCommand | DeleteObjectCommand): Promise<{ Body?: unknown }> {
        const key = command.input.Key!;
        if (this.failVersionPuts && command instanceof PutObjectCommand && key.includes("/skills/")) {
          throw new Error("AccessDenied: simulated bucket failure");
        }
        return super.send(command);
      }
    }
    const s3 = new FailingVersionS3();
    const fetchHandler = await createSkillsFetchHandler({
      store,
      artifactStorage: new ArtifactStorage({ bucket: BUCKET, prefix: PREFIX, client: s3 }),
      config: { inlineWorker: false, allowEphemeralStore: true },
    });
    const server = Bun.serve({ port: 0, fetch: fetchHandler });
    const root = makeCorpus(SKILL_V1);
    try {
      const client = new RemoteSkillsClient(TOKEN, `http://127.0.0.1:${server.port}`);
      const failed = await pushSkill("release-notes", { rootDir: root, client }).catch((error: Error) => error);
      expect(failed).toBeInstanceOf(PushSkillError);
      expect(String((failed as Error).message)).toContain("502");
      // Nothing pretends the version-addressed copy exists.
      expect(s3.keys().filter((key) => key.includes("/skills/"))).toEqual([]);

      // The bucket recovers; the identical push is what repairs it.
      s3.failVersionPuts = false;
      const healed = await pushSkill("release-notes", { rootDir: root, client });
      expect(healed.published).toBe(true);
      expect(healed.version).toBe("2.1.0");
      const prefix = `${PREFIX}/skills/${ORG.orgId}/release-notes/2.1.0`;
      expect(s3.keys()).toContain(`${prefix}/bundle.tar.gz`);
      expect(s3.keys()).toContain(`${prefix}/manifest.json`);
      expect(sha256Hex(s3.objects.get(`${prefix}/bundle.tar.gz`)!)).toBe(healed.sha256);
      const manifest = JSON.parse(new TextDecoder().decode(s3.objects.get(`${prefix}/manifest.json`)!)) as Record<string, unknown>;
      expect(manifest).toMatchObject({ slug: "release-notes", version: "2.1.0", bundleSha256: healed.sha256 });
      // Still one immutable version, and its recorded storage key is the one that now exists.
      const versions = await client.listSkillVersions("release-notes");
      expect(versions).toHaveLength(1);
      expect(versions[0]).toMatchObject({ version: "2.1.0", bundleSha256: healed.sha256 });
      const stored = await store.getSkillVersion(publicPrincipal(ORG), "release-notes", "2.1.0");
      expect(stored?.storageKey).toBe(`${prefix}/bundle.tar.gz`);
      expect(s3.objects.has(stored!.storageKey!)).toBe(true);
    } finally {
      server.stop(true);
      rmSync(root, { recursive: true, force: true });
    }
  });
});
