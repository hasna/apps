// Harvest BFS and failure behavior, driven by a scripted McpHttpClient.
//
// The harvester talks to the ui.sh MCP over HTTP; these tests never touch the
// network: the fake client is passed in through harvest's `createClient`, so the BFS
// traversal, URI normalization, index writing, and per-URI failure handling are exercised
// deterministically WITHOUT replacing the module for the rest of the test process.
//
// It used to use `mock.module("../src/mcp-client.ts", ...)`, which is process-wide and
// permanent: tests/mcp-client.test.ts then imported the fake instead of the real client and
// failed with "Received length: 0" whenever it ran after this file.

import { afterEach, beforeEach, describe, expect, mock, test } from "bun:test";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

type Script = Record<string, string | Error>;

class FakeMcpClient {
  static script: Script = {};
  static calls: { name: string; uri: string }[] = [];

  constructor(readonly opts: { url: string; token?: string }) {}

  async initialize(): Promise<void> {}
  async listTools(): Promise<{ name: string }[]> {
    return [{ name: "uidotsh_fetch" }];
  }
  async callToolText(name: string, args: { uri: string }): Promise<string> {
    FakeMcpClient.calls.push({ name, uri: args.uri });
    const scripted = FakeMcpClient.script[args.uri];
    if (scripted instanceof Error) throw scripted;
    if (scripted === undefined) throw new Error(`unscripted uri: ${args.uri}`);
    return scripted;
  }
}

import { harvest } from "../src/harvest.ts";

/** Every harvest() in this file gets the scripted client; nothing global is touched. */
const createClient = (opts: { url: string; token?: string }) => new FakeMcpClient(opts);

function callsFor(uri: string): number {
  return FakeMcpClient.calls.filter((c) => c.uri === uri).length;
}

let originalUrl: string | undefined;
let originalToken: string | undefined;

beforeEach(() => {
  originalUrl = process.env.UIDOTSH_MCP_URL;
  originalToken = process.env.UIDOTSH_TOKEN;
  FakeMcpClient.script = {};
  FakeMcpClient.calls = [];
});

afterEach(() => {
  if (originalUrl === undefined) delete process.env.UIDOTSH_MCP_URL;
  else process.env.UIDOTSH_MCP_URL = originalUrl;
  if (originalToken === undefined) delete process.env.UIDOTSH_TOKEN;
  else process.env.UIDOTSH_TOKEN = originalToken;
});

async function withTempDir(fn: (dir: string) => Promise<void>): Promise<void> {
  const dir = await mkdtemp(join(tmpdir(), "hasna-ui-harvest-"));
  try {
    await fn(dir);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
}

describe("harvest BFS traversal", () => {
  test("visits each URI once, stripping punctuation and deduping repeats", async () => {
    await withTempDir(async (dir) => {
      FakeMcpClient.script = {
        "uidotsh://ui": [
          "# UI",
          "",
          "See uidotsh://ui/ideas). and uidotsh://ui/ideas again.",
          "Also uidotsh://ui/componentize.",
        ].join("\n"),
        "uidotsh://ui/ideas": "ideas body, links back: uidotsh://ui/ideas",
        "uidotsh://ui/componentize": "componentize body",
      };

      await harvest({ contentDir: dir, url: "http://mcp.example.invalid", createClient });

      // Every scripted URI visited exactly once — the repeated reference, the
      // punctuation-suffixed reference, and the already-seen back-reference
      // must not cause revisits.
      expect(callsFor("uidotsh://ui")).toBe(1);
      expect(callsFor("uidotsh://ui/ideas")).toBe(1);
      expect(callsFor("uidotsh://ui/componentize")).toBe(1);
      // The punctuated form is never visited as its own URI.
      expect(FakeMcpClient.calls.some((c) => c.uri.includes(")."))).toBe(false);
    });
  });

  test("writes contentDir-relative paths in index.json", async () => {
    await withTempDir(async (dir) => {
      FakeMcpClient.script = {
        "uidotsh://ui": "root body\nsee uidotsh://ui/ideas",
        "uidotsh://ui/ideas": "ideas body",
      };
      await harvest({ contentDir: dir, url: "http://mcp.example.invalid", createClient });
      const index = (await Bun.file(join(dir, "index.json")).json()) as Record<string, string>;
      expect(index).toEqual({
        "uidotsh://ui": "ui.md",
        "uidotsh://ui/ideas": "ui/ideas.md",
      });
      expect(await Bun.file(join(dir, "ui.md")).text()).toBe("root body\nsee uidotsh://ui/ideas");
      expect(await Bun.file(join(dir, "ui/ideas.md")).text()).toBe("ideas body");
    });
  });

  test("continues after a per-URI failure and still writes the index", async () => {
    await withTempDir(async (dir) => {
      FakeMcpClient.script = {
        "uidotsh://ui": "root body\nsee uidotsh://ui/design-guidelines/typography",
        "uidotsh://ui/design-guidelines/typography": new Error("boom: typography fetch failed"),
        "uidotsh://ui/ideas": "ideas body",
      };
      // The root must not reference anything else, so the failing child is the
      // only discovery left to process.
      const warn = mock();
      const originalWarn = console.warn;
      console.warn = warn as typeof console.warn;
      try {
        await harvest({ contentDir: dir, url: "http://mcp.example.invalid", createClient });
      } finally {
        console.warn = originalWarn;
      }

      expect(warn.mock.calls.length).toBeGreaterThan(0);
      // The failed resource is counted nowhere and did not abort the run.
      const index = (await Bun.file(join(dir, "index.json")).json()) as Record<string, string>;
      expect(index["uidotsh://ui/design-guidelines/typography"]).toBeUndefined();
      expect(index["uidotsh://ui"]).toBe("ui.md");
      expect(await Bun.file(join(dir, "ui.md")).exists()).toBe(true);
    });
  });

  test("missing URL throws UIDOTSH_MCP_URL not set", async () => {
    await withTempDir(async (dir) => {
      delete process.env.UIDOTSH_MCP_URL;
      delete process.env.UIDOTSH_TOKEN;
      await expect(harvest({ contentDir: dir, createClient })).rejects.toThrow("UIDOTSH_MCP_URL not set");
    });
  });

  test("explicit url and token reach the client (positive control)", async () => {
    await withTempDir(async (dir) => {
      FakeMcpClient.script = {
        "uidotsh://ui": "root body",
      };
      await harvest({ contentDir: dir, url: "http://mcp.example.invalid", token: "tok", createClient });
      expect(FakeMcpClient.calls.length).toBe(1);
      const index = (await Bun.file(join(dir, "index.json")).json()) as Record<string, string>;
      expect(index["uidotsh://ui"]).toBe("ui.md");
    });
  });
});
