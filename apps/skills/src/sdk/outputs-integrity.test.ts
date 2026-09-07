import { expect, test } from "bun:test";
import { createHash } from "node:crypto";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { GetObjectCommand, PutObjectCommand, type DeleteObjectCommand } from "@aws-sdk/client-s3";
import { useDefaultTestTimeout } from "../test-preload.js";
import { publicPrincipal } from "../server/auth.js";
import { ArtifactStorage, type ArtifactBody, type S3ClientLike } from "../server/artifact-storage.js";
import { SqliteSkillsStore } from "../server/sqlite-store.js";
import type { ServerRunRecord } from "../server/types.js";
import { createGovernanceStore } from "./governance-store.js";
import { createGovernedArtifactWriter } from "./outputs.js";

useDefaultTestTimeout();

const principal = publicPrincipal({ orgId: "org_integrity", userId: "user_integrity", email: "integrity@example.test" });
const otherPrincipal = publicPrincipal({ orgId: "org_other", userId: "user_other", email: "other@example.test" });
const digest = (value: string) => createHash("sha256").update(Buffer.from(value, "utf8")).digest("hex");

class OwnedObjectClient implements S3ClientLike {
  readonly objects = new Map<string, Uint8Array>();
  puts = 0;
  async send(command: PutObjectCommand | GetObjectCommand | DeleteObjectCommand): Promise<{ Body?: unknown }> {
    if (command instanceof PutObjectCommand) {
      if (typeof command.input.Body !== "string" || !command.input.Key) throw new Error("Unexpected fixture object input");
      this.puts++;
      this.objects.set(command.input.Key, new Uint8Array(Buffer.from(command.input.Body, "utf8")));
      return {};
    }
    if (command instanceof GetObjectCommand) return { Body: this.objects.get(command.input.Key!) };
    throw new Error("Unexpected fixture object operation");
  }
}

function metadata(run: ServerRunRecord, id: string, original: string) {
  return { id, orgId: run.orgId, runId: run.id, fileName: `${id}.txt`, relativePath: `${id}.txt`,
    contentType: "text/plain", visibility: "public" as const, byteSize: Buffer.byteLength(original), sha256: digest(original) };
}

function body(id: string, bodyText: string): ArtifactBody {
  return { relativePath: `${id}.txt`, contentType: "text/plain", bodyText };
}

async function fixture(kind: "db" | "object-fixture", check: (value: {
  store: SqliteSkillsStore; governance: Awaited<ReturnType<typeof createGovernanceStore>>;
  run: ServerRunRecord; storage: ArtifactStorage; objects: OwnedObjectClient;
}) => Promise<void>) {
  const root = await mkdtemp(join(tmpdir(), "skills-output-integrity-"));
  const path = join(root, "owned.db");
  const store = new SqliteSkillsStore(path), governance = await createGovernanceStore(path);
  const objects = new OwnedObjectClient();
  const storage = new ArtifactStorage(kind === "db" ? {} : { bucket: "owned-output-fixture", client: objects });
  try {
    await store.ensureBootstrapApiKey("owned-integrity-bootstrap", principal);
    const run = await store.createRun({ principal, slug: "owned-output-integrity", input: {}, args: [] });
    await check({ store, governance, run, storage, objects });
  } finally {
    await store.close(); await governance.close?.(); await rm(root, { recursive: true, force: true });
  }
}

for (const kind of ["db", "object-fixture"] as const) {
  test(`governed ${kind} metadata matches actual redacted, unchanged and empty UTF-8 bytes`, async () => {
    await fixture(kind, async ({ store, governance, run, storage, objects }) => {
      const writer = createGovernedArtifactWriter({ store, governanceStore: governance, storage,
        config: { redactPatterns: [/owned-marker-[a-z]+/g], artifactTtlSeconds: 60 } });
      const cases = [
        { id: "redacted", original: "before owned-marker-abcdefghijklmnopqrstuvwxyz after", expected: "before credential after" },
        { id: "unchanged", original: "résumé 🧪", expected: "résumé 🧪" },
        { id: "empty", original: "", expected: "" },
      ];
      for (const row of cases) {
        const inputMeta = metadata(run, row.id, row.original), inputBody = body(row.id, row.original);
        const metaBefore = { ...inputMeta }, bodyBefore = { ...inputBody };
        const saved = await writer.write(run, inputMeta, inputBody);
        const stored = await store.getArtifact(principal, run.id, row.id);
        expect(stored).not.toBeNull();
        const bytes = await storage.readText(stored!);
        expect(bytes).toBe(row.expected);
        expect(stored!.byteSize).toBe(Buffer.byteLength(bytes!, "utf8"));
        expect(stored!.sha256).toBe(digest(bytes!));
        expect(saved.byteSize).toBe(stored!.byteSize);
        expect(saved.sha256).toBe(stored!.sha256);
        expect(stored!.visibility).toBe("private");
        expect(stored!.expiresAt).toBeDefined();
        expect(stored!.storageKind).toBe(kind === "db" ? "db" : "s3");
        expect(stored!.storageKey).toBe(kind === "db" ? undefined : `skills/artifacts/${run.orgId}/${run.id}/${row.id}.txt`);
        if (kind === "object-fixture") expect(stored!.bodyText).toBeUndefined();
        expect(await store.getArtifact(otherPrincipal, run.id, row.id)).toBeNull();
        expect(inputMeta).toEqual(metaBefore); expect(inputBody).toEqual(bodyBefore);
      }
      expect(objects.puts).toBe(kind === "db" ? 0 : cases.length);
    });
  });

  test(`governed ${kind} cumulative cap accounts for redaction expansion before the next write`, async () => {
    await fixture(kind, async ({ store, governance, run, storage, objects }) => {
      const writer = createGovernedArtifactWriter({ store, governanceStore: governance, storage,
        config: { redactPatterns: [/X/g], perOutputBytes: 10, perRunTotalBytes: 13 } });
      // One caller byte expands to ten stored bytes. UTF-8 makes the next two
      // characters three bytes, landing exactly on the cumulative boundary.
      await writer.write(run, metadata(run, "expanded", "X"), body("expanded", "X"));
      await writer.write(run, metadata(run, "boundary", "éA"), body("boundary", "éA"));
      const rows = await store.listArtifacts(principal, run.id);
      expect(rows.reduce((total, row) => total + row.byteSize, 0)).toBe(13);
      const putsBefore = objects.puts;
      await expect(writer.write(run, metadata(run, "over-total", "B"), body("over-total", "B")))
        .rejects.toMatchObject({ code: "RUN_ARTIFACT_TOTAL_EXCEEDED" });
      await expect(writer.write(run, metadata(run, "over-output", "🧪🧪🧪"), body("over-output", "🧪🧪🧪")))
        .rejects.toMatchObject({ code: "ARTIFACT_LIMIT_EXCEEDED" });
      expect(await store.listArtifacts(principal, run.id)).toEqual(rows);
      expect(objects.puts).toBe(putsBefore);
    });
  });

  test(`governed ${kind} shrinkage and inaccurate input descriptors cannot distort the cap`, async () => {
    await fixture(kind, async ({ store, governance, run, storage, objects }) => {
      const writer = createGovernedArtifactWriter({ store, governanceStore: governance, storage,
        config: { redactPatterns: [/owned-marker-[a-z]+/g], perOutputBytes: 10, perRunTotalBytes: 12 } });
      const original = "owned-marker-abcdefghijklmnopqrstuvwxyz";
      await writer.write(run, metadata(run, "shrunk", original), body("shrunk", original));
      await writer.write(run, { ...metadata(run, "underreported", "é"), byteSize: 0, sha256: "" }, body("underreported", "é"));
      const rows = await store.listArtifacts(principal, run.id);
      expect(rows.reduce((total, row) => total + row.byteSize, 0)).toBe(12);
      const putsBefore = objects.puts;
      await expect(writer.write(run, metadata(run, "extra", "A"), body("extra", "A")))
        .rejects.toMatchObject({ code: "RUN_ARTIFACT_TOTAL_EXCEEDED" });
      expect(await store.listArtifacts(principal, run.id)).toEqual(rows);
      expect(objects.puts).toBe(putsBefore);
    });
  });

  test(`governed ${kind} refuses a missing or non-text body without fabricating integrity metadata`, async () => {
    await fixture(kind, async ({ store, governance, run, storage, objects }) => {
      const writer = createGovernedArtifactWriter({ store, governanceStore: governance, storage, config: { redactPatterns: [] } });
      const unsupportedBodies: unknown[] = [undefined, null, {}, { bodyText: undefined }, { bodyText: null }, { bodyText: 3 },
        { storageKind: "s3", storageKey: "owned/existing.txt" }];
      for (const value of unsupportedBodies) {
        await expect(writer.write(run, metadata(run, "invalid", ""), value as ArtifactBody))
          .rejects.toThrow("Governed artifacts require a text body before persistence");
      }
      expect(await store.listArtifacts(principal, run.id)).toEqual([]);
      expect(objects.puts).toBe(0); expect(objects.objects.size).toBe(0);
    });
  });
}
