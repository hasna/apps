import { describe, expect, test } from "bun:test";
import {
  SigningSecretError,
  mintApiKey,
  normalizeSigningSecret,
  resolveSigningSecret,
  signingSecretEnvKeys,
  signingSecretHasSurroundingWhitespace,
  verifyApiKeyToken,
} from "../src/auth/index";
import { runIssueKey } from "../src/cli/issue-key";

// hasna/apps#1543: the stored fleet signing secrets are 64 hex characters plus
// the trailing newline `aws secretsmanager get-secret-value` leaves behind.
// Servers trimmed before verifying; `issue-key` did not before signing. Every
// key minted out of band was therefore rejected `unknown_key` and left an orphan
// `api_keys` row. These tests pin the property that closes it: raw and trimmed
// spellings of one secret are the SAME key, on both sides of the HMAC.
const HEX_SECRET = "a".repeat(64);
const RAW_SECRET = `${HEX_SECRET}\n`;

describe("signing secrets are trimmed on read (hasna/apps#1543)", () => {
  test("a raw and a trimmed secret mint the same token", () => {
    const options = { app: "projects", scopes: ["projects:read"], kid: "k1", nowMs: 1_700_000_000_000 };
    const fromRaw = mintApiKey({ ...options, signingSecret: RAW_SECRET });
    const fromTrimmed = mintApiKey({ ...options, signingSecret: HEX_SECRET });
    expect(fromRaw.token).toBe(fromTrimmed.token);
    expect(fromRaw.tokenHash).toBe(fromTrimmed.tokenHash);
  });

  test("a server holding the raw secret verifies a key signed with the trimmed one, and back", () => {
    const minted = mintApiKey({ app: "projects", scopes: ["projects:read"], signingSecret: HEX_SECRET });
    expect(verifyApiKeyToken(minted.token, { signingSecret: RAW_SECRET, expectedApp: "projects" }).ok).toBe(true);

    const mintedRaw = mintApiKey({ app: "projects", scopes: ["projects:read"], signingSecret: RAW_SECRET });
    expect(verifyApiKeyToken(mintedRaw.token, { signingSecret: HEX_SECRET, expectedApp: "projects" }).ok).toBe(true);
  });

  test("a genuinely different secret still fails, so the trim is not a wildcard", () => {
    const minted = mintApiKey({ app: "projects", scopes: ["projects:read"], signingSecret: HEX_SECRET });
    const other = verifyApiKeyToken(minted.token, { signingSecret: "b".repeat(64), expectedApp: "projects" });
    expect(other.ok).toBe(false);
  });

  test("the entropy floor is measured after trimming", () => {
    expect(() =>
      mintApiKey({ app: "projects", scopes: ["projects:read"], signingSecret: `${" ".repeat(40)}short` }),
    ).toThrow(/16 bytes/);
  });

  test("binary secrets are never trimmed", () => {
    const bytes = new Uint8Array(20).fill(9);
    expect(normalizeSigningSecret(bytes)).toBe(bytes);
    const minted = mintApiKey({ app: "projects", scopes: ["projects:read"], signingSecret: bytes, kid: "k2", nowMs: 1 });
    const same = mintApiKey({
      app: "projects",
      scopes: ["projects:read"],
      signingSecret: Buffer.from(bytes),
      kid: "k2",
      nowMs: 1,
    });
    expect(minted.token).toBe(same.token);
  });
});

describe("resolveSigningSecret", () => {
  test("prefers the per-app key, falls back to the shared one, and trims both", () => {
    expect(signingSecretEnvKeys("projects")).toEqual([
      "HASNA_PROJECTS_API_SIGNING_KEY",
      "HASNA_API_SIGNING_KEY",
    ]);
    expect(
      resolveSigningSecret("projects", {
        HASNA_PROJECTS_API_SIGNING_KEY: RAW_SECRET,
        HASNA_API_SIGNING_KEY: "b".repeat(64),
      }),
    ).toEqual({ value: HEX_SECRET, source: "HASNA_PROJECTS_API_SIGNING_KEY", trimmed: true });
    expect(resolveSigningSecret("projects", { HASNA_API_SIGNING_KEY: HEX_SECRET })).toEqual({
      value: HEX_SECRET,
      source: "HASNA_API_SIGNING_KEY",
      trimmed: false,
    });
  });

  test("an explicit env name is terminal and never falls back", () => {
    expect(() =>
      resolveSigningSecret("projects", { HASNA_API_SIGNING_KEY: HEX_SECRET }, { envName: "CUSTOM_SIGNING_KEY" }),
    ).toThrow(SigningSecretError);
  });

  test("blank and whitespace-only values are absent, and the failure names keys only", () => {
    try {
      resolveSigningSecret("projects", { HASNA_PROJECTS_API_SIGNING_KEY: "   " });
      throw new Error("expected a refusal");
    } catch (error) {
      expect(error).toBeInstanceOf(SigningSecretError);
      expect((error as SigningSecretError).attempted).toEqual([
        "HASNA_PROJECTS_API_SIGNING_KEY",
        "HASNA_API_SIGNING_KEY",
      ]);
      expect((error as Error).message).not.toContain(HEX_SECRET);
    }
  });

  test("the provisioning check flags a secret that needs trimming", () => {
    expect(signingSecretHasSurroundingWhitespace(RAW_SECRET)).toBe(true);
    expect(signingSecretHasSurroundingWhitespace(HEX_SECRET)).toBe(false);
  });
});

describe("issue-key uses the shared reader", () => {
  test("a raw stored secret mints a key the trimmed-secret verifier accepts", async () => {
    const printed: string[] = [];
    const errors: string[] = [];
    const log = console.log;
    console.log = (...args: unknown[]) => printed.push(args.map(String).join(" "));
    try {
      await runIssueKey(
        { app: "projects", scopes: "projects:read", agent: "fleet", store: false, json: true },
        {
          report: (_o, message) => errors.push(message),
          env: { HASNA_PROJECTS_API_SIGNING_KEY: RAW_SECRET } as NodeJS.ProcessEnv,
        },
      );
    } finally {
      console.log = log;
    }
    expect(errors).toEqual([]);
    const payload = JSON.parse(printed.join("\n")) as { token: string };
    expect(verifyApiKeyToken(payload.token, { signingSecret: HEX_SECRET, expectedApp: "projects" }).ok).toBe(true);
  });

  test("the database URL is trimmed before it reaches the driver", async () => {
    const seen: string[] = [];
    const errors: string[] = [];
    const log = console.log;
    console.log = () => {};
    try {
      await runIssueKey(
        { app: "projects", scopes: "projects:read", agent: "fleet", json: true },
        {
          report: (_o, message) => errors.push(message),
          env: {
            HASNA_PROJECTS_API_SIGNING_KEY: HEX_SECRET,
            HASNA_PROJECTS_DATABASE_URL: "postgres://user@db.example.test:5432/projects\n",
          } as NodeJS.ProcessEnv,
          connectStore: async (connectionString) => {
            seen.push(connectionString);
            return {
              store: { ensureSchema: async () => {}, insertMinted: async () => {} },
              close: async () => {},
            };
          },
        },
      );
    } finally {
      console.log = log;
    }
    expect(errors).toEqual([]);
    expect(seen).toEqual(["postgres://user@db.example.test:5432/projects"]);
  });
});
