import { afterEach, describe, expect, test } from "bun:test";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { dataDir, effectiveHome } from "@hasna/contracts/paths";

import { defaultProviderSecretsKeyringPath } from "./db/provider-secrets.js";
import { getEmailsDataDir } from "./lib/config.js";
import { getEmailsEventsDataDir } from "./lib/emails-events.js";
import { getDataRoot, getExactDataRoot, getHomeDir, getLegacyDataRoot, getResolverDataRoot } from "./paths.js";

const ENV_KEYS = [
  "HOME",
  "USERPROFILE",
  "HASNA_DATA_HOME",
  "HASNA_CACHE_HOME",
  "HASNA_CONFIG_HOME",
  "HASNA_STATE_HOME",
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

describe("paths resolver wiring (single resolver in @hasna/contracts, ruling #1668)", () => {
  test("home resolves HOME first", () => {
    const home = isolateHome();
    expect(getHomeDir()).toBe(home);
  });

  test("the resolver data root is the contracts resolver root for this machine", () => {
    const home = isolateHome();
    expect(getResolverDataRoot()).toBe(dataDir({ app: "emails", home, env: process.env }));
  });

  test("on macOS the resolver (and therefore the effective) root is the emails data root", () => {
    const home = isolateHome();
    const mac = dataDir({ app: "emails", home, platform: "darwin", env: process.env });
    expect(mac).toBe(join(home, ".hasna", "emails"));
    expect(getResolverDataRoot()).toBe(mac);
    expect(getDataRoot()).toBe(mac);
    // The pre-ruling legacy root coincides with the resolver root on macOS.
    expect(getLegacyDataRoot()).toBe(join(home, ".hasna", "emails"));
  });

  test("on Linux the resolver (and therefore the effective) root is the XDG data root", () => {
    const home = isolateHome();
    const linux = dataDir({ app: "emails", home, platform: "linux", env: process.env });
    expect(linux).toBe(join(home, ".local", "share", "hasna", "emails"));
  });

  test("the effective root is the resolver root; downstream entry points agree", () => {
    const home = isolateHome();
    const root = dataDir({ app: "emails", home, env: process.env });
    expect(getDataRoot()).toBe(root);
    expect(getEmailsDataDir()).toBe(root);
    expect(getEmailsEventsDataDir()).toBe(join(root, "events"));
    expect(defaultProviderSecretsKeyringPath()).toBe(join(root, KEYRING));
  });

  test("HASNA_DATA_HOME kind override moves the data root (app segment kept)", () => {
    isolateHome();
    const base = mkdtempSync(join(tmpdir(), "emails-data-home-")); cleanups.push(base);
    process.env.HASNA_DATA_HOME = base;
    expect(getDataRoot()).toBe(join(base, "emails"));
    expect(getEmailsDataDir()).toBe(join(base, "emails"));
    expect(getEmailsEventsDataDir()).toBe(join(base, "emails", "events"));
    expect(defaultProviderSecretsKeyringPath()).toBe(join(base, "emails", KEYRING));
  });

  test("a non-data kind override (HASNA_CACHE_HOME) must NOT move the data home", () => {
    const home = isolateHome();
    const cache = mkdtempSync(join(tmpdir(), "emails-cache-home-")); cleanups.push(cache);
    process.env.HASNA_CACHE_HOME = cache;
    expect(getDataRoot()).toBe(dataDir({ app: "emails", home, env: process.env }));
    expect(defaultProviderSecretsKeyringPath()).toBe(
      join(dataDir({ app: "emails", home, env: process.env }), KEYRING),
    );
  });

  test("HASNA_EMAILS_HOME exact override wins over the kind override and the resolver root", () => {
    isolateHome();
    const override = mkdtempSync(join(tmpdir(), "emails-hasna-home-")); cleanups.push(override);
    const base = mkdtempSync(join(tmpdir(), "emails-data-home2-")); cleanups.push(base);
    process.env.HASNA_DATA_HOME = base; // would move the resolver root, but the exact override wins
    process.env.HASNA_EMAILS_HOME = override;
    expect(getExactDataRoot()).toBe(override);
    expect(getDataRoot()).toBe(override);
    expect(getEmailsDataDir()).toBe(override);
    expect(defaultProviderSecretsKeyringPath()).toBe(join(override, KEYRING));
  });

  test("EMAILS_HOME exact override wins over the resolver root", () => {
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

  test("whitespace-only exact overrides fall through to the resolver root (release-review P1)", () => {
    const home = isolateHome();
    process.env.HASNA_EMAILS_HOME = "   ";
    process.env.EMAILS_HOME = "\t ";
    expect(getExactDataRoot()).toBeUndefined();
    expect(getDataRoot()).toBe(dataDir({ app: "emails", home, env: process.env }));
  });

  test("exact data-root overrides are resolved to absolute paths", () => {
    isolateHome();
    const base = mkdtempSync(join(tmpdir(), "emails-abs-")); cleanups.push(base);
    const raw = join(base, "..", "emails-abs-rel");
    process.env.EMAILS_HOME = raw;
    expect(getExactDataRoot()).toBe(resolve(raw));
    expect(getExactDataRoot()?.startsWith("/")).toBe(true);
  });

  test("the home used by the legacy helper is the effective home", () => {
    const home = isolateHome();
    expect(effectiveHome(process.env)).toBe(home);
    expect(getLegacyDataRoot()).toBe(join(home, ".hasna", "emails"));
  });
});