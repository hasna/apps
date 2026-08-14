import { afterAll, beforeEach, describe, expect, it } from "bun:test";
import "./setup";
import { mkdtempSync, writeFileSync } from "fs";
import { tmpdir } from "os";
import { join } from "path";
import { closeDb, getDb } from "../src/lib/db";
import {
  addServer,
  getServer,
  setServerCredentialRef,
  setServerEnv,
  unsetServerCredentialRef,
} from "../src/lib/registry";
import {
  CredentialReferenceError,
  redactServerCredentials,
  resolveServerEnv,
} from "../src/lib/credentials";

function clearDb() {
  const db = getDb();
  db.exec("DELETE FROM tool_cache");
  db.exec("DELETE FROM servers");
}

describe("credential references", () => {
  beforeEach(() => {
    clearDb();
  });

  afterAll(() => {
    closeDb();
  });

  it("rejects raw secret-like environment values and stores credential refs separately", () => {
    expect(() =>
      addServer({
        command: "npx",
        name: "raw-secret",
        env: { API_KEY: "sk_live_should_not_be_stored" },
      }),
    ).toThrow(CredentialReferenceError);

    const server = addServer({
      command: "npx",
      name: "credentialed",
      env: { DEBUG: "1" },
      credentialRefs: {
        API_KEY: { source: "env", name: "UPSTREAM_API_KEY" },
      },
    });

    expect(server.env).toEqual({ DEBUG: "1" });
    expect(server.credentialRefs).toEqual({
      API_KEY: { source: "env", name: "UPSTREAM_API_KEY", required: true },
    });
  });

  it("resolves process env credential refs without storing their values", () => {
    const previous = process.env.UPSTREAM_API_KEY;
    process.env.UPSTREAM_API_KEY = "resolved-secret";
    try {
      const server = addServer({
        command: "npx",
        name: "resolve-env",
        credentialRefs: {
          API_KEY: { source: "env", name: "UPSTREAM_API_KEY" },
        },
      });

      expect(resolveServerEnv(server)).toEqual({ API_KEY: "resolved-secret" });
      expect(getServer("resolve-env")!.env).toEqual({});
    } finally {
      if (previous === undefined) delete process.env.UPSTREAM_API_KEY;
      else process.env.UPSTREAM_API_KEY = previous;
    }
  });

  it("resolves local vault credential refs without storing their values in the registry", () => {
    const previous = process.env.HASNA_MCPS_CREDENTIAL_VAULT_PATH;
    const vaultPath = join(mkdtempSync(join(tmpdir(), "mcps-vault-")), "credentials.json");
    writeFileSync(vaultPath, JSON.stringify({ "notion-token": "vault-secret" }), "utf-8");
    process.env.HASNA_MCPS_CREDENTIAL_VAULT_PATH = vaultPath;

    try {
      const server = addServer({
        command: "npx",
        name: "resolve-local-vault",
        credentialRefs: {
          NOTION_TOKEN: { source: "local-vault", name: "notion-token" },
        },
      });

      expect(resolveServerEnv(server)).toEqual({ NOTION_TOKEN: "vault-secret" });
      expect(JSON.stringify(getServer("resolve-local-vault"))).not.toContain("vault-secret");
    } finally {
      if (previous === undefined) delete process.env.HASNA_MCPS_CREDENTIAL_VAULT_PATH;
      else process.env.HASNA_MCPS_CREDENTIAL_VAULT_PATH = previous;
    }
  });

  it("redacts legacy raw secret env values in public views", () => {
    const server = addServer({ command: "npx", name: "legacy", env: { DEBUG: "1" } });
    getDb()
      .prepare("UPDATE servers SET env = ? WHERE id = ?")
      .run(JSON.stringify({ DEBUG: "1", API_TOKEN: "github-token-should-not-be-exported" }), server.id);

    const redacted = redactServerCredentials(getServer("legacy")!);

    expect(redacted.env).toEqual({ DEBUG: "1", API_TOKEN: "<redacted>" });
    expect(JSON.stringify(redacted)).not.toContain("github-token-should-not-be-exported");
  });

  it("manages credential refs through registry helpers", () => {
    addServer({ command: "npx", name: "managed" });

    expect(() => setServerEnv("managed", "API_TOKEN", "secret-value")).toThrow(CredentialReferenceError);

    setServerCredentialRef("managed", "API_TOKEN", { source: "local-vault", name: "notion-token" });
    expect(getServer("managed")!.credentialRefs).toEqual({
      API_TOKEN: { source: "local-vault", name: "notion-token", required: true },
    });

    unsetServerCredentialRef("managed", "API_TOKEN");
    expect(getServer("managed")!.credentialRefs).toEqual({});
  });
});
