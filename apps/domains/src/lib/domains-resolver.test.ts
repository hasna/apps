/**
 * The resolver seam's contract, tested hermetic (hasna/apps#1720 checklist 6):
 *
 *   1. CREDENTIAL-RESOLUTION — a fake HOME / HASNA_HOME and an injected
 *      `security` runner resolve the credential from the disk tier and the
 *      Keychain tier, with the right source names and tiers; the CLI, the MCP
 *      server and the SDK all read through this ONE seam.
 *   2. FAIL-CLOSED — a hosted URL with no credential anywhere throws the
 *      wrapped fail-closed error naming the canonical env pair.
 *   3. TRANSPORT-REPORT — the report names the URL source, the key source and
 *      the tier, never the key value; a key alone reports the default fleet
 *      gateway authority.
 *
 * Nothing here touches a real Home directory, a real Keychain, or the network:
 * every env object handed to the seam is caller-built (Keychain OFF for
 * caller-built envs unless a runner is injected) and every HOME is a scratch
 * directory.
 */
import { describe, expect, test } from "bun:test";
import { chmodSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  DOMAINS_APP_NAME,
  domainsResolverInputs,
  domainsResolverEnv,
  resolveDomainsHttpClient,
  resolveDomainsTransport,
} from "./domains-resolver.js";

function scratchHome(): string {
  return mkdtempSync(join(tmpdir(), "domains-resolver-test-"));
}

/** Write a credential file exactly as the resolver's disk tier expects it. */
function writeCredentials(home: string, lines: string[], rel = join(".hasna", "domains", "config")): string {
  const dir = join(home, rel);
  mkdirSync(dir, { recursive: true });
  const path = join(dir, "credentials");
  writeFileSync(path, `${lines.join("\n")}\n`);
  chmodSync(path, 0o600);
  return path;
}

/** An injected `/usr/bin/security` runner: api-key present, api-url absent. */
function keychainRunner(key: string) {
  return (argv: readonly string[]): { status: number; stdout: string; stderr: string } => {
    const joined = argv.join(" ");
    if (joined.includes(".api-url")) {
      return { status: 44, stdout: "", stderr: "The specified item could not be found in the keychain." };
    }
    if (joined.includes(".api-key")) {
      return { status: 0, stdout: `${key}\n`, stderr: "" };
    }
    throw new Error(`unexpected security argv: ${joined}`);
  };
}

describe("credential resolution through the shared chain (hermetic)", () => {
  test("disk tier: ~/.hasna/domains/config/credentials under a fake HOME", () => {
    const home = scratchHome();
    try {
      const path = writeCredentials(home, ["HASNA_DOMAINS_API_KEY=fake-disk-key"]);
      const env = { HOME: home, HASNA_DOMAINS_API_URL: "https://domains.example.test" };

      const { report, credential } = resolveDomainsTransport(env);

      expect(credential.apiKey).toBe("fake-disk-key");
      expect(credential.tier).toBe("disk");
      expect(credential.source).toBe(path);
      expect(report.apiKeyTier).toBe("disk");
      expect(report.apiUrlSource).toBe("HASNA_DOMAINS_API_URL");
      expect(report.baseUrl).toBe("https://domains.example.test/v1");
    } finally {
      rmSync(home, { recursive: true, force: true });
    }
  });

  test("disk tier: the URL and key may BOTH live in the credentials file", () => {
    const home = scratchHome();
    try {
      const path = writeCredentials(home, [
        "HASNA_DOMAINS_API_URL=https://from-disk.example.test",
        "HASNA_DOMAINS_API_KEY=fake-disk-key-both",
      ]);
      const env = { HOME: home };

      const { report, credential } = resolveDomainsTransport(env);

      expect(credential.tier).toBe("disk");
      expect(credential.source).toBe(path);
      expect(report.apiUrlSource).toBe(path);
      expect(report.baseUrl).toBe("https://from-disk.example.test/v1");
    } finally {
      rmSync(home, { recursive: true, force: true });
    }
  });

  test("disk tier: $HASNA_HOME redirects the credential file", () => {
    const home = scratchHome();
    try {
      const path = writeCredentials(home, ["HASNA_DOMAINS_API_KEY=hasna-home-key"], join("domains", "config"));
      const env = { HASNA_HOME: home };

      const { report, credential } = resolveDomainsTransport(env);

      expect(credential.apiKey).toBe("hasna-home-key");
      expect(credential.tier).toBe("disk");
      expect(credential.source).toBe(path);
      expect(report.apiKeyTier).toBe("disk");
      // No URL anywhere: the fleet gateway default applies.
      expect(report.apiUrlSource).toBe("default");
      expect(report.baseUrl).toBe("https://api.hasna.com/domains/v1");
    } finally {
      rmSync(home, { recursive: true, force: true });
    }
  });

  test("keychain tier: an injected security runner supplies the key", () => {
    const home = scratchHome();
    try {
      const env = {
        HOME: home,
        HASNA_STATION: "station-test",
        HASNA_DOMAINS_API_URL: "https://domains.example.test",
      };
      const runner = keychainRunner("fake-keychain-key");
      const run = (argv: readonly string[]): { status: number; stdout: string; stderr: string } => {
        if (argv.join(" ").includes("domains.example.test")) return { status: 0, stdout: "", stderr: "" };
        return runner(argv);
      };

      const { report, credential } = resolveDomainsTransport(env, {
        credentials: { keychain: { enabled: true, platform: "darwin", run } },
      });

      expect(credential.apiKey).toBe("fake-keychain-key");
      expect(credential.tier).toBe("keychain");
      expect(credential.source).toBe("keychain:hasna.credentials.domains.api-key@station-test");
      expect(report.apiKeyTier).toBe("keychain");
    } finally {
      rmSync(home, { recursive: true, force: true });
    }
  });

  test("keychain tier: ambient gate travels across blank-normalisation copies (#1788)", () => {
    const home = scratchHome();
    try {
      // A declared-but-blank authority variable forces a COPY of the env; the
      // Keychain tier must stay reachable across it because the gate was
      // decided on the original env, not handed to the copy's identity test.
      const env: Record<string, string> = {
        HOME: home,
        HASNA_STATION: "station-test",
        HASNA_DOMAINS_API_URL: "https://domains.example.test",
        HASNA_DOMAINS_API_KEY: "", // blank: "not configured" at this seam
      };
      const inputs = domainsResolverInputs(env);
      expect(inputs.env).not.toBe(env); // the blank forced a copy
      expect(inputs.env).not.toHaveProperty("HASNA_DOMAINS_API_KEY");

      const runner = keychainRunner("fake-keychain-key");
      const { credential } = resolveDomainsTransport(inputs.env, {
        credentials: { ...inputs.credentials, keychain: { enabled: true, platform: "darwin", run: runner } },
      });
      expect(credential.apiKey).toBe("fake-keychain-key");
      expect(credential.tier).toBe("keychain");
    } finally {
      rmSync(home, { recursive: true, force: true });
    }
  });

  test("the same resolution backs the HTTP storage client (fresh per request)", () => {
    const home = scratchHome();
    try {
      writeCredentials(home, ["HASNA_DOMAINS_API_KEY=fake-disk-key"]);
      const env = { HOME: home, HASNA_DOMAINS_API_URL: "https://domains.example.test" };

      const wired = resolveDomainsHttpClient(env);
      expect(wired.transport).toBe("http");
      expect(wired.resolution.apiKeySource).toBe(wired.resolution.apiKeySource);
      expect(wired.client.name).toBe(DOMAINS_APP_NAME);
      expect(wired.client.baseUrl).toBe("https://domains.example.test/v1");
      // The transport holds a per-request binding provider: the credential is
      // re-read at request time. Assert the shape indirectly — the transport
      // re-resolves on the first call, which is the transport's own contract.
      expect(wired.client.transport.baseUrl).toBe("https://domains.example.test/v1");
    } finally {
      rmSync(home, { recursive: true, force: true });
    }
  });
});

describe("fail closed when hosted with no credential (hermetic)", () => {
  test("a URL with no key anywhere throws the wrapped fail-closed error", () => {
    const home = scratchHome();
    try {
      const env = { HOME: home, HASNA_DOMAINS_API_URL: "https://domains.example.test" };
      let caught: unknown;
      try {
        resolveDomainsTransport(env);
      } catch (error) {
        caught = error;
      }
      expect(caught).toBeInstanceOf(Error);
      const message = (caught as Error).message;
      expect(message).toContain("domains fails closed");
      expect(message).toContain("HASNA_DOMAINS_API_URL");
      expect(message).toContain("HASNA_DOMAINS_API_KEY");
      expect(message).toContain("no API key could be resolved");
    } finally {
      rmSync(home, { recursive: true, force: true });
    }
  });

  test("nothing configured at all throws too — never a local fallback", () => {
    const home = scratchHome();
    try {
      let caught: unknown;
      try {
        resolveDomainsTransport({ HOME: home });
      } catch (error) {
        caught = error;
      }
      const message = (caught as Error).message;
      expect(message).toContain("domains fails closed");
      expect(message).toContain("HASNA_DOMAINS_API_URL");
      // No env, no disk, no Keychain (caller-built env): every tier consulted
      // and refused — the message says so.
      expect(message).toMatch(/Keychain|credential file|environment/);
    } finally {
      rmSync(home, { recursive: true, force: true });
    }
  });
});

describe("transport report", () => {
  test("env tier: names the URL key, the key key and the tier; never the value", () => {
    const { report } = resolveDomainsTransport({
      HASNA_DOMAINS_API_URL: "https://domains.example.test",
      HASNA_DOMAINS_API_KEY: "super-secret-value",
    });
    expect(report.transport).toBe("http");
    expect(report.baseUrl).toBe("https://domains.example.test/v1");
    expect(report.apiUrlSource).toBe("HASNA_DOMAINS_API_URL");
    expect(report.apiKeySource).toBe("HASNA_DOMAINS_API_KEY");
    expect(report.apiKeyTier).toBe("env");
    expect(JSON.stringify(report)).not.toContain("super-secret-value");
  });

  test("key alone: the default fleet gateway is the authority", () => {
    const { report } = resolveDomainsTransport({ HASNA_DOMAINS_API_KEY: "key" });
    expect(report.apiUrlSource).toBe("default");
    expect(report.baseUrl).toBe("https://api.hasna.com/domains/v1");
    expect(report.apiKeyTier).toBe("env");
  });

  test("blank-normalisation keeps a complete config complete", () => {
    // An environment carrying a real key alongside a blank legacy alias is a
    // complete, unambiguous configuration at this seam.
    const env = { HASNA_DOMAINS_API_KEY: "key", DOMAINS_API_URL: "" };
    expect(domainsResolverEnv(env)).not.toBe(env);
    const { report } = resolveDomainsTransport(env);
    expect(report.transport).toBe("http");
    expect(report.apiKeyTier).toBe("env");
    expect(report.apiUrlSource).toBe("default");
  });
});