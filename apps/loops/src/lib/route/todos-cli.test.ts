import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { chmodSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { ensureTodosTaskList } from "./todos-cli.js";

/**
 * Regression coverage for the duplicate task-list bug: ensureTodosTaskList used
 * to run a blind `todos task-lists --add` on EVERY call and only afterwards look
 * up the list by slug. The then-installed todos CLI answered a slug conflict by
 * minting a fresh `-legacy-<uuid>` slug, so a loop firing every 15 minutes
 * created one duplicate 'Loop Error Self Heal' list per firing — measured
 * 247 lists (242 empty) in the fleet store created 2026-06-26..2026-07-07.
 * The ensure path must be create-if-absent: when the slug already exists in the
 * project it returns the existing list id and issues NO `--add` at all.
 */

interface FakeTodosEnv {
  dataDir: string;
  calls: string;
  restore: () => void;
}

function withFakeTodos(seedLists: Array<[string, string]>, opts: { addNoop?: boolean } = {}): FakeTodosEnv {
  const dataDir = mkdtempSync(join(tmpdir(), "loops-todos-cli-ensure-"));
  const binDir = join(dataDir, "bin");
  mkdirSync(binDir, { recursive: true });
  const state = join(dataDir, "lists.state");
  const calls = join(dataDir, "todos-calls.log");
  const counter = join(dataDir, "counter");
  writeFileSync(counter, "1");
  writeFileSync(
    state,
    seedLists.map(([id, slug]) => `${id} ${slug}`).join("\n") + "\n",
  );

  const todos = join(binDir, "todos");
  writeFileSync(
    todos,
    [
      "#!/usr/bin/env bash",
      "set -euo pipefail",
      "printf '%s\\n' \"$*\" >> \"$OPENLOOPS_TEST_TODOS_CALLS\"",
      "if [[ \"$*\" == *\"task-lists\"* && \"$*\" != *\"--add\"* && \"$*\" == *\"--json\"* ]]; then",
      "  entries=()",
      "  if [[ -s \"$OPENLOOPS_TEST_TODOS_STATE\" ]]; then",
      "    while read -r id slug; do",
      "      entries+=(\"{\\\"id\\\":\\\"$id\\\",\\\"slug\\\":\\\"$slug\\\"}\")",
      "    done < \"$OPENLOOPS_TEST_TODOS_STATE\"",
      "  fi",
      "  joined=\"$(IFS=,; printf '%s' \"${entries[*]}\")\"",
      "  printf '[%s]\\n' \"$joined\"",
      "  exit 0",
      "fi",
      "if [[ \"$*\" == *\"task-lists\"* && \"$*\" == *\"--add\"* ]]; then",
      "  if [[ \"${OPENLOOPS_TEST_TODOS_ADD_NOOP:-0}\" != \"0\" ]]; then",
      "    printf 'Task list created (noop)\\n'",
      "    exit 0",
      "  fi",
      "  prev=\"\"",
      "  slug=\"\"",
      "  for arg in \"$@\"; do",
      "    if [[ \"$prev\" == \"--slug\" ]]; then slug=\"$arg\"; fi",
      "    prev=\"$arg\"",
      "  done",
      "  n=\"$(cat \"$OPENLOOPS_TEST_TODOS_COUNTER\")\"",
      "  echo \"$((n + 1))\" > \"$OPENLOOPS_TEST_TODOS_COUNTER\"",
      "  printf 'list-%s %s\\n' \"$n\" \"$slug\" >> \"$OPENLOOPS_TEST_TODOS_STATE\"",
      "  printf 'Task list created:\\n  ID:   %s\\n' \"$n\"",
      "  exit 0",
      "fi",
      "printf 'unexpected todos command: %s\\n' \"$*\" >&2",
      "exit 2",
      "",
    ].join("\n"),
  );
  chmodSync(todos, 0o755);

  const oldPath = process.env.PATH;
  const oldCalls = process.env.OPENLOOPS_TEST_TODOS_CALLS;
  const oldState = process.env.OPENLOOPS_TEST_TODOS_STATE;
  const oldCounter = process.env.OPENLOOPS_TEST_TODOS_COUNTER;
  const oldAddNoop = process.env.OPENLOOPS_TEST_TODOS_ADD_NOOP;
  process.env.PATH = `${binDir}:${oldPath ?? ""}`;
  process.env.OPENLOOPS_TEST_TODOS_CALLS = calls;
  process.env.OPENLOOPS_TEST_TODOS_STATE = state;
  process.env.OPENLOOPS_TEST_TODOS_COUNTER = counter;
  if (opts.addNoop) process.env.OPENLOOPS_TEST_TODOS_ADD_NOOP = "1";

  return {
    dataDir,
    calls,
    restore: () => {
      restoreEnv("PATH", oldPath);
      restoreEnv("OPENLOOPS_TEST_TODOS_CALLS", oldCalls);
      restoreEnv("OPENLOOPS_TEST_TODOS_STATE", oldState);
      restoreEnv("OPENLOOPS_TEST_TODOS_COUNTER", oldCounter);
      restoreEnv("OPENLOOPS_TEST_TODOS_ADD_NOOP", oldAddNoop);
      rmSync(dataDir, { recursive: true, force: true });
    },
  };
}

function restoreEnv(name: string, previous: string | undefined): void {
  if (previous === undefined) delete process.env[name];
  else process.env[name] = previous;
}

function callLog(path: string): string[] {
  return readFileSync(path, "utf8").trim().split("\n").filter(Boolean);
}

describe("ensureTodosTaskList create-if-absent", () => {
  let fake: FakeTodosEnv;
  beforeEach(() => {
    fake = withFakeTodos([]);
  });
  afterEach(() => {
    fake.restore();
  });

  test("REGRESSION: returns the existing list id and issues NO task-lists --add when the slug already exists", () => {
    fake.restore();
    fake = withFakeTodos([["list-existing", "loop-error-self-heal"]]);
    const id = ensureTodosTaskList("/tmp/project", "loop-error-self-heal", "Loop Error Self Heal", "desc");
    expect(id).toBe("list-existing");
    const calls = callLog(fake.calls);
    expect(calls).toHaveLength(1);
    expect(calls[0]).toContain("task-lists");
    expect(calls[0]).toContain("--json");
    expect(calls[0]).not.toContain("--add");
  });

  test("creates the list exactly once when the slug is absent and returns the created id", () => {
    const id = ensureTodosTaskList("/tmp/project", "loop-error-self-heal", "Loop Error Self Heal", "desc");
    expect(id).toBe("list-1");
    const adds = callLog(fake.calls).filter((line) => line.includes("task-lists") && line.includes("--add"));
    expect(adds).toHaveLength(1);
    expect(adds[0]).toContain("--slug loop-error-self-heal");
  });

  test("repeated ensure calls stay at one list: second call reuses the created list", () => {
    const first = ensureTodosTaskList("/tmp/project", "loop-error-self-heal", "Loop Error Self Heal", "desc");
    const second = ensureTodosTaskList("/tmp/project", "loop-error-self-heal", "Loop Error Self Heal", "desc");
    expect(first).toBe("list-1");
    expect(second).toBe("list-1");
    const adds = callLog(fake.calls).filter((line) => line.includes("task-lists") && line.includes("--add"));
    expect(adds).toHaveLength(1);
  });

  test("throws when the add did not materialize a list with the slug", () => {
    fake.restore();
    fake = withFakeTodos([], { addNoop: true });
    expect(() => ensureTodosTaskList("/tmp/project", "loop-error-self-heal", "Loop Error Self Heal", "desc")).toThrow(
      "todos task list not found after ensure: loop-error-self-heal",
    );
  });
});
