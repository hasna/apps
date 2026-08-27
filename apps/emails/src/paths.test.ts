import { afterEach, describe, expect, test } from "bun:test";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";

import { defaultProviderSecretsKeyringPath } from "./db/provider-secrets.js";
import { getEmailsDataDir } from "./lib/config.js";
import { getEmailsEventsDataDir } from "./lib/emails-events.js";
import {
  adoptResolverDataRoot,
  getDataRoot,
  getExactDataRoot,
  getHomeDir,
  getLegacyDataRoot,
  getResolverDataRoot,
} from "./paths.js";

const ENV_KEYS = [
  "HOME",
  "USERPROFILE",
  "HASNA_DATA_HOME",
  "HASNA_CACHE_HOME",
  "HASNA_EMAILS_HOME",
  "EMAILS_HOME",
] as const;

let saved: Partial<Record<(typeof ENV_KEYS)[number], string | undefined>> = {};
let tempHome: string | null = null;
const cleanups: string[] = [];

afterEach(() => {
  for (const key of ENV_KEYS) {
    const value = saved[key];
    if (value === undefined) delete process.env[key];
    else process.env[key] = value;
  }
  saved = {};
  for (const dir of cleanups.splice(0)) rmSync(dir, { recursive: true, force: true });
  if (tempHome !== null) {
    rmSync(tempHome, { recursive: true, force: true });
    tempHome = null;
  }
});

function isolateHome(): string {
  if (tempHome !== null) throw new Error("isolateHome called twice without afterEach");
  for (const key of ENV_KEYS) {
    saved[key] = process.env[key];
    delete process.env[key];
  }
  tempHome = mkdtempSync(join(tmpdir(), "emails-paths-"));
  process.env.HOME = tempHome;
  delete process.env.USERPROFILE;
  return tempHome;
}

const KEYRING = "open-emails-provider-credentials.keyring.json";

describe("resolver (XDG) data-root resolution", () => {
  test("home resolves HOME first, then the OS user database", () => {
    const home = isolateHome();
    expect(getHomeDir()).toBe(home);
  });

  test("resolver data root follows @hasna/paths under a fake HOME", () => {
    const home = isolateHome();
    expect(getResolverDataRoot()).toBe(join(home, ".local", "share", "hasna", "emails"));
    expect(getLegacyDataRoot()).toBe(join(home, ".hasna", "emails"));
  });
});

describe("resolver (XDG) adoption — the legacy home must never become invisible", () => {
  test("legacy ~/.hasna/emails stays the effective root until adopted", () => {
    const home = isolateHome();
    expect(adoptResolverDataRoot(getResolverDataRoot())).toBe(false);
    expect(getDataRoot()).toBe(getLegacyDataRoot());
    // The downstream entry points all agree on the effective root.
    expect(getEmailsDataDir()).toBe(join(home, ".hasna", "emails"));
    expect(getEmailsEventsDataDir()).toBe(join(home, ".hasna", "emails", "events"));
    expect(defaultProviderSecretsKeyringPath()).toBe(join(home, ".hasna", "emails", KEYRING));
  });

  test("HASNA_DATA_HOME adopts the resolver (XDG) data root", () => {
    isolateHome();
    const base = mkdtempSync(join(tmpdir(), "emails-data-home-")); cleanups.push(base);
    process.env.HASNA_DATA_HOME = base;
    expect(adoptResolverDataRoot(getResolverDataRoot())).toBe(true);
    expect(getDataRoot()).toBe(join(base, "emails"));
    expect(getEmailsDataDir()).toBe(join(base, "emails"));
    expect(getEmailsEventsDataDir()).toBe(join(base, "emails", "events"));
    expect(defaultProviderSecretsKeyringPath()).toBe(join(base, "emails", KEYRING));
  });

  test("an existing store at the resolver data root adopts it even without HASNA_DATA_HOME", () => {
    const home = isolateHome();
    const xdg = join(home, ".local", "share", "hasna", "emails");
    mkdirSync(xdg, { recursive: true });
    writeFileSync(join(xdg, "emails.db"), "existing-migrated-store");
    expect(adoptResolverDataRoot(getResolverDataRoot())).toBe(true);
    expect(getDataRoot()).toBe(xdg);
  });

  test("a non-data kind override (HASNA_CACHE_HOME) must NOT move the data home", () => {
    const home = isolateHome();
    const cache = mkdtempSync(join(tmpdir(), "emails-cache-home-")); cleanups.push(cache);
    process.env.HASNA_CACHE_HOME = cache;
    expect(adoptResolverDataRoot(getResolverDataRoot())).toBe(false);
    expect(getDataRoot()).toBe(join(home, ".hasna", "emails"));
  });

  test("HASNA_EMAILS_HOME exact override wins over both roots", () => {
    isolateHome();
    const override = mkdtempSync(join(tmpdir(), "emails-hasna-home-")); cleanups.push(override);
    const base = mkdtempSync(join(tmpdir(), "emails-data-home2-")); cleanups.push(base);
    process.env.HASNA_DATA_HOME = base; // would adopt the XDG root, but the override must win
    process.env.HASNA_EMAILS_HOME = override;
    expect(getExactDataRoot()).toBe(override);
    expect(getDataRoot()).toBe(override);
    expect(getEmailsDataDir()).toBe(override);
    expect(defaultProviderSecretsKeyringPath()).toBe(join(override, KEYRING));
  });

  test("EMAILS_HOME exact override wins over both roots", () => {
    isolateHome();
    const override = mkdtempSync(join(tmpdir(), "emails-home-")); cleanups.push(override);
    process.env.EMAILS_HOME = override;
    expect(getExactDataRoot()).toBe(override);
    expect(getDataRoot()).toBe(override);
  });

  test("a whitespace-only HASNA_EMAILS_HOME falls through to a valid EMAILS_HOME (release-review P1)", () => {
    isolateHome();
    const override = mkdtempSync(join(tmpdir(), "emails-hasna-home-")); cleanups.push(override);
    process.env.HASNA_EMAILS_HOME = "   ";
    process.env.EMAILS_HOME = override;
    expect(getExactDataRoot()).toBe(override);
    expect(getDataRoot()).toBe(override);
    expect(getEmailsDataDir()).toBe(override);
  });

  test("whitespace-only exact overrides fall through to the legacy root (release-review P1)", () => {
    const home = isolateHome();
    process.env.HASNA_EMAILS_HOME = "   ";
    process.env.EMAILS_HOME = "\t ";
    expect(getExactDataRoot()).toBeUndefined();
    expect(getDataRoot()).toBe(join(home, ".hasna", "emails"));
  });

  test("exact data-root overrides are resolved to absolute paths", () => {
    isolateHome();
    const base = mkdtempSync(join(tmpdir(), "emails-abs-")); cleanups.push(base);
    const raw = join(base, "..", "emails-abs-rel");
    process.env.EMAILS_HOME = raw;
    expect(getExactDataRoot()).toBe(resolve(raw));
    expect(getExactDataRoot()?.startsWith("/")).toBe(true);
  });
});
