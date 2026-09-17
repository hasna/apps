/**
 * `@hasna/hooks/sdk` — fail-closed resolution, hosted request shape, and the
 * self-contained bundle promise (node builtins only, no bun:sqlite), built
 * from the SAME `bun build` invocation package.json uses so a stray
 * --external or a new SQLite import fails here first.
 */
import { afterEach, describe, expect, setDefaultTimeout, test } from "bun:test";
import { mkdtempSync, readFileSync, rmSync } from "fs";
import { join } from "path";
import { tmpdir } from "os";
import { builtinModules } from "module";
import packageJson from "../../package.json";
import { HooksClient, createHooksClient, resolveHooksSdkAuthority } from "./index.js";

setDefaultTimeout(60_000);

const root = join(import.meta.dir, "..", "..");

/** A caller-built env: the Keychain tier is off by construction (no ambient marker). */
function scrubbed(extra: Record<string, string> = {}): Record<string, string> {
  return { HASNA_STATION: "no-such-station", HOME: mkdtempSync(join(tmpdir(), "hooks-sdk-home-")), ...extra };
}

const noKeychain = { keychain: { enabled: false } };

describe("resolveHooksSdkAuthority fails closed", () => {
  test("nothing configured → throws REMOTE_API_* naming the tiers and the opt-in; no client", () => {
    let error: Error | null = null;
    try {
      resolveHooksSdkAuthority(scrubbed(), { credentials: noKeychain });
    } catch (e) {
      error = e as Error;
    }
    expect(error).not.toBeNull();
    expect(error!.message).toMatch(/^REMOTE_API_(CONFIG_MISSING|KEY_MISSING)/);
    expect(error!.message).toContain("hasna.credentials.hooks.api-key");
    expect(error!.message).toContain("~/.hasna/hooks/config/credentials");
    expect(error!.message).toContain("HASNA_HOOKS_API_KEY");
    expect(error!.message).toContain("HASNA_HOOKS_LOCAL=1");
  });

  test("the local opt-in is refused by name: the SDK has no local mode", () => {
    expect(() => resolveHooksSdkAuthority(scrubbed({ HASNA_HOOKS_LOCAL: "1" }), { credentials: noKeychain })).toThrow(
      /REMOTE_COMMAND_UNSUPPORTED.*hooks.*CLI/,
    );
  });

  test("a URL without a key is a strict-pair refusal", () => {
    expect(() =>
      resolveHooksSdkAuthority(scrubbed({ HASNA_HOOKS_API_URL: "https://registry.example.test/hooks" }), { credentials: noKeychain }),
    ).toThrow(/REMOTE_API_KEY_MISSING/);
  });

  test("a strict env pair resolves the authority; a key alone resolves the fleet gateway", () => {
    const explicit = resolveHooksSdkAuthority(
      scrubbed({ HASNA_HOOKS_API_URL: "https://registry.example.test/hooks", HASNA_HOOKS_API_KEY: "sdk-test-placeholder-key" }),
      { credentials: noKeychain },
    );
    expect(explicit.origin).toBe("https://registry.example.test/hooks");
    expect(explicit.v1BaseUrl).toBe("https://registry.example.test/hooks/v1");
    expect(explicit.apiKeySource).toBe("HASNA_HOOKS_API_KEY");
    const gateway = resolveHooksSdkAuthority(scrubbed({ HASNA_HOOKS_API_KEY: "sdk-test-placeholder-key" }), { credentials: noKeychain });
    expect(gateway.origin).toBe("https://api.hasna.com/hooks");
  });
});

describe("HooksClient talks to the resolved authority only", () => {
  const env = scrubbed({ HASNA_HOOKS_API_URL: "https://registry.example.test/hooks", HASNA_HOOKS_API_KEY: "sdk-test-placeholder-key" });

  function fakeFetch(handler: (url: string, init: RequestInit) => Response): { fetch: typeof fetch; calls: Array<{ url: string; init: RequestInit }> } {
    const calls: Array<{ url: string; init: RequestInit }> = [];
    const f = (async (input: any, init?: RequestInit) => {
      const url = typeof input === "string" ? input : input.url;
      calls.push({ url, init: init ?? {} });
      return handler(url, init ?? {});
    }) as unknown as typeof fetch;
    return { fetch: f, calls };
  }

  test("catalog/lock/artifact hit <origin>/api/v1/* with the x-api-key header and never follow redirects", async () => {
    const { fetch: f, calls } = fakeFetch((url) => {
      if (url.endsWith("/api/v1/catalog")) return Response.json({ hooks: [{ name: "gitguard", version: "1.0.0", sha256: "a" }] });
      if (url.endsWith("/api/v1/lock")) return Response.json({ hooks: { gitguard: { version: "1.0.0", sha256: "a" } } });
      if (url.endsWith("/api/v1/hooks/gitguard/1.0.0")) {
        return new Response(JSON.stringify({ manifest: { name: "gitguard", version: "1.0.0", events: ["PreToolUse"], script: "hook.ts" }, script: "export {}" }), {
          headers: { "content-type": "application/json", "x-hook-sha256": "a" },
        });
      }
      return new Response("nope", { status: 404 });
    });
    const client = createHooksClient({ env, credentials: noKeychain, fetch: f });
    expect(client).toBeInstanceOf(HooksClient);
    expect(client.origin).toBe("https://registry.example.test/hooks");
    expect((await client.catalog())[0]!.name).toBe("gitguard");
    expect((await client.lock()).hooks.gitguard!.version).toBe("1.0.0");
    const artifact = await client.artifact("gitguard", "1.0.0");
    expect(artifact.script).toBe("export {}");
    expect(artifact.sha256).toBe("a");
    expect(calls.map((c) => c.url)).toEqual([
      "https://registry.example.test/hooks/api/v1/catalog",
      "https://registry.example.test/hooks/api/v1/lock",
      "https://registry.example.test/hooks/api/v1/hooks/gitguard/1.0.0",
    ]);
    for (const call of calls) {
      expect((call.init.headers as Record<string, string>)["x-api-key"]).toBe("sdk-test-placeholder-key");
      expect(call.init.redirect).toBe("manual");
    }
    // The key is private state: it never appears on the public surface.
    expect(JSON.stringify(client)).not.toContain("sdk-test-placeholder-key");
  });

  test("401/403 surface as REMOTE_API_CREDENTIAL_INVALID; other failures as REMOTE_API_HTTP_ERROR", async () => {
    const denied = createHooksClient({ env, credentials: noKeychain, fetch: fakeFetch(() => new Response("no", { status: 401 })).fetch });
    await expect(denied.catalog()).rejects.toThrow(/REMOTE_API_CREDENTIAL_INVALID/);
    const broken = createHooksClient({ env, credentials: noKeychain, fetch: fakeFetch(() => new Response("no", { status: 503 })).fetch });
    await expect(broken.lock()).rejects.toThrow(/REMOTE_API_HTTP_ERROR.*503/);
  });
});

describe("the ./sdk bundle is self-contained", () => {
  const outDirs: string[] = [];
  afterEach(() => {
    for (const dir of outDirs.splice(0)) rmSync(dir, { recursive: true, force: true });
  });

  /** The literal `bun build` segment for the SDK from package.json's build script — never a copy. */
  function sdkBuildCommand(): string {
    const segments = (packageJson.scripts.build as string).split("&&").map((s) => s.trim());
    const matches = segments.filter((s) => s.startsWith("bun build ./src/sdk/index.ts "));
    expect(matches).toHaveLength(1);
    expect(matches[0]).toContain("--outdir ./dist/sdk");
    return matches[0]!;
  }

  test("imports node builtins only — no bun:sqlite, no bare package specifiers", () => {
    const outDir = mkdtempSync(join(tmpdir(), "hooks-sdk-bundle-"));
    outDirs.push(outDir);
    const command = sdkBuildCommand().replace("--outdir ./dist/sdk", `--outdir ${JSON.stringify(outDir)}`);
    const built = Bun.spawnSync(["sh", "-c", command], { cwd: root, stdout: "pipe", stderr: "pipe" });
    expect(built.stderr.toString() + built.stdout.toString()).not.toContain("error:");
    expect(built.exitCode).toBe(0);
    const bundle = readFileSync(join(outDir, "index.js"), "utf-8");
    const specifiers = [...bundle.matchAll(/(?:from\s*|import\s*\(\s*|require\s*\(\s*)["']([^"']+)["']/g)].map((m) => m[1]!);
    expect(specifiers.length).toBeGreaterThan(0);
    const builtins = new Set([...builtinModules, ...builtinModules.map((m) => `node:${m}`)]);
    const foreign = specifiers.filter((s) => !builtins.has(s));
    expect(foreign, `non-builtin specifiers in the sdk bundle: ${foreign.join(", ")}`).toEqual([]);
    expect(bundle).not.toContain("bun:sqlite");
  });
});
