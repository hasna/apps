import { describe, expect, test } from "bun:test";
import { join } from "node:path";
import * as index from "./index.js";
import { VERSION } from "./version.js";

/**
 * Public barrel surface: every documented runtime export must be present and
 * functional, and symbols that belong to sub-entrypoints must NOT leak into
 * the root barrel.
 */
const RUNTIME_EXPORTS = [
  "VERSION",
  "createChangelogHandler",
  "ChangelogClient",
  "createChangelogClient",
  "categoryHeadings",
  "categoryOrder",
  "generateChangelogMarkdown",
  "groupChangelogEntries",
  "publishChangelog",
  "buildChangelogRef",
  "changelogSiteAppUrl",
  "publishRelease",
  "escapeHtml",
  "generateChangelogSite",
  "normalizeRepositoryUrl",
  "readProjectInfo",
  "DEFAULT_CHANGELOG_FILE",
  "DEFAULT_DATA_DIR",
  "LocalChangelogStore",
  "fingerprintChangelogEntry",
  "resolveChangelogDataDir",
  "resolveChangelogFilePath",
  "appIdSchema",
  "changelogCategories",
  "changelogEntryInputSchema",
  "changelogEntrySchema",
  "changelogEntryUpdateSchema",
  "changelogKinds",
  "changelogLinkSchema",
  "normalizeAppId",
  "normalizeRefs",
  "normalizeTags",
  "parseAppId",
  "parseChangelogEntryInput",
  "parseChangelogEntryUpdate",
  "parseChangelogDate",
  "parseChangelogKind",
  "parseStoredChangelogEntry",
  "redactSecretsInText",
  "redactSensitiveJson",
] as const;

describe("public barrel", () => {
  test("exports every documented runtime symbol", () => {
    for (const name of RUNTIME_EXPORTS) {
      expect(index as unknown as Record<string, unknown>, `missing barrel export ${name}`).toHaveProperty(name);
      expect((index as unknown as Record<string, unknown>)[name], `undefined barrel export ${name}`).toBeDefined();
    }
  });

  test("VERSION equals the package.json version read at runtime", async () => {
    const packageJson = (await Bun.file(join(import.meta.dir, "..", "package.json")).json()) as { version: string };
    expect(index.VERSION).toBe(packageJson.version);
    expect(index.VERSION).toBe(VERSION);
  });

  test("does not leak sub-entrypoint symbols into the root barrel", () => {
    const record = index as unknown as Record<string, unknown>;
    for (const absent of ["createChangelogMcpServer", "buildServer", "startChangelogServer", "startMcpServer"]) {
      expect(record, `sub-entrypoint symbol ${absent} must not be exported`).not.toHaveProperty(absent);
    }
  });
});
