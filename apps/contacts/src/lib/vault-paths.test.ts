import { afterEach, describe, expect, it } from "bun:test";
import { existsSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { getDocumentsDir, getVaultSessionPath, getVaultSessionDir } from "./vault.js";

/**
 * XDG conformance regression (hotfixes task 5f624540):
 * documents must live under the XDG data root and the vault session state
 * under the XDG state root — never the legacy ~/.hasna/contacts home.
 */

const originalHome = process.env["HOME"];
const originalUserProfile = process.env["USERPROFILE"];
const originalHasnaDataHome = process.env["HASNA_DATA_HOME"];
const originalHasnaStateHome = process.env["HASNA_STATE_HOME"];
let tempRoot: string | null = null;

function restoreEnv(name: string, value: string | undefined): void {
  if (value === undefined) delete process.env[name];
  else process.env[name] = value;
}

afterEach(() => {
  restoreEnv("HOME", originalHome);
  restoreEnv("USERPROFILE", originalUserProfile);
  restoreEnv("HASNA_DATA_HOME", originalHasnaDataHome);
  restoreEnv("HASNA_STATE_HOME", originalHasnaStateHome);
  if (tempRoot) rmSync(tempRoot, { recursive: true, force: true });
  tempRoot = null;
});

function setTestEnv(): void {
  tempRoot = mkdtempSync(join(tmpdir(), "contacts-vault-xdg-"));
  process.env["HOME"] = tempRoot;
  delete process.env["USERPROFILE"];
  delete process.env["HASNA_DATA_HOME"];
  delete process.env["HASNA_STATE_HOME"];
}

describe("XDG conformance — vault documents + session routing", () => {
  it("routes the vault session state file to the XDG state root", () => {
    setTestEnv();
    const stateDir = getVaultSessionDir();
    const expected = join(tempRoot!, ".local", "state", "hasna", "contacts");
    expect(stateDir).toBe(expected);
    expect(stateDir).not.toContain(".hasna");
    expect(getVaultSessionPath()).toBe(join(expected, ".vault-session"));
    expect(getVaultSessionPath()).not.toContain(".hasna");
  });

  it("routes the documents directory to the XDG data root", () => {
    setTestEnv();
    const docsDir = getDocumentsDir();
    const expected = join(tempRoot!, ".local", "share", "hasna", "contacts", "documents");
    expect(docsDir).toBe(expected);
    expect(docsDir).not.toContain(".hasna");
  });

  it("adopts a legacy .vault-session into the XDG state root when present", () => {
    setTestEnv();
    const legacy = join(tempRoot!, ".hasna", "contacts");
    mkdirSync(legacy, { recursive: true });
    writeFileSync(join(legacy, ".vault-session"), "legacy-session");

    const sessionPath = getVaultSessionPath();
    expect(existsSync(sessionPath)).toBe(true);
  });
});
