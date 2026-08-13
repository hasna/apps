import { afterEach, describe, expect, test } from "bun:test";
import {
  chmod,
  mkdir,
  mkdtemp,
  readFile,
  readdir,
  rm,
  writeFile,
} from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

const PACKAGE_INBOX = join(import.meta.dir, "..", "inbox", "inbox");
const PACKAGE_JSON = join(import.meta.dir, "..", "..", "package.json");
const roots: string[] = [];

afterEach(async () => {
  await Promise.all(roots.splice(0).map((root) => rm(root, { recursive: true, force: true })));
});

type InboxHarness = {
  binDir: string;
  root: string;
  stateRoot: string;
  stubLog: string;
  tmpDir: string;
};

type InboxRun = {
  exitCode: number;
  stderr: string;
  stdout: string;
};

type RunFixtures = {
  backfillMessages?: Array<Record<string, unknown>>;
  messageEnvelope?: "compact" | "compact-preview" | "malformed";
  paginateBackfill?: boolean;
  seedMessages?: Array<Record<string, unknown>>;
  subscriptionsJson?: string;
  tasks?: Array<Record<string, unknown>>;
  todosFail?: boolean;
  windowMessages?: Array<Record<string, unknown>>;
};

async function createHarness(): Promise<InboxHarness> {
  const root = await mkdtemp(join(tmpdir(), "556e6366-inbox-"));
  roots.push(root);
  const binDir = join(root, "bin");
  const stateRoot = join(root, "state");
  const tmpDir = join(root, "tmp");
  const stubLog = join(root, "stub.log");
  await Promise.all([
    mkdir(binDir, { recursive: true }),
    mkdir(stateRoot, { recursive: true }),
    mkdir(tmpDir, { recursive: true }),
  ]);

  const conversationsStub = join(binDir, "conversations");
  await writeFile(
    conversationsStub,
    `#!/usr/bin/env bash
set -eu
printf '%s\n' "conversations $*" >> "\${STUB_LOG:?}"
emit_messages() {
  payload="$1"
  case "\${STUB_MESSAGE_ENVELOPE:-array}" in
    compact)
      jq -cn --argjson messages "$payload" \
        '{messages:$messages,count:($messages|length),compact:true,has_more:false,next_cursor:null}'
      ;;
    compact-preview)
      jq -c '[.[]
        | .preview = (.content // "")
        | .preview_bytes = ((.content // "") | length)
        | .content_bytes = ((.content // "") | length)
        | .truncated = false
        | .redacted = false
        | del(.content, .message, .body)
      ]' <<< "$payload" | jq -c --slurp \
        '.[0] | {messages:.,count:length,limit:length,cursor:0,next_cursor:null,has_more:false,skipped_count:0,byte_length:0,max_bytes:100000,timeout_ms:1000,compact:true,detail_path:"messages/{id}"}'
      ;;
    malformed)
      printf '%s\n' '{"messages":{},"count":1,"compact":true}'
      ;;
    *)
      printf '%s\n' "$payload"
      ;;
  esac
}
if [ "\${1:-}" = "channel" ] && [ "\${2:-}" = "subscriptions" ]; then
  identity="\${4:-}"
  if [ -n "\${STUB_SUBS_FAIL_FOR:-}" ] && [ "$identity" = "\${STUB_SUBS_FAIL_FOR}" ]; then
    printf '%s\n' "fixture subscription failure for $identity" >&2
    exit 18
  fi
  if [ -n "\${STUB_SUBSCRIPTIONS_JSON:-}" ]; then
    printf '%s\n' "\${STUB_SUBSCRIPTIONS_JSON}"
    exit 0
  fi
  case "$identity" in
    secondary) printf '%s\n' '[{"channel":"beta"}]' ;;
    *)         printf '%s\n' '[{"channel":"alpha"}]' ;;
  esac
  exit 0
fi
if [ "\${1:-}" = "since" ]; then
  emit_messages "\${STUB_WINDOW_MESSAGES:-[]}"
  exit 0
fi
if [ "\${1:-}" = "read" ]; then
  case " $* " in
    *" --since-id "*)
      if [ "\${STUB_BACKFILL_PAGINATE:-0}" = "1" ]; then
        since_id=0
        read_limit=500
        while [ "$#" -gt 0 ]; do
          case "$1" in
            --since-id) since_id="\${2:-0}"; shift 2 ;;
            --limit) read_limit="\${2:-500}"; shift 2 ;;
            *) shift ;;
          esac
        done
        page="$(jq -c --argjson since "$since_id" --argjson cap "$read_limit" \
          '[.[]? | select((.id // 0) > $since)] | sort_by(.id) | .[:$cap]' \
          <<< "\${STUB_BACKFILL_MESSAGES:-[]}")"
        emit_messages "$page"
      else
        emit_messages "\${STUB_BACKFILL_MESSAGES:-[]}"
      fi
      ;;
    *) emit_messages "\${STUB_SEED_MESSAGES:-[]}" ;;
  esac
  exit 0
fi
if [ "\${1:-}" = "whoami" ]; then
  printf '%s\n' '{"agent":"seat"}'
  exit 0
fi
printf '%s\n' 'unexpected conversations invocation' >&2
exit 17
`,
    { mode: 0o700 },
  );
  await chmod(conversationsStub, 0o700);

  const todosStub = join(binDir, "todos");
  await writeFile(
    todosStub,
    `#!/usr/bin/env bash
set -eu
printf '%s\n' "todos $*" >> "\${STUB_LOG:?}"
if [ "\${STUB_TODOS_FAIL:-0}" = "1" ]; then
  printf '%s\n' 'fixture todos failure' >&2
  exit 19
fi
printf '%s\n' "\${STUB_TASKS:-[]}"
`,
    { mode: 0o700 },
  );
  await chmod(todosStub, 0o700);

  return { binDir, root, stateRoot, stubLog, tmpDir };
}

async function seedState(stateDir: string, cursor: string): Promise<void> {
  await mkdir(stateDir, { recursive: true });
  await writeFile(join(stateDir, ".seeded"), "", { mode: 0o600 });
  await writeFile(join(stateDir, "last-msg"), `${cursor}\n`, { mode: 0o600 });
  await writeFile(join(stateDir, "seen-tasks"), "", { mode: 0o600 });
}

async function pathExists(path: string): Promise<boolean> {
  try {
    await readFile(path);
    return true;
  } catch {
    return false;
  }
}

async function readCursor(stateDir: string): Promise<string> {
  return (await readFile(join(stateDir, "last-msg"), "utf8")).trim();
}

function runInbox(
  harness: InboxHarness,
  args: string[],
  fixtures: RunFixtures = {},
  extraEnv: Record<string, string> = {},
): InboxRun {
  const result = Bun.spawnSync({
    cmd: [PACKAGE_INBOX, ...args],
    cwd: join(import.meta.dir, "..", ".."),
    env: {
      ...process.env,
      INBOX_STATE_DIR: harness.stateRoot,
      PATH: `${harness.binDir}:${process.env.PATH ?? ""}`,
      STUB_BACKFILL_MESSAGES: JSON.stringify(fixtures.backfillMessages ?? []),
      STUB_BACKFILL_PAGINATE: fixtures.paginateBackfill ? "1" : "0",
      STUB_LOG: harness.stubLog,
      STUB_MESSAGE_ENVELOPE: fixtures.messageEnvelope ?? "array",
      STUB_SEED_MESSAGES: JSON.stringify(fixtures.seedMessages ?? []),
      STUB_SUBSCRIPTIONS_JSON: fixtures.subscriptionsJson ?? "",
      STUB_TASKS: JSON.stringify(fixtures.tasks ?? []),
      STUB_TODOS_FAIL: fixtures.todosFail ? "1" : "0",
      STUB_WINDOW_MESSAGES: JSON.stringify(fixtures.windowMessages ?? []),
      TMPDIR: harness.tmpDir,
      ...extraEnv,
    },
    stderr: "pipe",
    stdout: "pipe",
  });

  return {
    exitCode: result.exitCode,
    stderr: result.stderr.toString(),
    stdout: result.stdout.toString(),
  };
}

function message(id: number, toAgent = "seat"): Record<string, unknown> {
  return {
    id,
    from_agent: "sender",
    to_agent: toAgent,
    channel: null,
    content: `message-${id}`,
    created_at: `2026-08-08T08:00:0${id}.000Z`,
  };
}

function channelMessage(id: number, channel: string): Record<string, unknown> {
  return {
    ...message(id, channel),
    channel,
  };
}

describe("inbox bounded cursor recovery", () => {
  test("runs a clean check through the top-level since JSON command", async () => {
    const harness = await createHarness();
    const stateDir = join(harness.stateRoot, "seat");
    await seedState(stateDir, "0");

    const result = runInbox(
      harness,
      ["check", "--as", "seat", "--limit", "3", "--no-todos"],
    );

    expect(result.exitCode, result.stderr).toBe(0);
    expect(await readFile(harness.stubLog, "utf8")).toContain(
      "conversations since 3m --limit 3 --json",
    );
  });

  test("does not advance the cursor past a constructed gap when backfill is unavailable", async () => {
    const harness = await createHarness();
    const stateDir = join(harness.stateRoot, "seat");
    await seedState(stateDir, "1");

    const result = runInbox(
      harness,
      ["check", "--as", "seat", "--limit", "3", "--no-todos"],
      { windowMessages: [message(4), message(5)] },
    );

    expect(result.exitCode).toBe(3);
    expect(result.stderr).toContain("GAP");
    expect(await readCursor(stateDir)).toBe("1");
  });

  test("accepts the compact conversations message envelope during bounded backfill", async () => {
    const harness = await createHarness();
    const stateDir = join(harness.stateRoot, "seat");
    await seedState(stateDir, "1");

    const gap = runInbox(
      harness,
      ["check", "--as", "seat", "--limit", "3", "--no-todos"],
      {
        backfillMessages: [message(2), message(3)],
        messageEnvelope: "compact",
        windowMessages: [message(4)],
      },
    );

    expect(gap.exitCode).toBe(3);
    expect(gap.stderr).toContain("GAP");
    expect(gap.stdout).toContain("message-2");
    expect(gap.stdout).toContain("message-3");
    expect(gap.stdout).not.toContain("message-4");
    expect(await readCursor(stateDir)).toBe("3");

    const clean = runInbox(
      harness,
      ["check", "--as", "seat", "--limit", "3", "--no-todos"],
      {
        messageEnvelope: "compact",
        windowMessages: [message(4)],
      },
    );

    expect(clean.exitCode).toBe(0);
    expect(clean.stderr).toBe("");
    expect(clean.stdout).toContain("message-4");
    expect(await readCursor(stateDir)).toBe("4");
  });

  test("keeps malformed message envelopes degraded and leaves the cursor unchanged", async () => {
    const harness = await createHarness();
    const stateDir = join(harness.stateRoot, "seat");
    await seedState(stateDir, "1");

    const result = runInbox(
      harness,
      ["check", "--as", "seat", "--limit", "3", "--no-todos"],
      {
        messageEnvelope: "malformed",
        windowMessages: [message(2)],
      },
    );

    expect(result.exitCode).toBe(3);
    expect(result.stderr).toContain("returned no usable JSON array");
    expect(await readCursor(stateDir)).toBe("1");
  });

  test("does not accept a message-shaped object from the subscriptions surface", async () => {
    const harness = await createHarness();
    const stateDir = join(harness.stateRoot, "seat");
    await seedState(stateDir, "1");

    const result = runInbox(
      harness,
      ["check", "--as", "seat", "--limit", "3", "--no-todos"],
      {
        subscriptionsJson: JSON.stringify({ messages: [] }),
        windowMessages: [message(2)],
      },
    );

    expect(result.exitCode).toBe(3);
    expect(result.stderr).toContain("subscriptions[seat]: conversations returned no usable JSON array");
    expect(result.stdout).not.toContain("message-2");
    expect(await readCursor(stateDir)).toBe("1");
  });

  test("still advances after a clean poll", async () => {
    const harness = await createHarness();
    const stateDir = join(harness.stateRoot, "seat");
    await seedState(stateDir, "1");

    const result = runInbox(
      harness,
      ["check", "--as", "seat", "--limit", "3", "--no-todos"],
      { windowMessages: [message(2), message(3)] },
    );

    expect(result.exitCode).toBe(0);
    expect(result.stderr).toBe("");
    expect(result.stdout).toContain("message-2");
    expect(result.stdout).toContain("message-3");
    expect(await readCursor(stateDir)).toBe("3");
    expect(await readFile(harness.stubLog, "utf8")).not.toContain("read --since-id");
  });

  test("does not hide a same-name peer while suppressing self traffic is ambiguous", async () => {
    const harness = await createHarness();
    const stateDir = join(harness.stateRoot, "seat");
    await seedState(stateDir, "1");
    const sameNamePeer = {
      ...message(2),
      from_agent: "seat",
      content: "same-name peer message",
    };

    const result = runInbox(
      harness,
      ["check", "--as", "seat", "--limit", "3", "--no-todos"],
      { windowMessages: [sameNamePeer] },
    );

    expect(result.exitCode).toBe(0);
    expect(result.stdout).toContain("same-name peer message");
    expect(await readCursor(stateDir)).toBe("2");
  });

  test("suppresses signed self traffic across the identity union without hiding an unsigned same-name peer", async () => {
    const harness = await createHarness();
    const stateDir = join(harness.stateRoot, "seat-seat+seat-alias");
    await seedState(stateDir, "1");
    await writeFile(join(stateDir, ".identity-migrated-v1"), "", { mode: 0o600 });
    const signature = "[inbox:seat:regression]";
    const signedPrimary = {
      ...channelMessage(2, "alpha"),
      from_agent: "seat",
      content: `primary self message ${signature}`,
    };
    const sameNamePeer = {
      ...channelMessage(3, "alpha"),
      from_agent: "seat",
      content: "unsigned same-name peer message",
    };
    const signedAlias = {
      ...channelMessage(4, "alpha"),
      from_agent: "seat-alias",
      content: `alias self message ${signature}`,
    };
    const signedPeerBlocker = {
      ...message(5),
      from_agent: "peer",
      content: `peer blocker quoting ${signature}`,
      blocking: true,
    };

    const result = runInbox(
      harness,
      ["check", "--as", "seat,seat-alias", "--limit", "5", "--no-todos"],
      { windowMessages: [signedPrimary, sameNamePeer, signedAlias, signedPeerBlocker] },
      { INBOX_SIGNATURE: signature },
    );

    expect(result.exitCode).toBe(0);
    expect(result.stdout).not.toContain("primary self message");
    expect(result.stdout).toContain("unsigned same-name peer message");
    expect(result.stdout).not.toContain("alias self message");
    expect(result.stdout).toContain("[BLOCKING] [dm] peer: peer blocker quoting");
    expect(await readCursor(stateDir)).toBe("5");
  });

  test("renders compact preview text and suppresses signed compact self traffic", async () => {
    const harness = await createHarness();
    const stateDir = join(harness.stateRoot, "seat");
    await seedState(stateDir, "1");
    const signature = "[inbox:seat:compact-preview]";
    const signedSelf = {
      ...message(2),
      from_agent: "seat",
      content: `compact self message ${signature}`,
    };
    const peer = {
      ...message(3),
      from_agent: "peer",
      content: "compact peer message",
    };

    const result = runInbox(
      harness,
      ["check", "--as", "seat", "--limit", "3", "--no-todos"],
      { messageEnvelope: "compact-preview", windowMessages: [signedSelf, peer] },
      { INBOX_SIGNATURE: signature },
    );

    expect(result.exitCode).toBe(0);
    expect(result.stdout).not.toContain("compact self message");
    expect(result.stdout).toContain("peer: compact peer message");
    expect(await readCursor(stateDir)).toBe("3");
  });

  test("backfills only the bounded skipped range before a later clean poll", async () => {
    const harness = await createHarness();
    const stateDir = join(harness.stateRoot, "seat");
    await seedState(stateDir, "1");
    const fixtures = {
      backfillMessages: [message(2), message(3), message(4)],
      windowMessages: [message(5), message(6)],
    };

    const gap = runInbox(
      harness,
      ["check", "--as", "seat", "--limit", "3", "--no-todos"],
      fixtures,
    );

    expect(gap.exitCode).toBe(3);
    expect(gap.stderr).toContain("GAP");
    expect(gap.stdout).toContain("message-2");
    expect(gap.stdout).toContain("message-3");
    expect(gap.stdout).toContain("message-4");
    expect(gap.stdout).not.toContain("message-5");
    expect(gap.stdout).not.toContain("message-6");
    expect(await readCursor(stateDir)).toBe("4");

    const clean = runInbox(
      harness,
      ["check", "--as", "seat", "--limit", "3", "--no-todos"],
      fixtures,
    );

    expect(clean.exitCode).toBe(0);
    expect(clean.stderr).toBe("");
    expect(clean.stdout).toContain("message-5");
    expect(clean.stdout).toContain("message-6");
    expect(await readCursor(stateDir)).toBe("6");
  });

  test("backfills an internal window gap before committing past it", async () => {
    const harness = await createHarness();
    const stateDir = join(harness.stateRoot, "seat");
    await seedState(stateDir, "1");
    const oldMessage = {
      ...message(3),
      created_at: "2020-01-01T00:00:00.000Z",
    };
    const fixtures = {
      backfillMessages: [message(2), oldMessage, message(4)],
      windowMessages: [message(2), message(4)],
    };

    const gap = runInbox(
      harness,
      ["check", "--as", "seat", "--limit", "3", "--no-todos"],
      fixtures,
    );

    expect(gap.exitCode).toBe(3);
    expect(gap.stderr).toContain("GAP");
    expect(gap.stdout).toContain("message-2");
    expect(gap.stdout).toContain("message-3");
    expect(gap.stdout).not.toContain("message-4");
    expect(await readCursor(stateDir)).toBe("3");

    const clean = runInbox(
      harness,
      ["check", "--as", "seat", "--limit", "3", "--no-todos"],
      fixtures,
    );

    expect(clean.exitCode).toBe(0);
    expect(clean.stderr).toBe("");
    expect(clean.stdout).toContain("message-4");
    expect(await readCursor(stateDir)).toBe("4");
  });

  test("probes the bounded id prefix when a historical higher id is outside the time window", async () => {
    const harness = await createHarness();
    const stateDir = join(harness.stateRoot, "seat");
    await seedState(stateDir, "1");
    const historical = {
      ...message(2),
      created_at: "2020-01-01T00:00:00.000Z",
    };

    const result = runInbox(
      harness,
      ["check", "--as", "seat", "--limit", "3", "--no-todos"],
      { backfillMessages: [historical], windowMessages: [] },
    );

    expect(result.exitCode).toBe(3);
    expect(result.stderr).toContain("GAP");
    expect(result.stdout).toContain("message-2");
    expect(await readCursor(stateDir)).toBe("2");
    expect(await readFile(harness.stubLog, "utf8")).toContain("read --since-id 1");
  });

  test("does not use an incomplete subscription union to advance the cursor", async () => {
    const harness = await createHarness();
    const stateDir = join(harness.stateRoot, "seat-primary+secondary");
    await seedState(stateDir, "1");
    await writeFile(join(stateDir, ".identity-migrated-v1"), "", { mode: 0o600 });
    const fixtures = {
      windowMessages: [channelMessage(2, "beta")],
    };

    const partial = runInbox(
      harness,
      ["check", "--as", "primary,secondary", "--limit", "3", "--no-todos"],
      fixtures,
      { STUB_SUBS_FAIL_FOR: "secondary" },
    );

    expect(partial.exitCode).toBe(3);
    expect(partial.stderr).toContain("subscriptions");
    expect(await readCursor(stateDir)).toBe("1");
    expect(await readFile(harness.stubLog, "utf8")).not.toContain("conversations since");

    const recovered = runInbox(
      harness,
      ["check", "--as", "primary,secondary", "--limit", "3", "--no-todos"],
      fixtures,
    );

    expect(recovered.exitCode).toBe(0);
    expect(recovered.stdout).toContain("message-2");
    expect(await readCursor(stateDir)).toBe("2");
  });

  test("enforces the configured per-invocation backfill bound", async () => {
    const harness = await createHarness();
    const stateDir = join(harness.stateRoot, "seat");
    await seedState(stateDir, "1");
    const fixtures = {
      backfillMessages: [message(2), message(3), message(4)],
      windowMessages: [message(5), message(6)],
    };

    const result = runInbox(
      harness,
      ["check", "--as", "seat", "--limit", "3", "--no-todos"],
      fixtures,
      { INBOX_BACKFILL_MAX: "1", INBOX_BACKFILL_CHUNK: "1" },
    );

    expect(result.exitCode).toBe(3);
    expect(result.stdout).toContain("message-2");
    expect(result.stdout).not.toContain("message-3");
    expect(result.stdout).not.toContain("message-4");
    expect(await readCursor(stateDir)).toBe("2");
    expect(await readFile(harness.stubLog, "utf8")).toContain("read --since-id 1 --limit 1 --json");
  });

  test("recovers multiple bounded pages in one check before the next clean poll", async () => {
    const harness = await createHarness();
    const stateDir = join(harness.stateRoot, "seat");
    await seedState(stateDir, "1");
    const fixtures = {
      backfillMessages: Array.from({ length: 8 }, (_, index) => message(index + 2)),
      paginateBackfill: true,
      windowMessages: [message(10), message(11)],
    };

    const gap = runInbox(
      harness,
      ["check", "--as", "seat", "--limit", "3", "--no-todos"],
      fixtures,
    );

    expect(gap.exitCode).toBe(3);
    expect(gap.stderr).toContain("GAP");
    for (let id = 2; id <= 9; id += 1) {
      expect(gap.stdout).toContain(`message-${id}`);
    }
    expect(gap.stdout).not.toContain("message-10");
    expect(await readCursor(stateDir)).toBe("9");

    const log = await readFile(harness.stubLog, "utf8");
    expect(log).toContain("read --since-id 1 --limit 3 --json");
    expect(log).toContain("read --since-id 4 --limit 3 --json");
    expect(log).toContain("read --since-id 7 --limit 3 --json");

    const clean = runInbox(
      harness,
      ["check", "--as", "seat", "--limit", "3", "--no-todos"],
      fixtures,
    );

    expect(clean.exitCode).toBe(0);
    expect(clean.stderr).toBe("");
    expect(clean.stdout).toContain("message-10");
    expect(clean.stdout).toContain("message-11");
    expect(await readCursor(stateDir)).toBe("11");
  });

  test("recovers materially more than the 500-row store page in one check", async () => {
    const harness = await createHarness();
    const stateDir = join(harness.stateRoot, "seat");
    await seedState(stateDir, "1");
    const fixtures = {
      backfillMessages: Array.from({ length: 600 }, (_, index) => message(index + 2)),
      paginateBackfill: true,
      windowMessages: [message(602), message(603)],
    };

    const result = runInbox(
      harness,
      ["check", "--as", "seat", "--limit", "500", "--no-todos"],
      fixtures,
    );

    expect(result.exitCode).toBe(3);
    expect(result.stdout).toContain("message-2");
    expect(result.stdout).toContain("message-501");
    expect(result.stdout).toContain("message-601");
    expect(result.stdout).not.toContain("message-602");
    expect(await readCursor(stateDir)).toBe("601");

    const log = await readFile(harness.stubLog, "utf8");
    expect(log).toContain("read --since-id 1 --limit 500 --json");
    expect(log).toContain("read --since-id 501 --limit 500 --json");
  });

  test("honors the per-invocation row cap across multiple recovery pages", async () => {
    const harness = await createHarness();
    const stateDir = join(harness.stateRoot, "seat");
    await seedState(stateDir, "1");
    const fixtures = {
      backfillMessages: Array.from({ length: 7 }, (_, index) => message(index + 2)),
      paginateBackfill: true,
      windowMessages: [message(9), message(10)],
    };

    const result = runInbox(
      harness,
      ["check", "--as", "seat", "--limit", "3", "--no-todos"],
      fixtures,
      { INBOX_BACKFILL_MAX: "5", INBOX_BACKFILL_CHUNK: "3" },
    );

    expect(result.exitCode).toBe(3);
    expect(result.stderr).toContain("per-invocation row cap 5 reached at cursor 6");
    for (let id = 2; id <= 6; id += 1) {
      expect(result.stdout).toContain(`message-${id}`);
    }
    expect(result.stdout).not.toContain("message-7");
    expect(result.stdout).not.toContain("message-8");
    expect(await readCursor(stateDir)).toBe("6");

    const log = await readFile(harness.stubLog, "utf8");
    expect(log).toContain("read --since-id 1 --limit 3 --json");
    expect(log).toContain("read --since-id 4 --limit 2 --json");
    expect(log).not.toContain("read --since-id 6");
  });

  test("uses one order-independent state directory and conservatively migrates aliases", async () => {
    const harness = await createHarness();
    const firstLegacy = join(harness.stateRoot, "Zulu");
    const secondLegacy = join(harness.stateRoot, "alpha");
    const canonical = join(harness.stateRoot, "seat-alpha+zulu");
    await seedState(firstLegacy, "6");
    await seedState(secondLegacy, "1");
    const fixtures = {
      backfillMessages: [message(2, "alpha"), message(3, "alpha"), message(4, "alpha")],
      windowMessages: [message(5, "alpha"), message(6, "alpha")],
    };

    const migrated = runInbox(
      harness,
      ["check", "--as", "Zulu,alpha", "--limit", "3", "--no-todos"],
      fixtures,
    );

    expect(migrated.exitCode).toBe(3);
    expect(await readCursor(canonical)).toBe("4");
    expect(await readCursor(firstLegacy)).toBe("6");
    expect(await readCursor(secondLegacy)).toBe("1");

    const reversed = runInbox(
      harness,
      ["check", "--as", "alpha,Zulu", "--limit", "3", "--no-todos"],
      fixtures,
    );

    expect(reversed.exitCode).toBe(0);
    expect(reversed.stdout).toContain("message-5");
    expect(reversed.stdout).toContain("message-6");
    expect(await readCursor(canonical)).toBe("6");
  });

  test("preserves the exact legacy state path for a single mixed-case identity", async () => {
    const harness = await createHarness();
    const legacy = join(harness.stateRoot, "CaseSeat");
    const forked = join(harness.stateRoot, "caseseat");
    await seedState(legacy, "1");

    const result = runInbox(
      harness,
      ["check", "--as", "CaseSeat", "--limit", "3", "--no-todos"],
      { windowMessages: [message(2, "CaseSeat"), message(3, "CaseSeat")] },
    );

    expect(result.exitCode).toBe(0);
    expect(result.stdout).toContain("message-2");
    expect(result.stdout).toContain("message-3");
    expect(await readCursor(legacy)).toBe("3");
    expect(await pathExists(join(forked, "last-msg"))).toBe(false);
  });

  test("reuses a single legacy state path when identity casing changes", async () => {
    const harness = await createHarness();
    const legacy = join(harness.stateRoot, "CaseSeat");
    const forked = join(harness.stateRoot, "caseseat");
    await seedState(legacy, "1");

    const result = runInbox(
      harness,
      ["check", "--as", "caseseat", "--limit", "3", "--no-todos"],
      { windowMessages: [message(2, "caseseat"), message(3, "caseseat")] },
    );

    expect(result.exitCode).toBe(0);
    expect(result.stdout).toContain("message-2");
    expect(result.stdout).toContain("message-3");
    expect(await readCursor(legacy)).toBe("3");
    expect(await pathExists(join(forked, "last-msg"))).toBe(false);
  });

  test("finds legacy alias state case-insensitively during canonical migration", async () => {
    const harness = await createHarness();
    const firstLegacy = join(harness.stateRoot, "Zulu");
    const secondLegacy = join(harness.stateRoot, "alpha");
    const canonical = join(harness.stateRoot, "seat-alpha+zulu");
    await seedState(firstLegacy, "6");
    await seedState(secondLegacy, "1");

    const result = runInbox(
      harness,
      ["check", "--as", "zulu,ALPHA", "--limit", "3", "--no-todos"],
      { windowMessages: [message(2, "ALPHA"), message(3, "ALPHA")] },
    );

    expect(result.exitCode).toBe(0);
    expect(result.stdout).toContain("message-2");
    expect(result.stdout).toContain("message-3");
    expect(await readCursor(canonical)).toBe("3");
    expect(await readCursor(firstLegacy)).toBe("6");
    expect(await readCursor(secondLegacy)).toBe("1");
    expect(await readFile(harness.stubLog, "utf8")).not.toContain("conversations read --limit 1 --json");
  });

  test("an explicit seat key folds in a newly added alias exactly once", async () => {
    const harness = await createHarness();
    const firstLegacy = join(harness.stateRoot, "alpha");
    const addedLegacy = join(harness.stateRoot, "Zulu");
    const canonical = join(harness.stateRoot, "seat-chief");
    await seedState(firstLegacy, "6");
    await seedState(addedLegacy, "1");
    const fixtures = {
      backfillMessages: [message(2, "alpha"), message(3, "alpha"), message(4, "alpha")],
      windowMessages: [message(5, "alpha"), message(6, "alpha")],
    };

    const initial = runInbox(
      harness,
      ["check", "--seat", "chief", "--as", "alpha", "--limit", "3", "--no-todos"],
      fixtures,
    );
    expect(initial.exitCode).toBe(0);
    expect(await readCursor(canonical)).toBe("6");

    const expanded = runInbox(
      harness,
      ["check", "--seat", "chief", "--as", "Zulu,alpha", "--limit", "3", "--no-todos"],
      fixtures,
    );
    expect(expanded.exitCode).toBe(3);
    expect(expanded.stderr).toContain("GAP");
    expect(await readCursor(canonical)).toBe("4");

    const clean = runInbox(
      harness,
      ["check", "--seat", "chief", "--as", "alpha,Zulu", "--limit", "3", "--no-todos"],
      fixtures,
    );
    expect(clean.exitCode).toBe(0);
    expect(clean.stdout).toContain("message-5");
    expect(clean.stdout).toContain("message-6");
    expect(await readCursor(canonical)).toBe("6");
  });

  test("fails closed on a corrupt cursor without issuing a message read", async () => {
    const harness = await createHarness();
    const stateDir = join(harness.stateRoot, "seat");
    await seedState(stateDir, "not-a-number");

    const result = runInbox(
      harness,
      ["check", "--as", "seat", "--limit", "3", "--no-todos"],
      { windowMessages: [message(5), message(6)] },
    );

    expect(result.exitCode).toBe(3);
    expect(result.stderr.toLowerCase()).toContain("cursor");
    expect(await readCursor(stateDir)).toBe("not-a-number");
    const calls = await readFile(harness.stubLog, "utf8");
    expect(calls).not.toContain("conversations since");
    expect(calls).not.toContain("conversations read");
  });

  test("commits seed cursors and task baselines only after both reads succeed", async () => {
    const harness = await createHarness();
    const stateDir = join(harness.stateRoot, "seat");
    const fixtures = {
      seedMessages: [message(6)],
      tasks: [{ id: "task-1" }],
      windowMessages: [message(6)],
    };

    const failed = runInbox(
      harness,
      ["check", "--as", "seat", "--limit", "3"],
      { ...fixtures, todosFail: true },
    );

    expect(failed.exitCode).toBe(3);
    expect(await pathExists(join(stateDir, "last-msg"))).toBe(false);
    expect(await pathExists(join(stateDir, "seen-tasks"))).toBe(false);
    expect(await pathExists(join(stateDir, ".seeded"))).toBe(false);

    const seeded = runInbox(
      harness,
      ["check", "--as", "seat", "--limit", "3"],
      fixtures,
    );

    expect(seeded.exitCode).toBe(0);
    expect(seeded.stdout).toContain("seeded");
    expect(await readCursor(stateDir)).toBe("6");
    expect(await readFile(join(stateDir, "seen-tasks"), "utf8")).toBe("task-1\n");
    expect(await pathExists(join(stateDir, ".seeded"))).toBe(true);
  });
});

describe("package-owned inbox installation", () => {
  test("declares the inbox binary in package metadata", async () => {
    const pkg = JSON.parse(await readFile(PACKAGE_JSON, "utf8")) as {
      bin?: Record<string, string>;
    };
    expect(pkg.bin?.inbox).toBe("bin/inbox");
  });

  test("installs atomically while preserving the previous target", async () => {
    const harness = await createHarness();
    const installDir = join(harness.root, "installed");
    const target = join(installDir, "inbox");
    await mkdir(installDir, { recursive: true });
    await writeFile(target, "old-inbox\n", { mode: 0o755 });

    const result = runInbox(
      harness,
      ["install"],
      {},
      { INBOX_INSTALL_TARGET: target },
    );

    expect(result.exitCode).toBe(0);
    expect(result.stdout).toContain(target);
    expect(await readFile(target, "utf8")).toBe(await readFile(PACKAGE_INBOX, "utf8"));
    const files = await readdir(installDir);
    const backups = files.filter((name) => name.startsWith("inbox.bak-"));
    expect(backups).toHaveLength(1);
    expect(await readFile(join(installDir, backups[0]), "utf8")).toBe("old-inbox\n");
  });
});
