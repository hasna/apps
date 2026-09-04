/**
 * The publish path's edge cases, and the one behaviour the sha256 column exists for.
 *
 * Uses SqliteSkillsStore directly rather than a parameterised fixture because these tests
 * need to reach past the store and corrupt what is on disk - which is the only way to
 * simulate the storage drift the digest is there to detect. The cross-backend behaviour is
 * covered in store-parity.test.ts.
 */
import { describe, expect, test } from "bun:test";
import { useDefaultTestTimeout } from "../test-preload.js";

useDefaultTestTimeout();
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { publicPrincipal } from "./auth.js";
import { ArtifactStorage } from "./artifact-storage.js";
import { resolveServerConfig } from "./config.js";
import { SkillRequestError, parsePublishRequest, readPublishedBundle, storePublishedSkill } from "./skills-api.js";
import { SqliteSkillsStore } from "./sqlite-store.js";
import { ownBytes } from "../lib/skill-bundle.js";
import type { OwnedBytes } from "../lib/skill-bundle.js";
import { SkillRevisionConflictError, type ApiPrincipal } from "./types.js";

const PRINCIPAL: ApiPrincipal = publicPrincipal({
  orgId: "org_a", orgSlug: "org-a", orgName: "Org A", userId: "user_a", email: "a@example.com", apiKeyId: "key_a",
});

const CONFIG = resolveServerConfig({});

function withStore(fn: (store: SqliteSkillsStore) => Promise<void>): Promise<void> {
  const dir = mkdtempSync(join(tmpdir(), "skills-api-test-"));
  const store = new SqliteSkillsStore(join(dir, "server.db"));
  return (async () => {
    try {
      await store.ensureBootstrapApiKey("sk_test", PRINCIPAL);
      await fn(store);
    } finally {
      await store.close();
      rmSync(dir, { recursive: true, force: true });
    }
  })();
}

function publishRequest(manifest: Record<string, unknown>, bundle?: Uint8Array): Request {
  const form = new FormData();
  form.set("manifest", JSON.stringify(manifest));
  if (bundle) form.set("bundle", new Blob([bundle as BlobPart], { type: "application/gzip" }), "skill.tar.gz");
  return new Request("https://test.invalid/api/v1/skills", { method: "POST", body: form });
}

const BUNDLE = ownBytes(new TextEncoder().encode("not really a tarball, but it is bytes and it has a digest"));

async function publish(store: SqliteSkillsStore, manifest: Record<string, unknown>, bundle?: Uint8Array) {
  const storage = new ArtifactStorage({});
  const parsed = await parsePublishRequest(publishRequest(manifest, bundle), CONFIG);
  return storePublishedSkill(store, storage, PRINCIPAL, parsed);
}

describe("bundle digest verification", () => {
  test("a stored bundle that no longer matches its digest is refused, not served", async () => {
    await withStore(async (store) => {
      const storage = new ArtifactStorage({});
      const record = await publish(store, { slug: "drifty", description: "a skill" }, BUNDLE);
      expect(record.bundleSha256).toBeTruthy();

      // Control first: it reads back correctly before anything is corrupted. Without
      // this, the rejection below could be caused by the bundle never having been stored.
      const before = await readPublishedBundle(store, storage, PRINCIPAL, "drifty");
      expect(Array.from(before.bytes)).toEqual(Array.from(BUNDLE));

      // Corrupt the blob behind the store's back: a bad restore, a truncated write, an S3
      // object replaced out of band. Every one of those is silent without this check.
      store.database.run("UPDATE skills_bundles SET body_blob = ? WHERE sha256 = ?", [
        new Uint8Array(new TextEncoder().encode("tampered")),
        record.bundleSha256!,
      ]);

      await expect(readPublishedBundle(store, storage, PRINCIPAL, "drifty")).rejects.toThrow(/hashes to .* but was published as/);
      try {
        await readPublishedBundle(store, storage, PRINCIPAL, "drifty");
        throw new Error("expected a SkillRequestError");
      } catch (error) {
        expect(error).toBeInstanceOf(SkillRequestError);
        expect((error as SkillRequestError).code).toBe("BUNDLE_DIGEST_DRIFT");
      }
    });
  });

  test("a skill published without a bundle reports that, rather than an empty download", async () => {
    await withStore(async (store) => {
      const storage = new ArtifactStorage({});
      await publish(store, { slug: "prose", description: "prose only", kind: "instruction" });
      try {
        await readPublishedBundle(store, storage, PRINCIPAL, "prose");
        throw new Error("expected a SkillRequestError");
      } catch (error) {
        expect((error as SkillRequestError).code).toBe("BUNDLE_NOT_FOUND");
        expect((error as SkillRequestError).status).toBe(404);
      }
    });
  });
});

describe("publish request parsing", () => {
  async function expectRejection(manifest: Record<string, unknown>, bundle: Uint8Array | undefined, code: string) {
    try {
      await parsePublishRequest(publishRequest(manifest, bundle), CONFIG);
      throw new Error(`expected ${code}`);
    } catch (error) {
      expect(error).toBeInstanceOf(SkillRequestError);
      expect((error as SkillRequestError).code).toBe(code);
    }
  }

  test("requires a slug and a description", async () => {
    await expectRejection({ description: "d" }, BUNDLE, "SLUG_REQUIRED");
    await expectRejection({ slug: "ok" }, BUNDLE, "DESCRIPTION_REQUIRED");
    await expectRejection({ slug: "ok", description: "   " }, BUNDLE, "DESCRIPTION_REQUIRED");
  });

  test("refuses a slug that could escape a path segment or shadow the grammar", async () => {
    for (const slug of ["../etc/passwd", "a/b", "Has Space", "UPPER", "-dash", ".hidden", "x".repeat(200)]) {
      await expectRejection({ slug, description: "d" }, BUNDLE, "INVALID_SLUG");
    }
  });

  test("refuses an empty bundle part", async () => {
    await expectRejection({ slug: "ok", description: "d" }, new Uint8Array(0), "BUNDLE_EMPTY");
  });

  test("refuses a declared digest that is not a sha-256", async () => {
    await expectRejection({ slug: "ok", description: "d", bundleSha256: "nope" }, BUNDLE, "INVALID_DIGEST");
  });

  test("refuses a manifest that is not JSON, and one that is not an object", async () => {
    const notJson = new FormData();
    notJson.set("manifest", "{not json");
    await expect(parsePublishRequest(new Request("https://t.invalid/", { method: "POST", body: notJson }), CONFIG))
      .rejects.toThrow(/not valid JSON/);

    const notObject = new FormData();
    notObject.set("manifest", "[1,2,3]");
    await expect(parsePublishRequest(new Request("https://t.invalid/", { method: "POST", body: notObject }), CONFIG))
      .rejects.toThrow(/must be a JSON object/);
  });

  test("refuses a multipart body with no manifest part at all", async () => {
    const form = new FormData();
    form.set("bundle", new Blob([BUNDLE as BlobPart]), "skill.tar.gz");
    await expect(parsePublishRequest(new Request("https://t.invalid/", { method: "POST", body: form }), CONFIG))
      .rejects.toThrow(/requires a `manifest` field/);
  });

  test("a client cannot label its upload as the bundled official corpus", async () => {
    // "official" is the lowest rank in the CLI-side merge and the label for skills
    // shipped in the package. An upload asserting it would be choosing its own place in
    // someone else's precedence order.
    const parsed = await parsePublishRequest(publishRequest({ slug: "ok", description: "d", source: "official" }, BUNDLE), CONFIG);
    expect(parsed.input.source).toBe("custom");

    const allowed = await parsePublishRequest(publishRequest({ slug: "ok", description: "d", source: "private" }, BUNDLE), CONFIG);
    expect(allowed.input.source).toBe("private");
  });

  test("refuses an unknown kind rather than coercing it", async () => {
    await expectRejection({ slug: "ok", description: "d", kind: "prose" }, BUNDLE, "INVALID_KIND");
    const parsed = await parsePublishRequest(publishRequest({ slug: "ok", description: "d", kind: "instruction" }, BUNDLE), CONFIG);
    expect(parsed.input.kind).toBe("instruction");
  });

  test("keeps skillMd byte-for-byte, including its trailing newline", async () => {
    // A trimming reader silently deleted the final newline of every published SKILL.md,
    // which is a diff between what the author wrote and what every machine then read.
    const skillMd = "---\nname: x\ndescription: y\n---\n\n# X\n\n  indented and trailing spaces   \n";
    const parsed = await parsePublishRequest(publishRequest({ slug: "ok", description: "d", skillMd }, BUNDLE), CONFIG);
    expect(parsed.input.skillMd).toBe(skillMd);
  });

  test("computes the digest itself and does not take the client's word for it", async () => {
    const parsed = await parsePublishRequest(publishRequest({ slug: "ok", description: "d" }, BUNDLE), CONFIG);
    expect(parsed.input.bundle!.sha256).toBe(new Bun.CryptoHasher("sha256").update(BUNDLE).digest("hex"));
    expect(parsed.input.bundle!.byteSize).toBe(BUNDLE.byteLength);
  });

  test("enforces the bundle cap on the buffered bytes, not only on Content-Length", async () => {
    // A chunked upload need not send a Content-Length at all, so a cap checked only on
    // the header is a cap a client can opt out of by omitting one.
    const tiny = { ...CONFIG, skillBundleLimitBytes: 8 };
    const request = publishRequest({ slug: "ok", description: "d" }, BUNDLE);
    request.headers.delete("content-length");
    try {
      await parsePublishRequest(request, tiny);
      throw new Error("expected a rejection");
    } catch (error) {
      expect((error as SkillRequestError).code).toBe("BUNDLE_TOO_LARGE");
      expect((error as SkillRequestError).status).toBe(413);
    }
  });
});

describe("a refused publish discards the bundle object it just uploaded", () => {
  /**
   * Records put/delete without touching S3, so the orphan-object contract can be asserted
   * in-process. The keys mirror the S3 path's shape; no real bucket is needed to prove
   * whether deleteBundle is invoked for a digest.
   */
  class RecordingStorage extends ArtifactStorage {
    putBundleCalls: string[] = [];
    deleteBundleCalls: string[] = [];

    async putBundle(orgId: string, sha256: string, _bytes: OwnedBytes, _contentType = "application/gzip") {
      this.putBundleCalls.push(sha256);
      return { storageKind: "s3" as const, storageKey: `skills/artifacts/${orgId}/${sha256}` };
    }

    async deleteBundle(_orgId: string, sha256: string) {
      this.deleteBundleCalls.push(sha256);
    }
  }

  const OTHER_BUNDLE = ownBytes(new TextEncoder().encode("a different bundle, so a different digest"));

  function digestOf(bytes: Uint8Array): string {
    return new Bun.CryptoHasher("sha256").update(bytes).digest("hex");
  }

  async function publishWithStorage(
    store: SqliteSkillsStore,
    storage: ArtifactStorage,
    manifest: Record<string, unknown>,
    bundle: Uint8Array | undefined,
    expectedRevisionId?: string,
  ) {
    const parsed = await parsePublishRequest(publishRequest(manifest, bundle), CONFIG);
    return storePublishedSkill(store, storage, PRINCIPAL, parsed, expectedRevisionId);
  }

  test("a stale If-Match publish is refused before any object is uploaded, leaving no row and nothing to discard", async () => {
    await withStore(async (store) => {
      const storage = new RecordingStorage();
      const first = await publishWithStorage(store, storage, { slug: "revisioned", description: "a skill" }, BUNDLE);
      expect(first.bundleSha256).toBe(digestOf(BUNDLE));
      expect(storage.deleteBundleCalls).toEqual([]);

      // A conflicting push: same slug, NEW bundle bytes (a digest the store has never
      // seen), stale If-Match. The API answers the revision guard before it touches the
      // bucket (hasna/apps#1630), so the object is never written - there is nothing to
      // discard and no orphan to find later.
      const conflicting = digestOf(OTHER_BUNDLE);
      await expect(
        publishWithStorage(store, storage, { slug: "revisioned", description: "a skill" }, OTHER_BUNDLE, "stale-revision"),
      ).rejects.toThrow(SkillRevisionConflictError);

      expect(storage.putBundleCalls).not.toContain(conflicting);
      expect(storage.deleteBundleCalls).toEqual([]);
      expect(await store.getSkillBundle(PRINCIPAL, conflicting)).toBeNull();
    });
  });

  test("when the store refuses after the upload (a writer raced the guard), the uploaded object is discarded and no row is left", async () => {
    await withStore(async (store) => {
      const storage = new RecordingStorage();
      const first = await publishWithStorage(store, storage, { slug: "revisioned", description: "a skill" }, BUNDLE);

      // The API's pre-check passes (the caller names the current revision), then the
      // store itself refuses - the shape of a concurrent writer landing in between.
      const racing: SqliteSkillsStore = Object.create(store, {
        publishSkill: {
          value: async () => {
            throw new SkillRevisionConflictError("revisioned", first.revisionId, "someone-elses-revision");
          },
        },
      });
      const conflicting = digestOf(OTHER_BUNDLE);
      await expect(
        publishWithStorage(racing, storage, { slug: "revisioned", description: "a skill" }, OTHER_BUNDLE, first.revisionId),
      ).rejects.toThrow(SkillRevisionConflictError);

      expect(storage.putBundleCalls).toContain(conflicting);
      expect(storage.deleteBundleCalls).toEqual([conflicting]);
      expect(await store.getSkillBundle(PRINCIPAL, conflicting)).toBeNull();
    });
  });

  test("a refused publish does not delete an object whose digest another live skill still references", async () => {
    await withStore(async (store) => {
      const storage = new RecordingStorage();

      // Digest of OTHER_BUNDLE is already live under another slug, so the conflicting
      // push re-uploads a digest the store still tracks - content-addressed reuse.
      const other = await publishWithStorage(store, storage, { slug: "other-skill", description: "other" }, OTHER_BUNDLE);
      expect(other.bundleSha256).toBe(digestOf(OTHER_BUNDLE));
      const shared = await publishWithStorage(store, storage, { slug: "shared-skill", description: "shared" }, BUNDLE);
      expect(shared.bundleSha256).toBe(digestOf(BUNDLE));

      const conflicting = digestOf(OTHER_BUNDLE);
      await expect(
        publishWithStorage(store, storage, { slug: "shared-skill", description: "shared" }, OTHER_BUNDLE, "stale-revision"),
      ).rejects.toThrow(SkillRevisionConflictError);

      // The reference guard saw a live row for the digest and kept the object.
      expect(storage.deleteBundleCalls).toEqual([]);
      expect(await store.getSkillBundle(PRINCIPAL, conflicting)).not.toBeNull();
    });
  });
});
