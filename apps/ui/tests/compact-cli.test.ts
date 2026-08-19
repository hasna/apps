// Compact events/webhooks CLI + fetch/serve/harvest dispatch, exercised
// through the public `ui` CLI with a temporary event store and synthetic
// mirror. Everything runs against the real binary path (`bun run src/cli.ts`);
// no internals are imported. The commander-registered `events list`/`replay`
// branches are unreachable through `ui` because handleCompactEventsCli claims
// them first — per the Sol advisory they are recorded as dead-path follow-up,
// not faked into reachability.

import { afterEach, describe, expect, test } from "bun:test";
import { EventsClient, JsonEventsStore } from "@hasna/events";
import { mkdtempSync, rmSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { CONTENT_DIR_ENV } from "../src/content.ts";
import { ROOT_BODY, createSyntheticMirror, type SyntheticMirror } from "./helpers/synthetic-mirror.ts";

const originalUrl = process.env.UIDOTSH_MCP_URL;
const originalContentDir = process.env[CONTENT_DIR_ENV];

afterEach(() => {
  if (originalUrl === undefined) delete process.env.UIDOTSH_MCP_URL;
  else process.env.UIDOTSH_MCP_URL = originalUrl;
  if (originalContentDir === undefined) delete process.env[CONTENT_DIR_ENV];
  else process.env[CONTENT_DIR_ENV] = originalContentDir;
});

function runCli(args: string[], env: Record<string, string> = {}): { exitCode: number; stdout: string; stderr: string } {
  const proc = Bun.spawnSync({
    cmd: ["bun", "run", "src/cli.ts", ...args],
    env: { ...process.env, ...env },
    stdout: "pipe",
    stderr: "pipe",
  });
  return { exitCode: proc.exitCode, stdout: proc.stdout.toString(), stderr: proc.stderr.toString() };
}

function withEventDir<T>(fn: (dir: string) => Promise<T>): Promise<T> {
  const dir = mkdtempSync(join(tmpdir(), "ui-cli-events-"));
  return fn(dir).finally(() => rmSync(dir, { recursive: true, force: true }));
}

async function seedEvents(dir: string, count: number): Promise<void> {
  const client = new EventsClient({ store: new JsonEventsStore(dir) });
  for (let i = 0; i < count; i++) {
    await client.emit(
      {
        source: "ui",
        type: `ui.seeded.${i}`,
        message: `message ${i}`,
        data: { index: i },
      },
      { deliver: false },
    );
  }
}

describe("ui CLI dispatch", () => {
  test("fetch with a single uri returns the raw document", async () => {
    const mirror: SyntheticMirror = await createSyntheticMirror(45);
    try {
      const proc = runCli(["fetch", "uidotsh://ui"], { [CONTENT_DIR_ENV]: mirror.dir });
      expect(proc.exitCode).toBe(0);
      expect(proc.stdout.trimEnd()).toBe(ROOT_BODY);
      expect(proc.stdout).not.toContain("# Batch Fetch");
    } finally {
      await rmSync(mirror.dir, { recursive: true, force: true });
    }
  });

  test("fetch with multiple uris returns the batch shape", async () => {
    const mirror: SyntheticMirror = await createSyntheticMirror(45);
    try {
      const proc = runCli(["fetch", "uidotsh://ui/ideas", "uidotsh://ui/componentize"], {
        [CONTENT_DIR_ENV]: mirror.dir,
      });
      expect(proc.exitCode).toBe(0);
      expect(proc.stdout).toContain("# Batch Fetch");
      expect(proc.stdout).toContain("## uidotsh://ui/ideas");
      expect(proc.stdout).toContain("## uidotsh://ui/componentize");
    } finally {
      await rmSync(mirror.dir, { recursive: true, force: true });
    }
  });

  test("serve dispatches a running server on the requested port", async () => {
    const proc = Bun.spawn({
      cmd: ["bun", "run", "src/cli.ts", "serve", "0"],
      stdout: "pipe",
      stderr: "pipe",
    });
    try {
      const port = await Promise.race([
        (async () => {
          const reader = proc.stdout.getReader();
          const decoder = new TextDecoder();
          let buf = "";
          for (;;) {
            const { done, value } = await reader.read();
            if (done) throw new Error("serve exited before announcing a port");
            buf += decoder.decode(value);
            const m = buf.match(/serving on http:\/\/0\.0\.0\.0:(\d+)/);
            if (m) return Number(m[1]);
          }
        })(),
        new Promise<never>((_, reject) => setTimeout(() => reject(new Error("serve did not announce a port in time")), 15_000)),
      ]);
      const res = await fetch(`http://127.0.0.1:${port}/health`);
      expect(res.status).toBe(200);
      expect(await res.text()).toBe("ok");
    } finally {
      proc.kill();
      await proc.exited;
    }
  });

  test("harvest dispatches and fails fast without a URL", async () => {
    delete process.env.UIDOTSH_MCP_URL;
    delete process.env.UIDOTSH_TOKEN;
    const proc = runCli(["harvest"]);
    expect(proc.exitCode).toBe(1);
    expect(proc.stderr).toContain("UIDOTSH_MCP_URL not set");
  });

  test("no command exits 0 with usage; unknown command exits 1", () => {
    const bare = runCli([]);
    expect(bare.exitCode).toBe(0);
    expect(bare.stderr).toContain("commands: fetch");

    const unknown = runCli(["bogus"]);
    expect(unknown.exitCode).toBe(1);
  });
});

describe("events list formatting", () => {
  test("truncate collapses whitespace and applies exact max/ellipsis boundaries", async () => {
    await withEventDir(async (dir) => {
      const client = new EventsClient({ store: new JsonEventsStore(dir) });
      await client.emit(
        { source: "ui", type: "ui.ws", message: "line1\n\n  line2\t tab", data: {} },
        { deliver: false },
      );
      await client.emit({ source: "ui", type: "ui.exact", message: "a".repeat(48), data: {} }, { deliver: false });
      await client.emit({ source: "ui", type: "ui.over", message: "a".repeat(49), data: {} }, { deliver: false });
      await client.emit({ source: "ui", type: "ui.subj", subject: "b".repeat(25), message: "x", data: {} }, { deliver: false });

      const env = { HASNA_EVENTS_DIR: dir };
      const verbose = runCli(["events", "list", "--limit", "10", "--verbose"], env);
      expect(verbose.exitCode).toBe(0);
      // Whitespace collapsed inside the message column.
      expect(verbose.stdout).toContain("line1 line2 tab");
      expect(verbose.stdout).not.toContain("line1\n");
      // Exactly-max content stays un-ellipsized.
      expect(verbose.stdout).toContain("a".repeat(48));
      // One over the max is truncated with an ellipsis.
      expect(verbose.stdout).not.toContain("a".repeat(49));
      expect(verbose.stdout).toContain(`${"a".repeat(47)}…`);
      // Subject truncation boundary (24).
      expect(verbose.stdout).not.toContain("b".repeat(25));
      expect(verbose.stdout).toContain(`${"b".repeat(23)}…`);
    });
  });

  test("shortId keeps ids of width 8 and truncates longer ids", async () => {
    await withEventDir(async (dir) => {
      const client = new EventsClient({ store: new JsonEventsStore(dir) });
      const short = await client.emit({ id: "12345678", source: "ui", type: "ui.short", data: {} }, { deliver: false });
      const long = await client.emit({ id: "123456789", source: "ui", type: "ui.long", data: {} }, { deliver: false });
      const uuid = await client.emit({ source: "ui", type: "ui.uuid", data: {} }, { deliver: false });

      const env = { HASNA_EVENTS_DIR: dir };
      const verbose = runCli(["events", "list", "--limit", "10", "--verbose"], env);
      expect(verbose.exitCode).toBe(0);
      expect(verbose.stdout).toContain("12345678");
      // The 9-char id is truncated to 8.
      expect(verbose.stdout).not.toContain("123456789");
      // The uuid is truncated to its first 8 chars in compact rows…
      expect(verbose.stdout).not.toContain(uuid.event.id);
      expect(verbose.stdout).toContain(uuid.event.id.slice(0, 8));
      // …while the json surface keeps the full ids.
      const json = runCli(["events", "list", "--json"], env);
      expect(json.stdout).toContain(short.event.id);
      expect(json.stdout).toContain(long.event.id);
      expect(json.stdout).toContain(uuid.event.id);
    });
  });

  test("clampLimit floors at 1 and caps at 200", async () => {
    await withEventDir(async (dir) => {
      await seedEvents(dir, 205);
      const env = { HASNA_EVENTS_DIR: dir };
      const zero = runCli(["events", "list", "--limit", "0"], env);
      expect(zero.exitCode).toBe(0);
      expect(zero.stdout.trim().split("\n")).toHaveLength(1);

      const huge = runCli(["events", "list", "--limit", "500"], env);
      expect(huge.exitCode).toBe(0);
      expect(huge.stdout.trim().split("\n")).toHaveLength(200);

      const over = runCli(["events", "list", "--limit", "201"], env);
      expect(over.stdout.trim().split("\n")).toHaveLength(200);
    });
  });

  test("cursor pages report previous and next hints at the bounds", async () => {
    await withEventDir(async (dir) => {
      await seedEvents(dir, 25);
      const env = { HASNA_EVENTS_DIR: dir };

      const mid = runCli(["events", "list", "--limit", "10", "--cursor", "15"], env);
      expect(mid.exitCode).toBe(0);
      expect(mid.stdout.trim().split("\n")).toHaveLength(10);
      expect(mid.stderr).toContain("Showing 10 of 25.");
      expect(mid.stderr).toContain("Use --cursor 5 --limit 10 for previous results.");
      expect(mid.stderr).not.toContain("for next results.");

      const head = runCli(["events", "list", "--limit", "10", "--cursor", "0"], env);
      expect(head.stderr).toContain("Use --cursor 10 --limit 10 for next results.");
      expect(head.stderr).not.toContain("for previous results.");

      const past = runCli(["events", "list", "--limit", "10", "--cursor", "100"], env);
      expect(past.exitCode).toBe(0);
      expect(past.stdout.trim()).toBe("");
      expect(past.stderr).toContain("Showing 0 of 25.");
      expect(past.stderr).toContain("Use --cursor 90 --limit 10 for previous results.");
    });
  });

  test("findEvent matches exact id first, then prefix", async () => {
    await withEventDir(async (dir) => {
      const client = new EventsClient({ store: new JsonEventsStore(dir) });
      await client.emit({ id: "abcd", source: "ui", type: "ui.a", data: {} }, { deliver: false });
      await client.emit({ id: "abcdef12", source: "ui", type: "ui.b", data: {} }, { deliver: false });
      await client.emit({ id: "f00dcafe", source: "ui", type: "ui.c", data: {} }, { deliver: false });

      const env = { HASNA_EVENTS_DIR: dir };
      // Exact wins over a longer id that shares the prefix.
      const exact = runCli(["events", "show", "abcd", "--json"], env);
      expect(exact.exitCode).toBe(0);
      expect((JSON.parse(exact.stdout) as { id: string }).id).toBe("abcd");
      // Prefix resolves when no exact id exists.
      const prefix = runCli(["events", "show", "f00d", "--json"], env);
      expect(prefix.exitCode).toBe(0);
      expect((JSON.parse(prefix.stdout) as { id: string }).id).toBe("f00dcafe");
      // Unknown id fails with the typed error.
      const missing = runCli(["events", "show", "zzzz"], env);
      expect(missing.exitCode).toBe(1);
      expect(missing.stderr).toContain("Event not found: zzzz");
    });
  });

  test("verbose rows carry the compact event columns", async () => {
    await withEventDir(async (dir) => {
      const client = new EventsClient({ store: new JsonEventsStore(dir) });
      await client.emit(
        { source: "ui", type: "ui.verbose", severity: "warning", message: "verbose message", data: { k: "v" } },
        { deliver: false },
      );
      const env = { HASNA_EVENTS_DIR: dir };
      const verbose = runCli(["events", "list", "--limit", "1", "--verbose"], env);
      expect(verbose.exitCode).toBe(0);
      const line = verbose.stdout.trim();
      const cols = line.split("\t");
      expect(cols.length).toBeGreaterThanOrEqual(8);
      expect(cols[2]).toBe("ui");
      expect(cols[3]).toBe("ui.verbose");
      expect(cols[4]).toBe("warning");
      expect(line).toContain("verbose message");
      expect(line).toContain('"k":"v"');
    });
  });
});

describe("webhooks CLI", () => {
  test("channelTarget falls back webhook url then command then transport", async () => {
    await withEventDir(async (dir) => {
      const env = { HASNA_EVENTS_DIR: dir };
      const webhook = runCli(["webhooks", "add", "https://example.com/hook", "--id", "ui-hook"], env);
      expect(webhook.exitCode).toBe(0);
      const command = runCli(["webhooks", "add", "true", "--id", "ui-cmd", "--transport", "command"], env);
      expect(command.exitCode).toBe(0);

      const list = runCli(["webhooks", "list", "--limit", "10"], env);
      expect(list.exitCode).toBe(0);
      // webhook channel shows its url; command channel shows its command.
      expect(list.stdout).toContain("https://example.com/hook");
      expect(list.stdout).toContain("true");
      expect(list.stdout).toContain("webhook");
      expect(list.stdout).toContain("command");
    });
  });

  test("webhook json output pages with limit and cursor", async () => {
    await withEventDir(async (dir) => {
      const env = { HASNA_EVENTS_DIR: dir };
      for (const id of ["h1", "h2", "h3"]) {
        runCli(["webhooks", "add", `https://example.com/${id}`, "--id", id], env);
      }
      const full = runCli(["webhooks", "list", "--json"], env);
      expect(full.exitCode).toBe(0);
      expect(JSON.parse(full.stdout)).toHaveLength(3);

      const paged = runCli(["webhooks", "list", "--json", "--limit", "2"], env);
      expect(JSON.parse(paged.stdout)).toHaveLength(2);
    });
  });

  test("webhook test delivers through a command channel and removal is enforced", async () => {
    await withEventDir(async (dir) => {
      const env = { HASNA_EVENTS_DIR: dir };
      const add = runCli(["webhooks", "add", "true", "--id", "ui-cmd", "--transport", "command"], env);
      expect(add.exitCode).toBe(0);

      const test = runCli(["webhooks", "test", "ui-cmd", "--json"], env);
      expect(test.exitCode).toBe(0);
      expect((JSON.parse(test.stdout) as { status: string }).status).toBe("success");

      const remove = runCli(["webhooks", "remove", "ui-cmd"], env);
      expect(remove.exitCode).toBe(0);
      expect(remove.stdout).toContain("Removed ui-cmd");

      const gone = runCli(["webhooks", "show", "ui-cmd"], env);
      expect(gone.exitCode).toBe(1);
      expect(gone.stderr).toContain("Webhook channel not found: ui-cmd");
    });
  });
});

describe("events emit validation", () => {
  test("missing emit type is rejected", async () => {
    await withEventDir(async (dir) => {
      const proc = runCli(["events", "emit"], { HASNA_EVENTS_DIR: dir });
      expect(proc.exitCode).toBe(1);
      expect(proc.stderr).toContain("missing required argument 'type'");
    });
  });

  test("invalid JSON data rejects arrays and primitives with Expected a JSON object", async () => {
    await withEventDir(async (dir) => {
      const env = { HASNA_EVENTS_DIR: dir };
      for (const bad of ["[1,2]", "42", '"str"']) {
        const proc = runCli(["events", "emit", "ui.bad", "--data", bad], env);
        expect(proc.exitCode).toBe(1);
        expect(proc.stderr).toContain("Expected a JSON object");
      }
      const good = runCli(["events", "emit", "ui.good", "--data", '{"ok":true}', "--no-deliver", "--json"], env);
      expect(good.exitCode).toBe(0);
      expect((JSON.parse(good.stdout) as { event: { type: string } }).event.type).toBe("ui.good");
    });
  });
});
