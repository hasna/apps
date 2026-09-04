import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import {
  fallbackSshCommand,
  LocalRunner,
  RemoteRunner,
  createRunner,
  isLocalMachine,
  quoteArgv,
  remoteTimeoutMs,
  shellQuote,
  sshMachineCommandResolver,
} from "./runner.js";

describe("isLocalMachine", () => {
  test("undefined / local / localhost are local", () => {
    expect(isLocalMachine(undefined)).toBe(true);
    expect(isLocalMachine("local")).toBe(true);
    expect(isLocalMachine("localhost")).toBe(true);
    expect(isLocalMachine("LOCAL")).toBe(true);
  });
  test("a named machine is not local", () => {
    expect(isLocalMachine("spark01")).toBe(false);
  });
});

describe("shell quoting", () => {
  test("shellQuote wraps and escapes single quotes", () => {
    expect(shellQuote("hello")).toBe("'hello'");
    expect(shellQuote("it's")).toBe("'it'\\''s'");
  });
  test("quoteArgv joins safely so remote shells see one command per arg", () => {
    expect(quoteArgv(["tmux", "send-keys", "-t", "s:w", "-l", "--", "a b; rm -rf /"])).toBe(
      "'tmux' 'send-keys' '-t' 's:w' '-l' '--' 'a b; rm -rf /'",
    );
  });
});

describe("LocalRunner", () => {
  test("runs a command locally and captures stdout/exit", () => {
    const r = new LocalRunner();
    const res = r.run(["echo", "hi-there"]);
    expect(res.exitCode).toBe(0);
    expect(res.source).toBe("local");
    expect(res.stdout.trim()).toBe("hi-there");
  });
  test("pipes input to stdin", () => {
    const r = new LocalRunner();
    const res = r.run(["cat"], "piped-content");
    expect(res.stdout).toBe("piped-content");
  });
});

describe("RemoteRunner", () => {
  test("uses a tolerant default timeout for cross-machine tmux operations", () => {
    const previous = process.env.DISPATCH_REMOTE_TIMEOUT_MS;
    delete process.env.DISPATCH_REMOTE_TIMEOUT_MS;
    try {
      expect(remoteTimeoutMs()).toBe(20000);
      process.env.DISPATCH_REMOTE_TIMEOUT_MS = "42";
      expect(remoteTimeoutMs()).toBe(42);
    } finally {
      if (previous === undefined) {
        delete process.env.DISPATCH_REMOTE_TIMEOUT_MS;
      } else {
        process.env.DISPATCH_REMOTE_TIMEOUT_MS = previous;
      }
    }
  });

  test("wraps argv through the resolver and executes the resolved shell command", () => {
    // Stub the resolver so we exercise the wiring without real ssh.
    const calls: string[] = [];
    const r = new RemoteRunner("box", (machineId, command) => {
      calls.push(`${machineId}:${command}`);
      return { source: "ssh", shellCommand: `echo resolved-for-${machineId}` };
    });
    const res = r.run(["tmux", "send-keys", "-t", "s:w", "-l", "--", "hi"]);
    expect(res.exitCode).toBe(0);
    expect(res.source).toBe("ssh");
    expect(res.stdout.trim()).toBe("resolved-for-box");
    // the resolver received the fully-quoted argv
    expect(calls[0]).toBe("box:'tmux' 'send-keys' '-t' 's:w' '-l' '--' 'hi'");
  });

  test("bounds remote commands with a timeout", () => {
    const start = Date.now();
    const r = new RemoteRunner("box", () => ({ source: "ssh", shellCommand: "sleep 5" }), 50);
    const res = r.run(["tmux", "list-sessions"]);
    expect(Date.now() - start).toBeLessThan(1500);
    expect(res.exitCode).toBe(124);
    expect(res.stderr).toMatch(/timed out/i);
  });

  test("fallback ssh command is noninteractive and bounded", () => {
    const command = fallbackSshCommand("box", "tmux list-sessions");
    expect(command).toContain("BatchMode=yes");
    expect(command).toContain("ConnectTimeout=5");
    expect(command).toContain("ServerAliveInterval=5");
    expect(command).toContain("'box'");
  });
});

describe("createRunner", () => {
  test("returns a LocalRunner for local machines", async () => {
    const r = await createRunner(undefined);
    expect(r).toBeInstanceOf(LocalRunner);
    expect(r.machine).toBe("local");
  });
  test("returns a RemoteRunner for a named machine", async () => {
    const r = await createRunner("some-remote-box");
    expect(r).toBeInstanceOf(RemoteRunner);
    expect(r.machine).toBe("some-remote-box");
  });
  test("a custom resolver can supply a different route", async () => {
    const r = await createRunner("box", (id, command) => ({
      source: "tailscale",
      shellCommand: `echo routed-${id}-${command.length}`,
    }));
    const res = r.run(["echo", "hi"]);
    expect(res.source).toBe("tailscale");
    expect(res.stdout.trim()).toMatch(/^routed-box-\d+$/);
  });
});

// Issue #1603: @hasna/machines was deleted from the public registry, so an
// empty-cache `bun add @hasna/dispatch` must not need it. The topology types
// are vendored in runner.ts and remote routing falls to plain ssh.
describe("@hasna/machines is fully dropped (#1603)", () => {
  test("the built-in resolver routes over plain, non-interactive ssh", () => {
    const plan = sshMachineCommandResolver("box", "tmux list-sessions");
    expect(plan.source).toBe("ssh");
    expect(plan.shellCommand).toBe(fallbackSshCommand("box", "tmux list-sessions"));
    expect(plan.shellCommand).toContain("BatchMode=yes");
  });

  test("createRunner defaults a remote machine to the ssh route without loading any optional package", async () => {
    const r = (await createRunner("box")) as RemoteRunner;
    expect(r.machine).toBe("box");
    // Assert the PLAN, never execute it: running would spawn a real ssh at
    // "box", which is a live DNS/connect attempt on whatever host runs the
    // suite. The resolver being the built-in ssh one is the whole claim —
    // no dynamic import of a deleted package can be involved, because none is
    // referenced any more.
    expect(r.resolve).toBe(sshMachineCommandResolver);
    const plan = r.resolve("box", quoteArgv(["true"]));
    expect(plan.source).toBe("ssh");
    expect(plan.shellCommand).toBe(fallbackSshCommand("box", quoteArgv(["true"])));
  });

  test("runner.ts references no @hasna/machines specifier", () => {
    const src = readFileSync(join(import.meta.dir, "runner.ts"), "utf8");
    expect(src).not.toContain("@hasna/machines/consumer");
    expect(src).not.toContain('import("@hasna/machines');
  });

  test("package.json declares no dependency on @hasna/machines and does not extern it", () => {
    const pkgPath = join(import.meta.dir, "..", "..", "package.json");
    const raw = readFileSync(pkgPath, "utf8");
    expect(raw).not.toContain("@hasna/machines");
    const pkg = JSON.parse(raw) as Record<string, Record<string, string> | undefined>;
    for (const field of ["dependencies", "optionalDependencies", "peerDependencies", "devDependencies"]) {
      expect(Object.keys(pkg[field] ?? {})).not.toContain("@hasna/machines");
    }
  });
});
