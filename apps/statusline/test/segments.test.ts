import { describe, expect, test, beforeAll } from "bun:test";
import { writeFileSync } from "node:fs";
import { hostname } from "node:os";
import { getSegment, segments } from "../src/segments";
import { parseClaudeInput } from "../src/providers/claude";
import type { StatusContext } from "../src/providers/types";
import fixture from "./fixtures/claude-input.json";

const TRANSCRIPT = "/tmp/statusline-test-transcript.jsonl";

function ctx(overrides: Record<string, unknown> = {}): StatusContext {
  return parseClaudeInput({ ...fixture, ...overrides });
}

beforeAll(() => {
  const lines = [
    JSON.stringify({ type: "user", message: { role: "user", content: "hi" } }),
    JSON.stringify({
      type: "assistant",
      message: {
        role: "assistant",
        usage: {
          input_tokens: 1000,
          cache_creation_input_tokens: 4000,
          cache_read_input_tokens: 95000,
          output_tokens: 2000,
        },
      },
    }),
  ];
  writeFileSync(TRANSCRIPT, lines.join("\n") + "\n");
});

describe("registry", () => {
  test("ids are unique", () => {
    const ids = segments.map((s) => s.id);
    expect(new Set(ids).size).toBe(ids.length);
  });
  test("every segment has a description", () => {
    for (const s of segments) expect(s.description.length).toBeGreaterThan(0);
  });
  test("machine segment exists", () => {
    expect(getSegment("machine")).toBeDefined();
  });
});

describe("machine", () => {
  test("renders short hostname", async () => {
    const out = await getSegment("machine")!.render(ctx());
    expect(out).toBe(hostname().split(".")[0]);
  });
});

describe("model", () => {
  test("model-context keeps context tag", async () => {
    const out = await getSegment("model-context")!.render(ctx());
    expect(out).toBe("fable 5 [1m]");
  });
  test("model drops context tag", async () => {
    const out = await getSegment("model")!.render(ctx());
    expect(out).toBe("fable 5");
  });
  test("falls back to friendly id formatting", async () => {
    const out = await getSegment("model")!.render(
      ctx({ model: { id: "claude-opus-4-8", display_name: "" } }),
    );
    expect(out).toBe("opus 4.8");
  });
  test("null when no model", async () => {
    const out = await getSegment("model")!.render(ctx({ model: undefined }));
    expect(out).toBeNull();
  });
});

describe("git segments", () => {
  // the repo under test is itself a git repo
  test("project renders name", async () => {
    const out = await getSegment("project")!.render(ctx());
    expect(out).toMatch(/^(open-)?statusline( \(.+\))?$/);
  });
  test("git-branch renders branch", async () => {
    const out = await getSegment("git-branch")!.render(ctx());
    expect(out).toBe("main");
  });
  test("commit-age null on repo without commits or non-repo", async () => {
    const out = await getSegment("commit-age")!.render(ctx({ cwd: "/tmp", workspace: { current_dir: "/tmp" } }));
    expect(out).toBeNull();
  });
  test("project falls back to dir basename outside git", async () => {
    const out = await getSegment("project")!.render(ctx({ cwd: "/tmp", workspace: { current_dir: "/tmp" } }));
    expect(out).toBe("tmp");
  });
});

describe("session segments", () => {
  test("cost formats with commas", async () => {
    expect(await getSegment("cost")!.render(ctx())).toBe("$1,234.50");
  });
  test("cost null when zero", async () => {
    expect(await getSegment("cost")!.render(ctx({ cost: { total_cost_usd: 0 } }))).toBeNull();
  });
  test("duration", async () => {
    expect(await getSegment("duration")!.render(ctx())).toBe("1h30m");
  });
  test("lines-changed", async () => {
    expect(await getSegment("lines-changed")!.render(ctx())).toBe("+142/-18");
  });
  test("current-dir", async () => {
    expect(await getSegment("current-dir")!.render(ctx())).toBe("open-statusline");
  });
  test("claude-version", async () => {
    expect(await getSegment("agent-version")!.render(ctx())).toBe("v2.1.39");
  });
  test("output-style omitted when default", async () => {
    expect(await getSegment("output-style")!.render(ctx())).toBeNull();
  });
  test("session-id is short", async () => {
    expect(await getSegment("session-id")!.render(ctx())).toBe("abc12345");
  });
});

describe("context segments", () => {
  test("context-used reads transcript against 1m window", async () => {
    // used = 1000 + 4000 + 95000 = 100000 of 1,000,000 → 10%
    expect(await getSegment("context-used")!.render(ctx())).toBe("10%");
  });
  test("context-remaining is complement", async () => {
    expect(await getSegment("context-remaining")!.render(ctx())).toBe("90% left");
  });
  test("200k window without [1m] tag", async () => {
    // 100000 of 200,000 → 50%
    const c = ctx({ model: { id: "claude-fable-5", display_name: "Fable" } });
    expect(await getSegment("context-used")!.render(c)).toBe("50%");
  });
  test("used-tokens compact", async () => {
    // 100000 input-side + 2000 output = 102000 → 102k
    expect(await getSegment("used-tokens")!.render(ctx())).toBe("102k tok");
  });
  test("null when transcript missing", async () => {
    const c = ctx({ transcript_path: "/tmp/does-not-exist-xyz.jsonl" });
    expect(await getSegment("context-used")!.render(c)).toBeNull();
  });
});
