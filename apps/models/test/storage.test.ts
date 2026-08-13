import { expect, test } from "bun:test";
import { join } from "node:path";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { ModelsStore } from "../src/storage.js";

test("stores catalog entries and installs", () => {
  const dir = mkdtempSync(join(tmpdir(), "models-store-"));
  const store = new ModelsStore(join(dir, "models.db"));
  const count = store.upsertCatalog([
    {
      provider: "huggingface",
      entityKind: "model",
      repoId: "sshleifer/tiny-gpt2",
      revision: "main",
      canonicalUrl: "https://huggingface.co/sshleifer/tiny-gpt2",
      title: "sshleifer/tiny-gpt2",
      author: "sshleifer",
      task: "text-generation",
      libraryName: "transformers",
      license: null,
      gated: false,
      private: false,
      downloads: 1,
      likes: 2,
      tags: ["text-generation"],
      lastModified: null,
      metadata: {},
    },
  ]);
  expect(count).toBe(1);
  expect(store.catalogStats().catalogEntries).toBe(1);
  expect(store.topCatalog(1)[0]?.repoId).toBe("sshleifer/tiny-gpt2");
  const schema = store.db.query<Record<string, unknown>, []>(
    "SELECT value FROM schema_meta WHERE key = 'schema_version' LIMIT 1",
  ).get();
  expect(Number(schema?.value)).toBe(2);
  store.close();
});
