import { afterEach, describe, expect, test } from "bun:test";
import { chmodSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createProjectsClientFromEnv } from "./index.js";

// Every case builds the client from a CALLER-BUILT env, which is hermetic in
// the shared @hasna/contracts seam: it reaches neither the machine's Keychain
// nor its disk unless this file hands it a runner or a HASNA_HOME.

const cleanup: string[] = [];
afterEach(() => {
  while (cleanup.length) rmSync(cleanup.pop()!, { recursive: true, force: true });
});

function captureFetch() {
  const calls: Array<{ url: string; apiKey: string | null }> = [];
  const fetchImpl = (async (input: RequestInfo | URL, init?: RequestInit) => {
    const headers = new Headers(init?.headers);
    calls.push({ url: String(input), apiKey: headers.get("x-api-key") });
    return new Response(JSON.stringify({ items: [], total: 0 }), {
      status: 200,
      headers: { "content-type": "application/json" },
    });
  }) as typeof fetch;
  return { calls, fetchImpl };
}

function keychainRunner(items: Record<string, string>) {
  return (argv: readonly string[]) => {
    const service = argv[argv.indexOf("-s") + 1] ?? "";
    const value = items[service];
    if (value === undefined) return { status: 44, stdout: "", stderr: "" };
    return { status: 0, stdout: `${value}\n`, stderr: "" };
  };
}

function credentialsHome(contents: string, mode = 0o600): string {
  const root = mkdtempSync(join(tmpdir(), "projects-sdk-credentials-"));
  cleanup.push(root);
  const dir = join(root, "hasna", "projects", "config");
  mkdirSync(dir, { recursive: true });
  const file = join(dir, "credentials");
  writeFileSync(file, contents);
  chmodSync(file, mode);
  return join(root, "hasna");
}

describe("createProjectsClientFromEnv", () => {
  test("no credential in any tier -> throws, never an anonymous or local client", () => {
    expect(() => createProjectsClientFromEnv({})).toThrow(/no API key could be resolved/i);
    expect(() => createProjectsClientFromEnv({})).toThrow(/never fall back to SQLite/i);
  });

  test("tier 5: the canonical env key reaches the default fleet gateway", async () => {
    const { calls, fetchImpl } = captureFetch();
    const client = createProjectsClientFromEnv({ HASNA_PROJECTS_API_KEY: "env-key" }, { fetch: fetchImpl });
    await client.listProjects();
    expect(calls).toHaveLength(1);
    expect(calls[0]!.url).toBe("https://api.hasna.com/projects/v1/projects");
    expect(calls[0]!.apiKey).toBe("env-key");
  });

  test("the health probe sits above /v1, so the base URL is the origin root", async () => {
    const { calls, fetchImpl } = captureFetch();
    const client = createProjectsClientFromEnv({ HASNA_PROJECTS_API_KEY: "env-key" }, { fetch: fetchImpl });
    await client.getHealth();
    expect(calls[0]!.url).toBe("https://api.hasna.com/projects/health");
  });

  test("the unprefixed alias still resolves, and the canonical name wins when both are set", async () => {
    const { calls, fetchImpl } = captureFetch();
    const aliased = createProjectsClientFromEnv({ PROJECTS_API_KEY: "alias-key" }, { fetch: fetchImpl });
    await aliased.listProjects();
    expect(calls[0]!.apiKey).toBe("alias-key");

    const both = createProjectsClientFromEnv(
      { HASNA_PROJECTS_API_KEY: "canonical-key", PROJECTS_API_KEY: "canonical-key" },
      { fetch: fetchImpl },
    );
    await both.listProjects();
    expect(calls[1]!.apiKey).toBe("canonical-key");
  });

  test("tier 1: an explicit apiKey outranks every environment tier", async () => {
    const { calls, fetchImpl } = captureFetch();
    const client = createProjectsClientFromEnv(
      { HASNA_PROJECTS_API_KEY: "env-key" },
      { apiKey: "argument-key", fetch: fetchImpl },
    );
    await client.listProjects();
    expect(calls[0]!.apiKey).toBe("argument-key");
  });

  test("tier 2: the deliberate override outranks the plain env key", async () => {
    const { calls, fetchImpl } = captureFetch();
    const client = createProjectsClientFromEnv(
      { HASNA_PROJECTS_API_KEY: "env-key", HASNA_PROJECTS_API_KEY_OVERRIDE: "override-key" },
      { fetch: fetchImpl },
    );
    await client.listProjects();
    expect(calls[0]!.apiKey).toBe("override-key");
  });

  test("tier 3: the Keychain supplies both the key and the authority", async () => {
    const { calls, fetchImpl } = captureFetch();
    const client = createProjectsClientFromEnv(
      { HASNA_STATION: "station-fixture", HASNA_PROJECTS_API_KEY: "stale-env-key" },
      {
        fetch: fetchImpl,
        keychain: {
          platform: "darwin",
          enabled: true,
          run: keychainRunner({
            "hasna.credentials.projects.api-key": "keychain-key",
            "hasna.credentials.projects.api-url": "https://projects.keychain.test",
          }),
        },
      },
    );
    await client.listProjects();
    expect(calls[0]!.url).toBe("https://projects.keychain.test/v1/projects");
    expect(calls[0]!.apiKey).toBe("keychain-key");
  });

  test("tier 4: ~/.hasna/projects/config/credentials beats a stale env export", async () => {
    const home = credentialsHome(
      "HASNA_PROJECTS_API_URL=https://projects.disk.test\nHASNA_PROJECTS_API_KEY=disk-key\n",
    );
    const { calls, fetchImpl } = captureFetch();
    const client = createProjectsClientFromEnv(
      { HASNA_HOME: home, HASNA_PROJECTS_API_KEY: "stale-env-key" },
      { fetch: fetchImpl },
    );
    await client.listProjects();
    expect(calls[0]!.url).toBe("https://projects.disk.test/v1/projects");
    expect(calls[0]!.apiKey).toBe("disk-key");
  });

  test("a world-readable credentials file fails loud instead of falling through", () => {
    const home = credentialsHome("HASNA_PROJECTS_API_KEY=disk-key\n", 0o644);
    expect(() => createProjectsClientFromEnv({ HASNA_HOME: home })).toThrow(/0400 or 0600/);
  });

  test("an explicit base URL with no apiKey still throws — the ambient fleet key is never attached to a named authority", () => {
    // #1794: a caller that names the authority but provides no credential must
    // not get a client that silently attaches the machine's fleet key. With a
    // caller-built env the Keychain/disk tiers are out of scope, so the only
    // thing that could authenticate this client is nothing — it throws.
    expect(() =>
      createProjectsClientFromEnv({}, { baseUrl: "https://projects.override.test" }),
    ).toThrow(/no API key could be resolved/i);
  });

  test("an explicit base URL still wins, and /v1 is appended by the generated routes", async () => {
    const { calls, fetchImpl } = captureFetch();
    const client = createProjectsClientFromEnv(
      { HASNA_PROJECTS_API_KEY: "env-key" },
      { baseUrl: "https://projects.override.test", fetch: fetchImpl },
    );
    await client.listProjects();
    expect(calls[0]!.url).toBe("https://projects.override.test/v1/projects");
  });

  test("retired locations are never inputs", () => {
    // No ~/.hasna/fleet-env, no ~/.hasna/cloud, no ~/.config/hasna, and
    // XDG_CONFIG_HOME is not consulted at all.
    expect(() => createProjectsClientFromEnv({ XDG_CONFIG_HOME: "/tmp/xdg-should-be-ignored" }))
      .toThrow(/no API key could be resolved/i);
  });
});
