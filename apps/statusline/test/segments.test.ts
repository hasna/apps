import { describe, expect, test, beforeAll, afterAll } from "bun:test";
import { chmodSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { hostname } from "node:os";
import { contextUsage } from "../src/context-window";
import { gitProjectName, lastCommitEpoch, trackedLineCount } from "../src/git";
import { renderLine } from "../src/render";
import { getSegment, segments } from "../src/segments";
import { sessionFastMode } from "../src/settings";
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
  test("git-branch renders branch when available", async () => {
    const out = await getSegment("git-branch")!.render(ctx({ cwd: process.cwd(), workspace: { current_dir: process.cwd() } }));
    if (out !== null) {
      expect(typeof out).toBe("string");
      expect(out.length).toBeGreaterThan(0);
    }
  });
  test("commit-age null on repo without commits or non-repo", async () => {
    const out = await getSegment("commit-age")!.render(ctx({ cwd: "/tmp", workspace: { current_dir: "/tmp" } }));
    expect(out).toBeNull();
  });
  test("project falls back to dir basename outside git", async () => {
    const out = await getSegment("project")!.render(ctx({ cwd: "/tmp", workspace: { current_dir: "/tmp" } }));
    expect(out).toBe("tmp");
  });
  test("commit-age renders compact age in git repo", async () => {
    const out = await getSegment("commit-age")!.render(ctx({ cwd: process.cwd(), workspace: { current_dir: process.cwd() } }));
    expect(out).toMatch(/^\d+[smhdw](\d+[smhdw])?$/);
  });
  test("loc renders tracked line count in git repo", async () => {
    const out = await getSegment("loc")!.render(ctx({ cwd: process.cwd(), workspace: { current_dir: process.cwd() } }));
    expect(out).toMatch(/^\d+(\.\d+)?[kKmM]?$/);
    expect(out!.length).toBeGreaterThan(0);
  });
  test("project-name uses git remote when available", async () => {
    const name = gitProjectName(process.cwd());
    if (name) {
      const out = await getSegment("project-name")!.render(ctx({ cwd: process.cwd() }));
      expect(out).toBe(name);
    }
  });
});

describe("git helpers", () => {
  test("trackedLineCount is null outside a git repo", () => {
    expect(trackedLineCount("/tmp")).toBeNull();
  });

  test("trackedLineCount returns positive count in git repo", () => {
    const count = trackedLineCount(process.cwd());
    expect(count).not.toBeNull();
    expect(count!).toBeGreaterThan(0);
  });

  test("lastCommitEpoch returns epoch in git repo", () => {
    const ts = lastCommitEpoch(process.cwd());
    expect(ts).not.toBeNull();
    expect(Number.isFinite(ts)).toBe(true);
  });

  test("lastCommitEpoch returns null for non-finite timestamp", () => {
    const original = Bun.spawnSync;
    Bun.spawnSync = ((args: string[], options?: { cwd?: string }) => {
      if (Array.isArray(args) && args.includes("log")) {
        return { exitCode: 0, stdout: Buffer.from("not-a-timestamp\n") } as ReturnType<typeof Bun.spawnSync>;
      }
      return original(args, options as any);
    }) as typeof Bun.spawnSync;
    try {
      expect(lastCommitEpoch(process.cwd())).toBeNull();
    } finally {
      Bun.spawnSync = original;
    }
  });

  test("trackedLineCount returns null when wc pipeline fails", () => {
    const original = Bun.spawnSync;
    Bun.spawnSync = ((args: string[] | string[], options?: { cwd?: string }) => {
      if (Array.isArray(args) && args[0] === "bash") {
        return { exitCode: 1, stdout: Buffer.from("") } as ReturnType<typeof Bun.spawnSync>;
      }
      return original(args as string[], options as any);
    }) as typeof Bun.spawnSync;
    try {
      expect(trackedLineCount(process.cwd())).toBeNull();
    } finally {
      Bun.spawnSync = original;
    }
  });

  test("trackedLineCount returns null when spawn throws", () => {
    const original = Bun.spawnSync;
    Bun.spawnSync = ((args: string[] | string[], options?: { cwd?: string }) => {
      if (Array.isArray(args) && args[0] === "bash") {
        throw new Error("spawn failed");
      }
      return original(args as string[], options as any);
    }) as typeof Bun.spawnSync;
    try {
      expect(trackedLineCount(process.cwd())).toBeNull();
    } finally {
      Bun.spawnSync = original;
    }
  });
});

describe("context-window", () => {
  let unreadablePath: string;

  beforeAll(() => {
    const dir = mkdtempSync(join(tmpdir(), "statusline-ctx-"));
    unreadablePath = join(dir, "locked.jsonl");
    writeFileSync(unreadablePath, '{"type":"assistant","message":{"usage":{"input_tokens":1}}}\n');
    chmodSync(unreadablePath, 0o000);
  });

  afterAll(() => {
    chmodSync(unreadablePath, 0o600);
  });

  test("contextUsage returns null for unreadable transcript", () => {
    expect(contextUsage(ctx({ transcript_path: unreadablePath }))).toBeNull();
  });

  test("contextUsage skips malformed JSONL lines", () => {
    const path = join(tmpdir(), `statusline-bad-jsonl-${Date.now()}.jsonl`);
    const valid = JSON.stringify({
      type: "assistant",
      message: { usage: { input_tokens: 50_000, output_tokens: 1000 } },
    });
    writeFileSync(path, `${valid}\n{"type":"assistant","message":{"usage": broken}\n`);
    const usage = contextUsage(ctx({ transcript_path: path, model: { id: "claude-fable-5[1m]" } }));
    expect(usage).toEqual({ used: 50_000, output: 1000, window: 1_000_000 });
  });

  test("contextUsage returns null when transcript has no usage block", () => {
    const path = join(tmpdir(), `statusline-no-usage-${Date.now()}.jsonl`);
    writeFileSync(path, JSON.stringify({ type: "user", message: { role: "user", content: "hi" } }) + "\n");
    expect(contextUsage(ctx({ transcript_path: path }))).toBeNull();
  });

  test("contextUsage continues past lines missing input_tokens", () => {
    const path = join(tmpdir(), `statusline-partial-usage-${Date.now()}.jsonl`);
    const lines = [
      JSON.stringify({ type: "assistant", message: { usage: { output_tokens: 5 } } }),
      JSON.stringify({
        type: "assistant",
        message: { usage: { input_tokens: 10_000, output_tokens: 500 } },
      }),
    ];
    writeFileSync(path, lines.join("\n") + "\n");
    const usage = contextUsage(ctx({ transcript_path: path }));
    expect(usage?.used).toBe(10_000);
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
    expect(await getSegment("current-dir")!.render(ctx())).toBe("statusline");
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

describe("codewith-mirroring segments", () => {
  test("model-with-reasoning appends the effort level, lowercased", async () => {
    const out = await getSegment("model-with-reasoning")!.render(ctx({ effort: { level: "xhigh" } }));
    expect(out).toBe("fable (xhigh)");
  });
  test("model-with-reasoning falls back to thinking when no effort is reported", async () => {
    const out = await getSegment("model-with-reasoning")!.render(ctx({ thinking: { enabled: true } }));
    expect(out).toBe("fable (thinking)");
  });
  test("model-with-reasoning is bare when neither is reported", async () => {
    expect(await getSegment("model-with-reasoning")!.render(ctx())).toBe("fable");
  });
  test("model-with-reasoning lowercases a capitalized host label and effort", async () => {
    const out = await getSegment("model-with-reasoning")!.render(
      ctx({ model: { id: "claude-fable-5", display_name: "Fable 5" }, effort: { level: "High" } }),
    );
    expect(out).toBe("fable 5 (high)");
  });
  test("model-with-reasoning derives a name from the id when unlabelled", async () => {
    const out = await getSegment("model-with-reasoning")!.render(
      ctx({ model: { id: "claude-opus-4-8" }, effort: { level: "low" } }),
    );
    expect(out).toBe("opus 4.8 (low)");
  });
  test("model-with-reasoning null without a model", async () => {
    expect(await getSegment("model-with-reasoning")!.render(ctx({ model: undefined }))).toBeNull();
  });

  test("five-hour-limit rounds the reported percentage", async () => {
    const out = await getSegment("five-hour-limit")!.render(
      ctx({ rate_limits: { five_hour: { used_percentage: 42.6 } } }),
    );
    expect(out).toBe("5h:43%");
  });
  test("five-hour-limit renders zero rather than dropping it", async () => {
    const out = await getSegment("five-hour-limit")!.render(
      ctx({ rate_limits: { five_hour: { used_percentage: 0 } } }),
    );
    expect(out).toBe("5h:0%");
  });
  test("five-hour-limit null when the host reports no limits", async () => {
    expect(await getSegment("five-hour-limit")!.render(ctx())).toBeNull();
  });
  test("five-hour-limit escalates to red past 80%", () => {
    const color = getSegment("five-hour-limit")!.color as (c: StatusContext) => string;
    expect(color(ctx({ rate_limits: { five_hour: { used_percentage: 81 } } }))).toBe("red");
    expect(color(ctx({ rate_limits: { five_hour: { used_percentage: 12 } } }))).toBe("yellow");
  });

  test("seven-day-limit reads the seven_day window, not a week alias", async () => {
    const out = await getSegment("seven-day-limit")!.render(
      ctx({ rate_limits: { seven_day: { used_percentage: 12.2 } } }),
    );
    expect(out).toBe("7d:12%");
  });
  test("seven-day-limit null when the host reports only the 5h window", async () => {
    const out = await getSegment("seven-day-limit")!.render(
      ctx({ rate_limits: { five_hour: { used_percentage: 30 } } }),
    );
    expect(out).toBeNull();
  });
  test("both limit windows render side by side", async () => {
    const c = ctx({ rate_limits: { five_hour: { used_percentage: 90 }, seven_day: { used_percentage: 40 } } });
    expect(await getSegment("five-hour-limit")!.render(c)).toBe("5h:90%");
    expect(await getSegment("seven-day-limit")!.render(c)).toBe("7d:40%");
  });

  test("thread-title renders the renamed thread", async () => {
    expect(await getSegment("thread-title")!.render(ctx({ session_name: "ship it" }))).toBe("ship it");
  });
  test("thread-title null until the thread is named", async () => {
    expect(await getSegment("thread-title")!.render(ctx())).toBeNull();
  });
});

describe("auth segments", () => {
  const accountsRoot = mkdtempSync(join(tmpdir(), "statusline-seg-accounts-"));
  const profileDir = join(accountsRoot, "profiles", "claude", "account042");
  let saved: Record<string, string | undefined>;

  beforeAll(() => {
    mkdirSync(profileDir, { recursive: true });
    writeFileSync(
      join(accountsRoot, "accounts.json"),
      JSON.stringify({ profiles: [{ name: "account042", tool: "claude", dir: profileDir }] }),
    );
    writeFileSync(
      join(profileDir, ".claude.json"),
      JSON.stringify({ oauthAccount: { emailAddress: "agent@example.com" } }),
    );
    saved = { ACCOUNTS_HOME: process.env.ACCOUNTS_HOME, CLAUDE_CONFIG_DIR: process.env.CLAUDE_CONFIG_DIR };
    process.env.ACCOUNTS_HOME = accountsRoot;
    process.env.CLAUDE_CONFIG_DIR = profileDir;
  });

  afterAll(() => {
    for (const [key, value] of Object.entries(saved)) {
      if (value === undefined) delete process.env[key];
      else process.env[key] = value;
    }
  });

  test("auth-profile names the profile owning this process", async () => {
    expect(await getSegment("auth-profile")!.render(ctx())).toBe("account042");
  });

  test("auth-email reports the logged-in address", async () => {
    expect(await getSegment("auth-email")!.render(ctx())).toBe("agent@example.com");
  });

  test("auth-profile falls back to the email for an unmanaged config dir", async () => {
    const loose = mkdtempSync(join(tmpdir(), "statusline-seg-loose-"));
    writeFileSync(
      join(loose, ".claude.json"),
      JSON.stringify({ oauthAccount: { emailAddress: "loose@example.com" } }),
    );
    process.env.CLAUDE_CONFIG_DIR = loose;
    try {
      expect(await getSegment("auth-profile")!.render(ctx())).toBe("loose@example.com");
    } finally {
      process.env.CLAUDE_CONFIG_DIR = profileDir;
    }
  });

  test("auth-profile null when nothing identifies the config dir", async () => {
    const blank = mkdtempSync(join(tmpdir(), "statusline-seg-blank-"));
    process.env.CLAUDE_CONFIG_DIR = blank;
    try {
      expect(await getSegment("auth-profile")!.render(ctx())).toBeNull();
    } finally {
      process.env.CLAUDE_CONFIG_DIR = profileDir;
    }
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

describe("cache-rate", () => {
  test("default enabled", () => {
    expect(getSegment("cache-rate")!.defaultEnabled).toBe(true);
  });

  test("renders the share served from cache", async () => {
    // shared TRANSCRIPT fixture: read 95000 of 100000 input-side → 95%
    expect(await getSegment("cache-rate")!.render(ctx())).toBe("95% cached");
  });

  test("renders zero when nothing was cached yet (divisor nonzero)", async () => {
    const path = join(tmpdir(), `statusline-zero-cache-${Date.now()}.jsonl`);
    writeFileSync(
      path,
      JSON.stringify({
        type: "assistant",
        message: { usage: { input_tokens: 5000, cache_read_input_tokens: 0, cache_creation_input_tokens: 0 } },
      }) + "\n",
    );
    expect(await getSegment("cache-rate")!.render(ctx({ transcript_path: path }))).toBe("0% cached");
  });

  test("null on an all-zero usage block (divisor 0)", async () => {
    const path = join(tmpdir(), `statusline-zero-usage-${Date.now()}.jsonl`);
    writeFileSync(
      path,
      JSON.stringify({
        type: "assistant",
        message: { usage: { input_tokens: 0, cache_read_input_tokens: 0, cache_creation_input_tokens: 0 } },
      }) + "\n",
    );
    expect(await getSegment("cache-rate")!.render(ctx({ transcript_path: path }))).toBeNull();
  });

  test("null when the transcript has no usage block", async () => {
    const path = join(tmpdir(), `statusline-cache-no-usage-${Date.now()}.jsonl`);
    writeFileSync(path, JSON.stringify({ type: "user", message: { role: "user", content: "hi" } }) + "\n");
    expect(await getSegment("cache-rate")!.render(ctx({ transcript_path: path }))).toBeNull();
  });

  test("null when transcript_path is missing", async () => {
    expect(await getSegment("cache-rate")!.render(ctx({ transcript_path: undefined }))).toBeNull();
  });

  test("null for an unreadable transcript", async () => {
    const dir = mkdtempSync(join(tmpdir(), "statusline-cache-locked-"));
    const path = join(dir, "locked.jsonl");
    writeFileSync(path, '{"type":"assistant","message":{"usage":{"input_tokens":1}}}\n');
    chmodSync(path, 0o000);
    try {
      expect(await getSegment("cache-rate")!.render(ctx({ transcript_path: path }))).toBeNull();
    } finally {
      chmodSync(path, 0o600);
    }
  });

  test("renderLine joins machine and cache-rate", async () => {
    const line = await renderLine(ctx(), {
      separator: " · ",
      segments: ["machine", "cache-rate"],
      colors: false,
    });
    expect(line).toBe(`${hostname().split(".")[0]} · 95% cached`);
  });
});

describe("fast-mode", () => {
  function configDirWith(settings?: unknown): string {
    const dir = mkdtempSync(join(tmpdir(), "statusline-fastmode-"));
    if (settings !== undefined) writeFileSync(join(dir, "settings.json"), JSON.stringify(settings));
    return dir;
  }
  test("on when the session config dir enables fastMode", () => {
    expect(sessionFastMode({ CLAUDE_CONFIG_DIR: configDirWith({ fastMode: true }) })).toBe(true);
  });
  test("off when fastMode is false or absent", () => {
    expect(sessionFastMode({ CLAUDE_CONFIG_DIR: configDirWith({ fastMode: false }) })).toBe(false);
    expect(sessionFastMode({ CLAUDE_CONFIG_DIR: configDirWith({}) })).toBe(false);
  });
  test("off when settings.json is missing or malformed", () => {
    expect(sessionFastMode({ CLAUDE_CONFIG_DIR: configDirWith() })).toBe(false);
    const dir = mkdtempSync(join(tmpdir(), "statusline-fastmode-"));
    writeFileSync(join(dir, "settings.json"), "{not json");
    expect(sessionFastMode({ CLAUDE_CONFIG_DIR: dir })).toBe(false);
  });
  test("segment renders \"fast\" from the process env", async () => {
    const previous = process.env.CLAUDE_CONFIG_DIR;
    process.env.CLAUDE_CONFIG_DIR = configDirWith({ fastMode: true });
    try {
      expect(await getSegment("fast-mode")!.render(ctx())).toBe("fast");
    } finally {
      if (previous === undefined) delete process.env.CLAUDE_CONFIG_DIR;
      else process.env.CLAUDE_CONFIG_DIR = previous;
    }
  });
});

describe("newline segment", () => {
  test("exists for row breaks and renders nothing itself", async () => {
    expect(getSegment("newline")).toBeDefined();
    expect(await getSegment("newline")!.render(ctx())).toBeNull();
  });
});

describe("usage segments (from the local accounts cache)", () => {
  const accountsRoot = mkdtempSync(join(tmpdir(), "statusline-seg-usage-"));
  const profileDir = mkdtempSync(join(tmpdir(), "statusline-seg-usage-cfg-"));
  const uuid = "3ea5952d-28c7-4179-9371-5028123478a4";
  let saved: Record<string, string | undefined>;

  function writeCache(windows: unknown[], fetchedAt = new Date().toISOString()) {
    const dir = join(accountsRoot, "cache", "usage");
    mkdirSync(dir, { recursive: true });
    writeFileSync(
      join(dir, `${uuid}.json`),
      JSON.stringify({ accountUuid: uuid, fetchedAt, usage: { windows, fetchedAt } }),
    );
  }
  function clearCache() {
    rmSync(join(accountsRoot, "cache", "usage", `${uuid}.json`), { force: true });
  }

  beforeAll(() => {
    writeFileSync(
      join(profileDir, ".claude.json"),
      JSON.stringify({ oauthAccount: { emailAddress: "agent@example.com", accountUuid: uuid } }),
    );
    saved = { ACCOUNTS_HOME: process.env.ACCOUNTS_HOME, CLAUDE_CONFIG_DIR: process.env.CLAUDE_CONFIG_DIR };
    process.env.ACCOUNTS_HOME = accountsRoot;
    process.env.CLAUDE_CONFIG_DIR = profileDir;
  });

  afterAll(() => {
    for (const [key, value] of Object.entries(saved)) {
      if (value === undefined) delete process.env[key];
      else process.env[key] = value;
    }
  });

  const fresh = () => new Date(Date.now() + 3 * 60 * 60 * 1000).toISOString();

  test("session segment shows the 5-hour headroom remaining", async () => {
    writeCache([{ id: "session", group: "session", scoped: false, utilization: 13, resetsAt: fresh() }]);
    expect(await getSegment("usage-session")!.render(ctx())).toBe("5h 87%");
  });

  test("weekly segment shows the weekly headroom remaining", async () => {
    writeCache([{ id: "weekly_all", group: "weekly", scoped: false, utilization: 8, resetsAt: fresh() }]);
    expect(await getSegment("usage-weekly")!.render(ctx())).toBe("7d 92%");
  });

  test("both render zero rather than dropping a used-up window", async () => {
    writeCache([
      { id: "session", group: "session", scoped: false, utilization: 100, resetsAt: fresh() },
      { id: "weekly_all", group: "weekly", scoped: false, utilization: 100, resetsAt: fresh() },
    ]);
    expect(await getSegment("usage-session")!.render(ctx())).toBe("5h 0%");
    expect(await getSegment("usage-weekly")!.render(ctx())).toBe("7d 0%");
  });

  test("neutral marker when no usage is cached — never a crash, never a wrong number", async () => {
    clearCache();
    expect(await getSegment("usage-session")!.render(ctx())).toBe("5h —");
    expect(await getSegment("usage-weekly")!.render(ctx())).toBe("7d —");
  });

  test("weekly segment escalates to red as headroom runs low", () => {
    writeCache([{ id: "weekly_all", group: "weekly", scoped: false, utilization: 90, resetsAt: fresh() }]);
    const color = getSegment("usage-weekly")!.color as (c: StatusContext) => string | null;
    expect(color(ctx())).toBe("red");
  });

  test("weekly segment is not red while headroom is healthy", () => {
    writeCache([{ id: "weekly_all", group: "weekly", scoped: false, utilization: 8, resetsAt: fresh() }]);
    const color = getSegment("usage-weekly")!.color as (c: StatusContext) => string | null;
    expect(color(ctx())).not.toBe("red");
  });
});
