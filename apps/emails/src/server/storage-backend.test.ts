import { describe, expect, it } from "bun:test";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { SERVER_DATABASE_URL_SETTING, resolveServerStorageBackend } from "./storage-backend.js";

const root = join(import.meta.dir, "..", "..");
const POSTGRES = "postgres://operator.invalid/emails";

describe("emails-serve storage backend", () => {
  it("answers postgresql when, and only when, the database URL is configured", () => {
    expect(resolveServerStorageBackend({ [SERVER_DATABASE_URL_SETTING]: POSTGRES })).toBe("postgresql");
    expect(resolveServerStorageBackend({})).toBe("sqlite");
    // A blank value is not a configuration. The deploy path writes this variable from a
    // secret, and an unresolved secret arrives as the empty string rather than absent.
    expect(resolveServerStorageBackend({ [SERVER_DATABASE_URL_SETTING]: "   " })).toBe("sqlite");
  });

  it("is never influenced by a leftover selector variable in the environment", () => {
    // The word that used to select a product variant means nothing here: presence of the
    // database URL is the whole resolution. A leftover variable — with any value, including
    // the old spellings of the selector — must not change the answer.
    const LEGACY = ["EMAILS", "MODE"].join("_");
    for (const value of ["local", "self-hosted", "selfhosted", "whichever"]) {
      expect(resolveServerStorageBackend({ [LEGACY]: value })).toBe("sqlite");
      expect(
        resolveServerStorageBackend({ [LEGACY]: value, [SERVER_DATABASE_URL_SETTING]: POSTGRES }),
      ).toBe("postgresql");
    }
  });

  it("decides from storage alone — no selector read survives in the module", () => {
    // The load-bearing property, asserted the way src/store-resolution.test.ts asserts its
    // own: the expression that answers must consult the database URL and nothing else.
    const source = readFileSync(join(import.meta.dir, "storage-backend.ts"), "utf8");
    expect(source).toContain("SERVER_DATABASE_URL_SETTING");
    expect(source).not.toMatch(/resolveEmailsMode/);
    expect(source).not.toMatch(/isSelfHosted/);
  });

  it("leaves no server module reading the selector to choose a store", () => {
    // A POSITIVE CONTROL for the absence claims below: the same scan run against a fixture
    // that DOES contain the offending read must find it, or this assertion proves nothing.
    // A one-character typo in the pattern would otherwise pass over every file in silence.
    const offending = 'const mode = resolveEmailsModeSelection().mode;\nif (mode === "self-hosted") {}';
    const scan = (text: string): boolean =>
      /resolveEmailsMode(?:Selection)?\(/.test(text) || /\bgetEmailsMode\(/.test(text);
    expect(scan(offending)).toBe(true);

    for (const relative of [
      "src/server/index.ts",
      "src/server/bind-options.ts",
      "src/server/self-hosted/env.ts",
      "src/server/self-hosted/migrate.ts",
    ]) {
      expect(scan(readFileSync(join(root, relative), "utf8")), `${relative} still reads the selector`)
        .toBe(false);
    }
  });
});
