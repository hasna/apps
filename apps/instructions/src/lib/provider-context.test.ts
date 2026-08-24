import { describe, expect, test } from "bun:test";
import { existsSync, mkdtempSync, readFileSync, readdirSync, realpathSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  matchProviderEndpoint,
  normalizeEndpointOrigin,
  PROVIDER_CONTEXT_DIR,
  PROVIDER_CONTEXT_INVARIANT_ID,
  providerContextAuditLine,
  renderProviderFragment,
  resolveAndRenderProviderContext,
} from "./provider-context";

function tempHome(): string {
  return realpathSync(mkdtempSync(join(realpathSync(tmpdir()), "provider-context-test-")));
}

describe("normalizeEndpointOrigin", () => {
  test("strips scheme, lowercases host, keeps path prefix", () => {
    expect(normalizeEndpointOrigin("https://api.deepseek.com/anthropic")).toEqual({
      host: "api.deepseek.com",
      pathPrefix: "/anthropic",
    });
    expect(normalizeEndpointOrigin("HTTPS://openrouter.ai/api")).toEqual({
      host: "openrouter.ai",
      pathPrefix: "/api",
    });
    expect(normalizeEndpointOrigin("https://openrouter.ai/api/v1/messages")).toEqual({
      host: "openrouter.ai",
      pathPrefix: "/api/v1/messages",
    });
  });

  test("strips trailing slash and treats bare host as empty prefix", () => {
    expect(normalizeEndpointOrigin("https://api.anthropic.com/")).toEqual({
      host: "api.anthropic.com",
      pathPrefix: "",
    });
    expect(normalizeEndpointOrigin("openrouter.ai")).toEqual({
      host: "openrouter.ai",
      pathPrefix: "",
    });
  });

  test("rejects embedded credentials", () => {
    expect(normalizeEndpointOrigin("https://user:pass@openrouter.ai/api")).toBeNull();
  });

  test("rejects empty and garbage input", () => {
    expect(normalizeEndpointOrigin("")).toBeNull();
    expect(normalizeEndpointOrigin("   ")).toBeNull();
    expect(normalizeEndpointOrigin("not a url/slash")).toBeNull();
  });
});

describe("matchProviderEndpoint (positive controls per registered endpoint)", () => {
  const cases: Array<[string, string]> = [
    ["https://api.deepseek.com/anthropic", "deepseek-anthropic"],
    ["https://openrouter.ai/api", "openrouter-cc"],
    ["https://openrouter.ai/api/v1", "openrouter-codex"],
    ["https://api.anthropic.com", "anthropic-native"],
  ];
  for (const [endpoint, expectedKey] of cases) {
    test(`${endpoint} -> ${expectedKey}`, () => {
      const origin = normalizeEndpointOrigin(endpoint);
      const entry = matchProviderEndpoint(origin);
      expect(entry?.key).toBe(expectedKey);
    });
  }

  test("deepseek with trailing slash still matches", () => {
    const origin = normalizeEndpointOrigin("https://api.deepseek.com/anthropic/");
    expect(matchProviderEndpoint(origin)?.key).toBe("deepseek-anthropic");
  });

  test("empty prefix entry matches native even with a stray path", () => {
    const origin = normalizeEndpointOrigin("https://api.anthropic.com/v1");
    expect(matchProviderEndpoint(origin)?.key).toBe("anthropic-native");
  });
});

describe("matchProviderEndpoint (negative control: unknown endpoint)", () => {
  test("unknown host returns null", () => {
    const origin = normalizeEndpointOrigin("https://llm.example-corp.internal/v1");
    expect(matchProviderEndpoint(origin)).toBeNull();
  });
});

describe("renderProviderFragment", () => {
  test("invariant fragment warns about unknown and forbids native-provider assumptions", () => {
    const content = renderProviderFragment(null);
    expect(content).toContain("Harness identity is NOT model identity");
    expect(content).toMatch(/say so\s+explicitly/);
    expect(content).not.toMatch(/claude-[a-z-]+\s+is\s+available/i);
  });

  test("deepseek fragment explicitly denies claude-* ids", () => {
    const origin = normalizeEndpointOrigin("https://api.deepseek.com/anthropic");
    const content = renderProviderFragment(matchProviderEndpoint(origin));
    expect(content).toContain("claude-* model ids are NOT served here");
    expect(content).toContain("read the env/config");
  });

  test("no fragment claims to BE a hardcoded specific model id", () => {
    // Examples and catalog mentions are allowed; asserting a single id as the active
    // model is not. The deepseek fragment must not say the active model *is* a fixed id,
    // and nothing may claim an id is verified-available on faith.
    const deepseek = renderProviderFragment(matchProviderEndpoint(normalizeEndpointOrigin("https://api.deepseek.com/anthropic")));
    expect(deepseek).not.toMatch(/active model (is|is set to)\s+deepseek-v[0-9]+/i);
    expect(() => renderProviderFragment(null)).not.toThrow();
  });
});

describe("resolveAndRenderProviderContext", () => {
  test("writes per-endpoint fragment + manifest with sha256 for a known endpoint", () => {
    const home = tempHome();
    const homeDir = join(home, "home");
    const res = resolveAndRenderProviderContext({
      origin: normalizeEndpointOrigin("https://api.deepseek.com/anthropic"),
      rawEndpoint: "https://api.deepseek.com/anthropic",
      rawModel: "deepseek-v4-flash[1m]",
      homeDir,
    });
    expect(res.entry?.key).toBe("deepseek-anthropic");
    expect(res.endpointKey).toBe("deepseek-anthropic");
    expect(res.fragmentPath).toBe(join(homeDir, PROVIDER_CONTEXT_DIR, "deepseek-anthropic.md"));
    expect(existsSync(res.fragmentPath!)).toBe(true);
    expect(res.fragmentSha256).toMatch(/^[0-9a-f]{64}$/);

    const manifest = JSON.parse(readFileSync(join(homeDir, PROVIDER_CONTEXT_DIR, "manifest.json"), "utf8"));
    expect(manifest.schema).toBe("hasna.instructions.provider-context/v1");
    expect(manifest.fragments["deepseek-anthropic"].sha256).toBe(res.fragmentSha256);
    expect(manifest.fragments["deepseek-anthropic"].provider).toContain("DeepSeek");
    rmSync(home, { recursive: true, force: true });
  });

  test("unknown endpoint renders the invariant fragment and reports a reason", () => {
    const home = tempHome();
    const homeDir = join(home, "home");
    const res = resolveAndRenderProviderContext({
      origin: normalizeEndpointOrigin("https://llm.example-corp.internal/v1"),
      rawEndpoint: "https://llm.example-corp.internal/v1",
      rawModel: "some-model",
      homeDir,
    });
    expect(res.entry).toBeNull();
    expect(res.endpointKey).toBe(PROVIDER_CONTEXT_INVARIANT_ID);
    expect(res.reason).toContain("not in the provider-context registry");
    expect(existsSync(join(homeDir, PROVIDER_CONTEXT_DIR, "invariant.md"))).toBe(true);
    expect(res.fragmentSha256).toMatch(/^[0-9a-f]{64}$/);
    rmSync(home, { recursive: true, force: true });
  });

  test("unknown endpoint rejects embedded credentials: reason is a fixed marker, manifest rawEndpoint is null", () => {
    const home = tempHome();
    const homeDir = join(home, "home");
    const credentialed = "https://user:sk-FAKE0000notarealkey@openrouter.ai/api";
    const res = resolveAndRenderProviderContext({
      origin: normalizeEndpointOrigin(credentialed),
      rawEndpoint: credentialed,
      rawModel: "m",
      homeDir,
    });
    // origin rejected => no registry entry
    expect(res.entry).toBeNull();
    expect(res.endpointKey).toBe(PROVIDER_CONTEXT_INVARIANT_ID);
    // reason must NOT echo the raw endpoint (no userinfo, no credential value)
    expect(res.reason).not.toContain("sk-FAKE0000notarealkey");
    expect(res.reason).not.toContain("user:");
    expect(res.reason).toContain("embedded credentials");
    // manifest must NOT persist the raw endpoint value
    const manifest = JSON.parse(readFileSync(join(homeDir, PROVIDER_CONTEXT_DIR, "manifest.json"), "utf8"));
    expect(manifest.fragments["invariant"].rawEndpoint).toBeNull();
    rmSync(home, { recursive: true, force: true });
  });

  test("query-string and fragment credentials are rejected and never echoed (unknown host)", () => {
    const home = tempHome();
    const homeDir = join(home, "home");
    for (const credentialed of [
      "https://llm.example.com/v1?api_key=sk-QUERYSECRET123",
      "https://llm.example.com/v1#access_token=sk-FRAGMENT456",
    ]) {
      const res = resolveAndRenderProviderContext({
        origin: normalizeEndpointOrigin(credentialed),
        rawEndpoint: credentialed,
        rawModel: "m",
        homeDir,
      });
      expect(res.entry).toBeNull();
      expect(res.endpointKey).toBe(PROVIDER_CONTEXT_INVARIANT_ID);
      expect(res.reason).not.toContain("sk-QUERYSECRET123");
      expect(res.reason).not.toContain("sk-FRAGMENT456");
      expect(res.reason).toContain("embedded credentials");
      const manifest = JSON.parse(readFileSync(join(homeDir, PROVIDER_CONTEXT_DIR, "manifest.json"), "utf8"));
      expect(manifest.fragments["invariant"].rawEndpoint).toBeNull();
    }
    rmSync(home, { recursive: true, force: true });
  });

  test("query-string credentials on a KNOWN host are rejected, manifest clean", () => {
    const home = tempHome();
    const homeDir = join(home, "home");
    const credentialed = "https://openrouter.ai/api?api_key=sk-KNOWNSECRET456";
    const res = resolveAndRenderProviderContext({
      origin: normalizeEndpointOrigin(credentialed),
      rawEndpoint: credentialed,
      rawModel: "",
      homeDir,
    });
    expect(res.entry).toBeNull(); // rejected before registry match
    expect(res.reason).not.toContain("sk-KNOWNSECRET456");
    const manifest = JSON.parse(readFileSync(join(homeDir, PROVIDER_CONTEXT_DIR, "manifest.json"), "utf8"));
    expect(manifest.fragments["invariant"].rawEndpoint).toBeNull();
    expect(readFileSync(join(homeDir, PROVIDER_CONTEXT_DIR, "invariant.md"), "utf8")).not.toContain("sk-KNOWNSECRET456");
    rmSync(home, { recursive: true, force: true });
  });

  test("recorded endpoint in manifest is normalized host+path only (safe unmatched endpoint)", () => {
    const home = tempHome();
    const homeDir = join(home, "home");
    const res = resolveAndRenderProviderContext({
      origin: normalizeEndpointOrigin("https://llm.example-corp.internal/v1/messages"),
      rawEndpoint: "https://llm.example-corp.internal/v1/messages",
      rawModel: "",
      homeDir,
    });
    expect(res.reason).toContain("llm.example-corp.internal/v1/messages");
    const manifest = JSON.parse(readFileSync(join(homeDir, PROVIDER_CONTEXT_DIR, "manifest.json"), "utf8"));
    expect(manifest.fragments["invariant"].rawEndpoint).toBe("llm.example-corp.internal/v1/messages");
    expect(manifest.fragments["invariant"].rawEndpoint).not.toMatch(/^https:/);
    expect(manifest.fragments["invariant"].rawEndpoint).not.toContain("://");
    rmSync(home, { recursive: true, force: true });
  });

  test("audit line carries key, fragment, sha256, model — no secrets", () => {
    const res: Parameters<typeof providerContextAuditLine>[0] = {
      entry: null,
      rawEndpoint: "https://api.deepseek.com/anthropic",
      rawModel: "deepseek-v4-flash[1m]",
      endpointKey: "deepseek-anthropic",
      fragmentPath: "/home/user/.hasna/provider-context/deepseek-anthropic.md",
      fragmentSha256: "a".repeat(64),
      reason: null,
    };
    const line = providerContextAuditLine(res, "2026-08-24T00:00:00Z");
    expect(line).toContain("endpoint_key=deepseek-anthropic");
    expect(line).toContain("sha256=" + "a".repeat(64));
    expect(line).toContain("model=deepseek-v4-flash[1m]");
    expect(line).not.toMatch(/(sk-|api[_-]?key|token|secret)/i);
  });

  test("rendered home contains only the touched fragment + manifest", () => {
    const home = tempHome();
    const homeDir = join(home, "home");
    resolveAndRenderProviderContext({
      origin: normalizeEndpointOrigin("https://openrouter.ai/api"),
      rawEndpoint: "https://openrouter.ai/api",
      rawModel: "",
      homeDir,
    });
    const dir = readdirSync(join(homeDir, PROVIDER_CONTEXT_DIR)).sort();
    expect(dir).toEqual(["manifest.json", "openrouter-cc.md"]);
    rmSync(home, { recursive: true, force: true });
  });
});
