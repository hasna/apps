/**
 * End-to-end: the CLI, spawned as a real process.
 *
 * Exit codes are part of the contract, not decoration — the phase-2 guard
 * rewrites `rm` into a call to this binary and propagates the result, so a
 * refusal that exits 0 would be a delete the shell reported as successful. Each
 * test therefore drives the actual binary with a sandbox HOME and a `--spool`
 * inside the sandbox; nothing here can reach the operator's store.
 */

import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { existsSync, readFileSync, readdirSync } from "node:fs";
import { createSandbox, spawnEnv, type Sandbox } from "../testing/sandbox.js";

const CLI = new URL("./index.ts", import.meta.url).pathname;

let sandbox: Sandbox;

beforeEach(() => {
  sandbox = createSandbox();
});

afterEach(() => {
  sandbox.cleanup();
});

interface Run {
  code: number;
  stdout: string;
  stderr: string;
}

async function run(...args: string[]): Promise<Run> {
  const proc = Bun.spawn({
    cmd: ["bun", CLI, "--spool", sandbox.path("spool"), ...args],
    env: spawnEnv(sandbox),
    cwd: sandbox.root,
    stdout: "pipe",
    stderr: "pipe",
  });
  const [code, stdout, stderr] = await Promise.all([
    proc.exited,
    new Response(proc.stdout).text(),
    new Response(proc.stderr).text(),
  ]);
  return { code, stdout, stderr };
}

function json<T>(text: string): T {
  return JSON.parse(text) as T;
}

describe("put", () => {
  test("trashes a path and prints the new entry id", async () => {
    const file = sandbox.file("work/report.md", "report bytes");

    const put = await run("--json", "put", file);

    expect(put.code).toBe(0);
    const outcomes = json<{ status: string; entryId: string; absolutePath: string }[]>(put.stdout);
    expect(outcomes).toHaveLength(1);
    expect(outcomes[0]!.status).toBe("captured");
    expect(outcomes[0]!.absolutePath).toBe(file);
    expect(existsSync(file)).toBe(false);

    const list = await run("--json", "list");
    expect(list.code).toBe(0);
    const entries = json<{ id: string; originalPath: string; status: string }[]>(list.stdout);
    expect(entries.map((e) => e.id)).toEqual([outcomes[0]!.entryId]);
    expect(entries[0]!.originalPath).toBe(file);
    expect(entries[0]!.status).toBe("staged");
  });

  test("a missing path is not an error (rm -f semantics)", async () => {
    const gone = sandbox.path("never-existed.txt");
    const put = await run("--json", "put", gone);
    expect(put.code).toBe(0);
    expect(json<{ status: string }[]>(put.stdout)[0]!.status).toBe("missing");
  });

  test("several paths at once, rm grammar included (-rf)", async () => {
    const a = sandbox.file("bulk/a.txt", "a");
    const b = sandbox.file("bulk/b.txt", "b");
    const dir = sandbox.dir("bulk/nested");

    const put = await run("--json", "put", "-rf", a, b, dir);

    expect(put.code).toBe(0);
    expect(json<{ status: string }[]>(put.stdout).map((o) => o.status)).toEqual(["captured", "captured", "captured"]);
    expect(existsSync(a)).toBe(false);
    expect(existsSync(dir)).toBe(false);
  });

  test("a capture refusal on a NON-excluded path refuses the delete too — exit 2, path untouched (§11.7)", async () => {
    await run("config", "set", "capture.maxEntryBytes", "8");
    const big = sandbox.file("precious/big.bin", "this is more than eight bytes");

    const put = await run("--json", "put", big);

    expect(put.code).toBe(2);
    const outcome = json<{ status: string; detail: string; refusals: { reason: string; deleted: boolean }[] }[]>(put.stdout)[0]!;
    expect(outcome.status).toBe("refused");
    expect(outcome.refusals[0]!.reason).toBe("too_large");
    expect(outcome.refusals[0]!.deleted).toBe(false);
    // The path is still there — this is the whole point of the rule.
    expect(existsSync(big)).toBe(true);
    expect(readFileSync(big, "utf8")).toBe("this is more than eight bytes");

    const refusals = await run("config", "refusals");
    expect(refusals.stdout).toContain("too_large");
  });

  test("--force deletes a path whose capture was refused, and records that it did", async () => {
    await run("config", "set", "capture.maxEntryBytes", "8");
    const big = sandbox.file("precious/big.bin", "this is more than eight bytes");

    const put = await run("--json", "put", "--force", big);

    expect(put.code).toBe(0);
    const outcome = json<{ status: string; refusals: { deleted: boolean; forced: boolean }[] }[]>(put.stdout)[0]!;
    expect(outcome.status).toBe("deleted_without_capture");
    expect(outcome.refusals[0]).toEqual(expect.objectContaining({ deleted: true, forced: true }));
    expect(existsSync(big)).toBe(false);
  });

  test("a refusal inside an exclude glob deletes and records, with exit 0", async () => {
    await run("config", "set", "capture.maxEntryBytes", "8");
    const build = sandbox.file("proj/node_modules/left-pad/index.js", "module.exports = () => 'more than eight bytes'");

    const put = await run("--json", "put", build);

    expect(put.code).toBe(0);
    const outcome = json<{ status: string; refusals: { deleted: boolean; excluded: boolean; excludeGlob: string }[] }[]>(put.stdout)[0]!;
    expect(outcome.status).toBe("deleted_without_capture");
    expect(outcome.refusals[0]!.deleted).toBe(true);
    expect(outcome.refusals[0]!.excluded).toBe(true);
    expect(outcome.refusals[0]!.excludeGlob).toBe("**/node_modules/**");
    expect(existsSync(build)).toBe(false);
  });

  test("a protected path is refused even with --force", async () => {
    const home = sandbox.path("home");
    const put = await run("--json", "put", "--force", home);

    expect(put.code).toBe(2);
    const outcome = json<{ status: string; refusals: { reason: string }[] }[]>(put.stdout)[0]!;
    expect(outcome.status).toBe("refused");
    expect(outcome.refusals[0]!.reason).toBe("protected_path");
    expect(existsSync(home)).toBe(true);
  });

  test("no paths is a usage error", async () => {
    const put = await run("put");
    expect(put.code).toBe(1);
    expect(put.stderr).toContain("put needs at least one path");
  });
});

describe("restore / info / purge / empty", () => {
  test("restore puts the bytes back byte-identically and the entry is gone", async () => {
    const file = sandbox.file("work/notes.txt", "line one\nline two\n");
    const id = json<{ entryId: string }[]>((await run("--json", "put", file)).stdout)[0]!.entryId!;

    const restore = await run("--json", "restore", id);

    expect(restore.code).toBe(0);
    expect(json<{ restoredTo: string }>(restore.stdout).restoredTo).toBe(file);
    expect(readFileSync(file, "utf8")).toBe("line one\nline two\n");
    expect(json<unknown[]>((await run("--json", "list")).stdout)).toHaveLength(0);
  });

  test("restore --to refuses an occupied destination with exit 1 and the entry stays", async () => {
    const file = sandbox.file("work/keep.txt", "captured");
    const id = json<{ entryId: string }[]>((await run("--json", "put", file)).stdout)[0]!.entryId!;
    sandbox.file("work/keep.txt", "a newer file");

    const restore = await run("restore", id);
    expect(restore.code).toBe(1);
    expect(restore.stderr).toContain("refusing to restore over");
    expect(readFileSync(file, "utf8")).toBe("a newer file");
    expect(json<unknown[]>((await run("--json", "list")).stdout)).toHaveLength(1);
  });

  test("info prints the entry document; an unknown id is an error", async () => {
    const file = sandbox.file("work/doc.txt", "bytes");
    const id = json<{ entryId: string }[]>((await run("--json", "put", file)).stdout)[0]!.entryId!;

    const info = await run("info", id);
    expect(info.code).toBe(0);
    const entry = json<{ id: string; originalPath: string; sha256: string; kind: string }>(info.stdout);
    expect(entry.id).toBe(id);
    expect(entry.originalPath).toBe(file);
    expect(entry.sha256).toHaveLength(64);
    expect(entry.kind).toBe("file");

    const missing = await run("info", "00000000-0000-4000-8000-000000000000");
    expect(missing.code).toBe(1);
    expect(missing.stderr).toContain("no such entry");
  });

  test("purge is a dry run until --apply, then removes payload and metadata", async () => {
    const file = sandbox.file("work/purge-me.txt", "bytes");
    const id = json<{ entryId: string }[]>((await run("--json", "put", file)).stdout)[0]!.entryId!;

    const dry = await run("--json", "purge", id);
    expect(dry.code).toBe(0);
    expect(json<{ dryRun: boolean; purged: string[]; bytes: number }>(dry.stdout)).toEqual({ purged: [], bytes: 0, dryRun: true });
    expect(json<unknown[]>((await run("--json", "list")).stdout)).toHaveLength(1);

    const applied = await run("--json", "purge", id, "--apply");
    expect(applied.code).toBe(0);
    expect(json<{ purged: string[] }>(applied.stdout).purged).toEqual([id]);
    expect(json<unknown[]>((await run("--json", "list")).stdout)).toHaveLength(0);
  });

  test("empty needs --apply too", async () => {
    for (let i = 0; i < 3; i += 1) await run("--json", "put", sandbox.file(`bulk/f${i}.txt`, `f${i}`));

    expect(json<{ dryRun: boolean; purged: string[]; bytes: number }>((await run("--json", "empty")).stdout)).toEqual({
      purged: [],
      bytes: 0,
      dryRun: true,
    });
    expect(json<unknown[]>((await run("--json", "list")).stdout)).toHaveLength(3);

    const emptied = await run("--json", "empty", "--apply");
    expect(emptied.code).toBe(0);
    expect(json<{ purged: string[] }>(emptied.stdout).purged).toHaveLength(3);
    expect(json<unknown[]>((await run("--json", "list")).stdout)).toHaveLength(0);
  });
});

describe("status / doctor / config", () => {
  test("status reports mode, roots, counts and quota", async () => {
    await run("--json", "put", sandbox.file("a.txt", "aaaa"));
    await run("--json", "put", sandbox.file("b.txt", "bb"));

    const status = await run("--json", "status");
    expect(status.code).toBe(0);
    const doc = json<{ mode: string; entries: number; bytes: number; unuploaded: number; roots: { files: string } }>(status.stdout);
    expect(doc.mode).toContain("local-only");
    expect(doc.entries).toBe(2);
    expect(doc.bytes).toBe(6);
    expect(doc.unuploaded).toBe(2);
    expect(doc.roots.files).toBe(sandbox.path("spool/files"));

    const human = await run("status");
    expect(human.stdout).toContain("mode        local-only");
    expect(human.stdout).toContain("entries     2");
  });

  test("doctor: no failing checks, and it names the phase-2/3 gaps rather than implying coverage", async () => {
    // The default minFreeBytes is 2 GiB; a runner with less free space would
    // (correctly) fail the free-space check, so pin it to something small — the
    // test is about the report, not about how full CI's disk is.
    await run("config", "set", "capture.minFreeBytes", "1048576");

    const doctor = await run("--json", "doctor");
    expect(doctor.code).toBe(0);
    const checks = json<{ id: string; status: string; detail: string }[]>(doctor.stdout);
    expect(checks.map((c) => c.id)).toContain("store.init");
    expect(checks.filter((c) => c.status === "fail")).toEqual([]);
    expect(checks.find((c) => c.id === "guard.hook")!.status).toBe("warn");
    expect(checks.find((c) => c.id === "daemon.timer")!.status).toBe("warn");

    await run("--json", "put", sandbox.file("x.txt", "x"));
    const after = json<{ id: string; detail: string }[]>((await run("--json", "doctor")).stdout);
    expect(after.find((c) => c.id === "retention.quota")!.detail).toContain("bytes");
  });

  test("config path / keys / list / get / set / unset / defaults", async () => {
    expect((await run("config", "path")).stdout.trim()).toBe(sandbox.path("spool/config.json"));

    const keys = (await run("config", "keys")).stdout.split("\n").filter(Boolean);
    expect(keys).toContain("retention.retentionDays");
    expect(keys).toContain("capture.excludeGlobs");

    const listed = json<{ retention: { retentionDays: number; dryRun: boolean }; cloud: { retentionDays: number } }>(
      (await run("config", "list")).stdout,
    );
    expect(listed.retention.retentionDays).toBe(30);
    expect(listed.retention.dryRun).toBe(true);
    expect(listed.cloud.retentionDays).toBe(90);

    expect((await run("config", "get", "retention.retentionDays")).stdout.trim()).toBe("30");

    const set = await run("config", "set", "retention.retentionDays", "45");
    expect(set.code).toBe(0);
    expect((await run("config", "get", "retention.retentionDays")).stdout.trim()).toBe("45");
    // Written to the file, so a LATER process sees it.
    expect(json<{ retention: { retentionDays: number } }>((await run("config", "list")).stdout).retention.retentionDays).toBe(45);

    expect((await run("config", "unset", "retention.retentionDays")).code).toBe(0);
    expect((await run("config", "get", "retention.retentionDays")).stdout.trim()).toBe("30");

    expect((await run("config", "defaults")).stdout).toContain('"version": 1');
    expect((await run("config", "list")).stdout).toContain("maxTotalBytes");
  });

  test("config refuses an unknown key and an unsafe clock, and neither reaches the file", async () => {
    const unknown = await run("config", "set", "retention.everything", "true");
    expect(unknown.code).toBe(1);
    expect(unknown.stderr).toContain("unknown config key");

    const unsafe = await run("config", "set", "cloud.retentionDays", "1");
    expect(unsafe.code).toBe(1);
    expect(unsafe.stderr).toContain("cloud.retentionDays must be");
    expect((await run("config", "get", "cloud.retentionDays")).stdout.trim()).toBe("90");
  });

  test("config refusals lists the journal for the operator", async () => {
    await run("config", "set", "capture.maxEntryBytes", "4");
    const big = sandbox.file("docs/paper.txt", "a document much longer than four bytes");
    await run("--json", "put", big);

    const refusals = await run("--json", "config", "refusals");
    expect(refusals.code).toBe(0);
    const records = json<{ reason: string; absoluteTarget: string; deleted: boolean }[]>(refusals.stdout);
    expect(records[0]!.reason).toBe("too_large");
    expect(records[0]!.absoluteTarget).toBe(big);
    expect(records[0]!.deleted).toBe(false);
  });

  test("sweep is a dry run by default and says so", async () => {
    await run("--json", "put", sandbox.file("old.txt", "old"));

    const sweep = await run("--json", "sweep");
    expect(sweep.code).toBe(0);
    const report = json<{ applied: boolean; deleted: unknown[]; plan: { steps: unknown[] } }>(sweep.stdout);
    expect(report.applied).toBe(false);
    expect(report.deleted).toHaveLength(0);
    // Nothing is evictable without a verifier, and the plan says why rather
    // than leaving the entry unmentioned.
    expect(report.plan.steps.length).toBeGreaterThan(0);

    expect((await run("sweep")).stdout).toContain("dry run — pass --apply to act");
  });
});

describe("dispatch and exit codes", () => {
  test("--version and --help", async () => {
    expect((await run("--version")).stdout.trim()).toBe("0.0.0");
    const help = await run("--help");
    expect(help.code).toBe(0);
    expect(help.stdout).toContain("usage: trash");
    expect(help.stdout).toContain("2 refused");
  });

  test("no verb at all is a usage error (exit 1)", async () => {
    const none = await run();
    expect(none.code).toBe(1);
  });

  test("an unknown verb and an unknown flag are usage errors", async () => {
    const verb = await run("obliterate", "/tmp/whatever");
    expect(verb.code).toBe(1);
    expect(verb.stderr).toContain("unknown verb obliterate");

    const flag = await run("--spool-typo", "list");
    expect(flag.code).toBe(1);
    expect(flag.stderr).toContain("unknown global flag");
  });

  test("a conflicting mode FAILS CLOSED rather than falling back to local-only", async () => {
    // A configured authority plus a local flag: the local-only arm is the one
    // arm allowed to expire un-uploaded payloads, so a credential mishap must
    // never reclassify a hosted instance into it (§5).
    const proc = Bun.spawn({
      cmd: ["bun", CLI, "--spool", sandbox.path("spool"), "status"],
      env: { ...spawnEnv(sandbox), HASNA_TRASH_API_URL: "https://trash.example.invalid", HASNA_TRASH_LOCAL: "1" },
      cwd: sandbox.root,
      stdout: "pipe",
      stderr: "pipe",
    });
    const [code, , stderr] = await Promise.all([proc.exited, new Response(proc.stdout).text(), new Response(proc.stderr).text()]);

    expect(code).toBe(1);
    expect(stderr).toContain("mode conflict");
  });

  test("--spool keeps every root inside the given directory", async () => {
    // The guard's contract: a rewritten command carries ONE absolute path, and
    // the store it writes to must be that path and nothing else.
    const file = sandbox.file("spooled.txt", "bytes");
    const id = json<{ entryId: string }[]>((await run("--json", "put", file)).stdout)[0]!.entryId!;

    const spool = sandbox.path("spool");
    expect(existsSync(`${spool}/files/${id}`)).toBe(true);
    expect(readdirSync(`${spool}/info`)).toEqual([`${id}.json`]);
    expect(readFileSync(`${spool}/files/${id}`, "utf8")).toBe("bytes");
    // The real user store is untouched: testEnv pointed HOME into the sandbox,
    // and the spool override means not even that home was used.
    expect(existsSync(`${sandbox.path("home")}/.hasna/trash`)).toBe(false);
  });
});
