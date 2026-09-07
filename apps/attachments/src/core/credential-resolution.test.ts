import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "fs";
import { tmpdir } from "os";
import { join } from "path";
import { resolveAttachmentsTransport } from "./client-config";

/**
 * Hermetic credential-resolution probes for the @hasna/contracts chain
 * (owner directive 2026-09-04, hasna/apps#1720).
 *
 * Every case uses a CALLER-BUILT env dictionary — the hermetic seam the
 * resolver itself defines: the machine's Keychain stays OFF unless a fake
 * `security` runner is injected, and the disk tier anchors to the scratch
 * `HASNA_HOME` / `HOME` the test writes, never to the operator's home. The
 * tests therefore pin what the SEAM resolves, and a station's Keychain or
 * credential file cannot leak in.
 */

type Env = Record<string, string | undefined>;

let scratch: string;
let credentialsHome: string;

beforeEach(() => {
  scratch = mkdtempSync(join(tmpdir(), "attachments-credential-resolution-"));
  credentialsHome = join(scratch, "hasna-home");
  mkdirSync(credentialsHome, { recursive: true });
});

afterEach(() => {
  rmSync(scratch, { recursive: true, force: true });
});

function diskEnv(overrides: Env = {}): Env {
  return {
    HASNA_HOME: credentialsHome,
    ...overrides,
  };
}

function writeCredentialFile(apiKey: string, mode = 0o600): string {
  const dir = join(credentialsHome, "attachments", "config");
  mkdirSync(dir, { recursive: true });
  const path = join(dir, "credentials");
  writeFileSync(path, `HASNA_ATTACHMENTS_API_KEY=${apiKey}\n`, { mode });
  return path;
}

function fakeSecurityRunner(answers: Record<string, string>, status = 0) {
  return (argv: readonly string[]) => {
    const index = argv.indexOf("-s");
    const service = index >= 0 ? argv[index + 1] : "";
    return {
      status,
      stdout: answers[service] ?? "",
      stderr: "",
    };
  };
}

const KEYCHAIN_API_KEY = "hasna_keychain_fixture_key_01";
const KEYCHAIN_API_URL = "https://keychain.hasna.example";
const KEYCHAIN_SERVICE = "hasna.credentials.attachments.api-key";
const KEYCHAIN_URL_SERVICE = "hasna.credentials.attachments.api-url";

describe("resolveAttachmentsTransport — credential tiers", () => {
  test("env pair resolves the canonical env tier, fresh", () => {
    const env = { HASNA_ATTACHMENTS_API_URL: "https://env.hasna.example", HASNA_ATTACHMENTS_API_KEY: "env-key" };
    const resolved = resolveAttachmentsTransport(env);
    expect(resolved.url).toBe("https://env.hasna.example");
    expect(resolved.baseUrl).toBe("https://env.hasna.example/v1");
    expect(resolved.apiKey).toBe("env-key");
    expect(resolved.apiKeySource).toBe("HASNA_ATTACHMENTS_API_KEY");
    expect(resolved.apiKeyTier).toBe("env");
    expect(resolved.apiUrlSource).toBe("HASNA_ATTACHMENTS_API_URL");
    expect(resolved.transportSource).toBe("HASNA_ATTACHMENTS_API_URL");
    expect(resolved.warning).toBeNull();
  });

  test("canonical name outranks the unprefixed legacy alias", () => {
    const env = {
      HASNA_ATTACHMENTS_API_URL: "https://canonical.hasna.example",
      ATTACHMENTS_API_URL: "https://alias.hasna.example",
      HASNA_ATTACHMENTS_API_KEY: "canonical-key",
      ATTACHMENTS_API_KEY: "alias-key",
    };
    expect(() => resolveAttachmentsTransport(env)).toThrow(/disagree/);
    // Legitimate legacy-only configuration still resolves (one release).
    const legacy: Env = { ATTACHMENTS_API_URL: "https://alias.hasna.example", ATTACHMENTS_API_KEY: "alias-key" };
    const resolved = resolveAttachmentsTransport(legacy);
    expect(resolved.apiKeySource).toBe("ATTACHMENTS_API_KEY");
    expect(resolved.url).toBe("https://alias.hasna.example");
  });

  test("disk credentials file wins over the env tier and reports its path", () => {
    const path = writeCredentialFile("disk-key");
    const env = diskEnv({
      HASNA_ATTACHMENTS_API_URL: "https://disk.hasna.example",
      HASNA_ATTACHMENTS_API_KEY: "env-key",
    });
    const resolved = resolveAttachmentsTransport(env);
    expect(resolved.apiKey).toBe("disk-key");
    expect(resolved.apiKeySource).toBe(path);
    expect(resolved.apiKeyTier).toBe("disk");
  });

  test("injected security runner supplies the Keychain tier (darwin)", () => {
    const runner = fakeSecurityRunner({
      [KEYCHAIN_SERVICE]: KEYCHAIN_API_KEY,
      [KEYCHAIN_URL_SERVICE]: KEYCHAIN_API_URL,
    });
    const resolved = resolveAttachmentsTransport(
      { HASNA_STATION: "test-station" },
      { credentials: { keychain: { enabled: true, platform: "darwin", run: runner } } },
    );
    expect(resolved.apiKey).toBe(KEYCHAIN_API_KEY);
    expect(resolved.apiKeySource).toBe(`keychain:${KEYCHAIN_SERVICE}@test-station`);
    expect(resolved.apiKeyTier).toBe("keychain");
    expect(resolved.url).toBe(KEYCHAIN_API_URL);
  });

  test("keychain item is re-read on every call (no snapshot)", () => {
    let rotated = KEYCHAIN_API_KEY;
    const runner = (argv: readonly string[]) => ({
      status: 0,
      stdout: argv.includes("-s") && argv[argv.indexOf("-s") + 1] === KEYCHAIN_SERVICE ? rotated : KEYCHAIN_API_URL,
      stderr: "",
    });
    const options = { credentials: { keychain: { enabled: true, platform: "darwin", run: runner } } };
    expect(resolveAttachmentsTransport({}, options).apiKey).toBe(KEYCHAIN_API_KEY);
    rotated = "hasna_keychain_rotated_key_02";
    expect(resolveAttachmentsTransport({}, options).apiKey).toBe("hasna_keychain_rotated_key_02");
  });

  test("a credential with no URL resolves the default fleet gateway", () => {
    const env = { HASNA_ATTACHMENTS_API_KEY: "gateway-key" };
    const resolved = resolveAttachmentsTransport(env);
    expect(resolved.url).toBe("https://api.hasna.com/attachments");
    expect(resolved.baseUrl).toBe("https://api.hasna.com/attachments/v1");
    expect(resolved.apiUrlSource).toBe("default");
    expect(resolved.transportSource).toBe("default");
  });
});

describe("resolveAttachmentsTransport — fail-loud refusals", () => {
  test("empty environment throws (no local fallback, no default credential)", () => {
    expect(() => resolveAttachmentsTransport({})).toThrow(/HASNA_ATTACHMENTS_API_URL|no API key could be resolved/);
  });

  test("URL without a key throws; a scratch home is never consulted for a local store", () => {
    const env = diskEnv({ HASNA_ATTACHMENTS_API_URL: "https://half.hasna.example" });
    expect(() => resolveAttachmentsTransport(env)).toThrow(/no API key could be resolved/);
  });

  test("declared-but-blank canonical key is a refusal, not an absence", () => {
    const env = {
      HASNA_ATTACHMENTS_API_URL: "https://blank.hasna.example",
      HASNA_ATTACHMENTS_API_KEY: "   ",
    };
    expect(() => resolveAttachmentsTransport(env)).toThrow(/blank/i);
  });

  test("disagreeing canonical and alias keys are a refusal", () => {
    const env = {
      HASNA_ATTACHMENTS_API_URL: "https://x.hasna.example",
      HASNA_ATTACHMENTS_API_KEY: "canonical-key",
      ATTACHMENTS_API_KEY: "alias-key",
    };
    expect(() => resolveAttachmentsTransport(env)).toThrow(/disagree/);
  });

  test("disagreeing URL aliases are a refusal", () => {
    const env = {
      HASNA_ATTACHMENTS_API_URL: "https://x.hasna.example",
      ATTACHMENTS_API_URL: "https://y.hasna.example",
      HASNA_ATTACHMENTS_API_KEY: "key",
    };
    expect(() => resolveAttachmentsTransport(env)).toThrow(/disagree/i);
  });

  test("mode and storage-mode switches are inert — no selector is read", () => {
    const env = {
      HASNA_ATTACHMENTS_API_URL: "https://x.hasna.example",
      HASNA_ATTACHMENTS_API_KEY: "key",
      HASNA_ATTACHMENTS_MODE: "local",
      HASNA_ATTACHMENTS_STORAGE_MODE: "local",
      ATTACHMENTS_MODE: "local",
      ATTACHMENTS_STORAGE_MODE: "local",
      HASNA_ATTACHMENTS_DATABASE_URL: "postgres://example/db",
    };
    const resolved = resolveAttachmentsTransport(env);
    expect(resolved.apiKeyTier).toBe("env");
    expect(resolved.url).toBe("https://x.hasna.example");
  });
});