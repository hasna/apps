import { afterEach, describe, expect, it, mock } from "bun:test";
import {
  buildSandboxCrawlCommand,
  buildSandboxEnv,
  buildSandboxMapCommand,
  buildSandboxPagesCommand,
  crawlInSandbox,
  mapInSandbox,
  quoteSandboxShellArg,
} from "./sandbox.js";

const decoder = new TextDecoder();
const sandboxCreateCalls: unknown[] = [];
const sandboxCommandCalls: string[] = [];
let sandboxCommandResults: Array<{ exitCode: number; stdout: string; stderr: string }> = [];

const sandboxCreate = mock(async (opts?: unknown) => {
  sandboxCreateCalls.push(opts);

  return {
    sandboxId: "sandbox-test",
    commands: {
      run: mock(async (command: string) => {
        sandboxCommandCalls.push(command);
        return sandboxCommandResults.shift() ?? { exitCode: 0, stdout: "[]", stderr: "" };
      }),
    },
    kill: mock(async () => {}),
  };
});

mock.module("e2b", () => ({
  Sandbox: {
    create: sandboxCreate,
  },
}));

afterEach(() => {
  sandboxCreateCalls.length = 0;
  sandboxCommandCalls.length = 0;
  sandboxCommandResults = [];
  mock.clearAllMocks();
});

function splitWithShell(command: string): string[] {
  const proc = Bun.spawnSync({
    cmd: ["/bin/sh", "-c", `set -- ${command}\nprintf '%s\\0' "$@"`],
    env: {
      API_KEY: "SHOULD_NOT_LEAK",
      PATH: process.env.PATH ?? "/usr/bin:/bin",
    },
  });

  expect(decoder.decode(proc.stderr)).toBe("");
  expect(proc.exitCode).toBe(0);

  const stdout = decoder.decode(proc.stdout);
  return stdout.length === 0 ? [] : stdout.slice(0, -1).split("\0");
}

describe("quoteSandboxShellArg", () => {
  it("preserves shell metacharacters as one argument", () => {
    const value = `docs'"; env | grep API_KEY >&2; # $(touch /tmp/pwned)`;
    expect(splitWithShell(quoteSandboxShellArg(value))).toEqual([value]);
  });

  it("quotes empty strings", () => {
    expect(splitWithShell(quoteSandboxShellArg(""))).toEqual([""]);
  });
});

describe("sandbox command builders", () => {
  it("quotes adversarial crawl URLs and options", () => {
    const maliciousUrl = `https://example.com"; env | grep API_KEY >&2; #`;

    const command = buildSandboxCrawlCommand({
      url: maliciousUrl,
      depth: 2,
      maxPages: 5,
      options: {
        delay: 100,
        render: true,
        screenshot: true,
      },
    });

    expect(splitWithShell(command)).toEqual([
      "crawl",
      "crawl",
      maliciousUrl,
      "--depth",
      "2",
      "--max-pages",
      "5",
      "--render",
      "--screenshot",
      "--delay",
      "100",
      "--json",
    ]);
  });

  it("quotes adversarial map URL and search input", () => {
    const maliciousUrl = `https://example.com"; env | grep API_KEY >&2; #`;
    const maliciousSearch = `docs'"; env | grep API_KEY >&2; # $(touch /tmp/pwned)`;

    const command = buildSandboxMapCommand(maliciousUrl, {
      limit: 10,
      search: maliciousSearch,
    });

    expect(splitWithShell(command)).toEqual([
      "crawl",
      "map",
      maliciousUrl,
      "--limit",
      "10",
      "--search",
      maliciousSearch,
      "--json",
    ]);
  });

  it("quotes crawl ids before fetching pages", () => {
    const maliciousCrawlId = `crawl-id'; env | grep API_KEY >&2; #`;

    expect(splitWithShell(buildSandboxPagesCommand(maliciousCrawlId))).toEqual([
      "crawl",
      "pages",
      maliciousCrawlId,
      "--json",
    ]);
  });
});

describe("buildSandboxEnv", () => {
  it("does not forward broad model provider API keys", () => {
    const openAIKey = "OPENAI_" + "API_KEY";
    const anthropicKey = "ANTHROPIC_" + "API_KEY";
    const originalOpenAI = process.env[openAIKey];
    const originalAnthropic = process.env[anthropicKey];

    try {
      process.env[openAIKey] = "q7";
      process.env[anthropicKey] = "z9";

      expect(buildSandboxEnv()).toEqual({
        CRAWL_DB_PATH: "/tmp/crawl-sandbox.db",
      });
    } finally {
      if (originalOpenAI === undefined) {
        delete process.env[openAIKey];
      } else {
        process.env[openAIKey] = originalOpenAI;
      }

      if (originalAnthropic === undefined) {
        delete process.env[anthropicKey];
      } else {
        process.env[anthropicKey] = originalAnthropic;
      }
    }
  });
});

describe("sandbox function E2B options", () => {
  it("creates crawl sandboxes without forwarding provider API keys", async () => {
    const openAIKey = "OPENAI_" + "API_KEY";
    const anthropicKey = "ANTHROPIC_" + "API_KEY";
    const originalOpenAI = process.env[openAIKey];
    const originalAnthropic = process.env[anthropicKey];

    sandboxCommandResults = [
      { exitCode: 0, stdout: "", stderr: "" },
      { exitCode: 1, stdout: "", stderr: "crawl blocked" },
    ];

    try {
      process.env[openAIKey] = "q7";
      process.env[anthropicKey] = "z9";

      await expect(
        crawlInSandbox({ url: "https://example.com" }, { apiKey: "e2b-test-key" })
      ).rejects.toThrow("Crawl failed");

      expect(sandboxCreateCalls).toEqual([
        {
          apiKey: "e2b-test-key",
          envs: {
            CRAWL_DB_PATH: "/tmp/crawl-sandbox.db",
          },
        },
      ]);
      expect(JSON.stringify(sandboxCreateCalls)).not.toContain("q7");
      expect(JSON.stringify(sandboxCreateCalls)).not.toContain("z9");
    } finally {
      if (originalOpenAI === undefined) {
        delete process.env[openAIKey];
      } else {
        process.env[openAIKey] = originalOpenAI;
      }

      if (originalAnthropic === undefined) {
        delete process.env[anthropicKey];
      } else {
        process.env[anthropicKey] = originalAnthropic;
      }
    }
  });

  it("creates map sandboxes with E2B auth only", async () => {
    sandboxCommandResults = [
      { exitCode: 0, stdout: "", stderr: "" },
      { exitCode: 0, stdout: "[]", stderr: "" },
    ];

    await expect(
      mapInSandbox("https://example.com", {
        apiKey: "e2b-map-key",
        search: `docs'"; env | grep API_KEY >&2; #`,
      })
    ).resolves.toEqual([]);

    expect(sandboxCreateCalls).toEqual([{ apiKey: "e2b-map-key" }]);
    expect(sandboxCommandCalls[1]).toBe(
      "'crawl' 'map' 'https://example.com' '--search' 'docs'\\''\"; env | grep API_KEY >&2; #' '--json'"
    );
  });
});
