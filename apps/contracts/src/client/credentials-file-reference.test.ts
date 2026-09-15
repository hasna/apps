import { afterEach, describe, expect, test } from "bun:test";
import { chmodSync, mkdirSync, mkdtempSync, rmSync, symlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { inspect } from "node:util";
import { resolveCredential } from "./credentials.js";

const homes: string[] = [];
const REF = "fixture/skills/live/api_key";
function fixture(body: string, profile?: string) {
  const home = mkdtempSync(join(tmpdir(), "file-ref-"));
  homes.push(home);
  const dir = join(home, ".hasna/skills/config");
  mkdirSync(dir, { recursive: true, mode: 0o700 });
  const file = join(dir, profile ? `credentials-${profile}` : "credentials");
  writeFileSync(file, body, { mode: 0o600 });
  return { home, file };
}
afterEach(() => { for (const home of homes.splice(0)) rmSync(home, { recursive: true, force: true }); });

describe("vault references in existing credential files", () => {
  test("canonical file selects a sealed pointer ahead of a stale environment literal", () => {
    const { home, file } = fixture(`HASNA_SKILLS_API_KEY_REF=${REF}\n`);
    const resolved = resolveCredential("skills", { HOME: home, HASNA_SKILLS_API_KEY: "dummy-stale-key" })!;
    expect(resolved.tier).toBe("pointer");
    expect(resolved.source).toBe(file);
    expect(resolved.apiKey).toBe("");
    expect(resolved.pointerVaultKey).toBe(REF);
    expect(resolved.deliberate).toBe(false);
    expect(JSON.stringify(resolved)).not.toContain(REF);
    expect(inspect(resolved)).not.toContain(REF);
  });

  test("a named profile may contain a reference with its existing explicit priority", () => {
    const { home, file } = fixture(`export HASNA_SKILLS_API_KEY_REF='${REF}'\n`, "work");
    const resolved = resolveCredential("skills", { HOME: home, HASNA_PROFILE: "work" })!;
    expect(resolved.tier).toBe("pointer");
    expect(resolved.source).toBe(file);
    expect(resolved.deliberate).toBe(true);
    expect(resolved.pointerVaultKey).toBe(REF);
  });

  test("blank, malformed, disagreeing and mixed literal/reference files are terminal", () => {
    for (const body of [
      "HASNA_SKILLS_API_KEY_REF=\n",
      "HASNA_SKILLS_API_KEY_REF='unterminated\n",
      "HASNA_SKILLS_API_KEY_REF=not-a-vault-path\n",
      `HASNA_SKILLS_API_KEY_REF=${REF}\nHASNA_SKILLS_API_KEY_REF=other/skills/live/api_key\n`,
      `HASNA_SKILLS_API_KEY_REF=${REF}\nHASNA_SKILLS_API_KEY=dummy-literal\n`,
      `HASNA_SKILLS_API_KEY_REF=${REF}\nSKILLS_API_KEY=dummy-literal\n`,
    ]) {
      const { home } = fixture(body);
      expect(() => resolveCredential("skills", { HOME: home, HASNA_SKILLS_API_KEY: "dummy-fallback" })).toThrow();
    }
  });

  test("existing arguments, env reference and Keychain priority remain unchanged", () => {
    const { home } = fixture(`HASNA_SKILLS_API_KEY_REF=${REF}\n`);
    const env = { HOME: home };
    expect(resolveCredential("skills", env, { apiKey: "dummy-argument" })?.tier).toBe("argument");
    expect(resolveCredential("skills", { ...env, HASNA_SKILLS_API_KEY_OVERRIDE: "dummy-override" })?.tier).toBe("override");
    expect(resolveCredential("skills", { ...env, HASNA_SKILLS_API_KEY_REF: "other/skills/live/api_key" })?.pointerVaultKey).toBe("other/skills/live/api_key");
    const keychain = { platform: "darwin", run: () => ({ status: 0, stdout: "dummy-keychain-key\n", stderr: "" }) };
    expect(resolveCredential("skills", env, { keychain })?.tier).toBe("keychain");
    expect(() => resolveCredential("skills", env, { keychain: { ...keychain, run: () => ({ status: 36, stdout: "", stderr: "Keychain locked" }) } })).toThrow();
  });

  test("literal-only files retain their existing representation and priority", () => {
    const { home, file } = fixture("HASNA_SKILLS_API_KEY=dummy-disk-key\n");
    const result = resolveCredential("skills", { HOME: home, HASNA_SKILLS_API_KEY: "dummy-env-key" })!;
    expect(result.tier).toBe("disk");
    expect(result.source).toBe(file);
    expect(result.apiKey).toBe("dummy-disk-key");
  });

  test("reference files retain owner-only regular-file admission", () => {
    const { home, file } = fixture(`HASNA_SKILLS_API_KEY_REF=${REF}\n`);
    chmodSync(file, 0o644);
    expect(() => resolveCredential("skills", { HOME: home })).toThrow();
    chmodSync(file, 0o600);
    const linkHome = fixture("");
    rmSync(linkHome.file);
    symlinkSync(file, linkHome.file);
    expect(() => resolveCredential("skills", { HOME: linkHome.home })).toThrow();
  });

  test("reference rotation is reread without rebuilding the resolver", () => {
    const { home, file } = fixture(`HASNA_SKILLS_API_KEY_REF=${REF}\n`);
    const env = { HOME: home };
    expect(resolveCredential("skills", env)?.pointerVaultKey).toBe(REF);
    writeFileSync(file, "HASNA_SKILLS_API_KEY_REF=other/skills/live/api_key\n");
    expect(resolveCredential("skills", env)?.pointerVaultKey).toBe("other/skills/live/api_key");
  });
});
