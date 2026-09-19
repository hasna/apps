import { useDefaultTestTimeout } from "../test-preload.js";
useDefaultTestTimeout();
import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { chmodSync, chownSync, copyFileSync, mkdirSync, mkdtempSync, readFileSync, rmSync, statSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createHash } from "node:crypto";
import { packSkillBundle } from "../lib/skill-bundle.js";
import { digestInput } from "../sdk/execution/admission.js";
import { executeRuntimeWork, type RuntimeWork } from "./runtime-worker.js";
import { PURE_DESCRIPTOR_DIGEST, PURE_LIMITS } from "./runtime-pure-contract.js";

// Compile the real boundary, with synthetic probes only. Root-only tests are
// intended for the Linux runtime image; this suite never invokes sudo itself.
const linux = process.platform === "linux";
const compiler = linux ? Bun.which("cc") : null;
const root = process.getuid?.() === 0;
let directory = "";
let guard = "";
let probe = "";
let bun = "";
const source = String.raw`
#define _GNU_SOURCE
#include <errno.h>
#include <fcntl.h>
#include <linux/sched.h>
#include <signal.h>
#include <stdio.h>
#include <stdlib.h>
#include <string.h>
#include <sys/prctl.h>
#include <sys/resource.h>
#include <sys/socket.h>
#include <sys/syscall.h>
#include <sys/wait.h>
#include <unistd.h>
int main(int argc, char **argv) {
 if (argc < 2) return 2;
 if (!strcmp(argv[1], "inherited")) {
  int fd = open("/dev/null", O_RDONLY);
  if (fd < 0 || dup2(fd, 256) != 256) return 3;
  execl(argv[2], argv[2], "--pure", argv[0], "inspect", NULL);
  return 4;
 }
 if (!strcmp(argv[1], "ignored-child-signal")) {
  signal(SIGCHLD, SIG_IGN);
  execl(argv[2], argv[2], "--pure", argv[0], "orphan", NULL);
  return 4;
 }
 if (!strcmp(argv[1], "pending-stop")) {
  sigset_t mask; sigemptyset(&mask); sigaddset(&mask, SIGTERM);
  if (sigprocmask(SIG_BLOCK, &mask, NULL) || raise(SIGTERM)) return 3;
  execl(argv[2], argv[2], "--pure", argv[0], "cpu", NULL);
  return 4;
 }
 if (!strcmp(argv[1], "namespace")) {
  unsigned long flags[] = {CLONE_NEWUSER, CLONE_NEWPID, CLONE_NEWNET, CLONE_NEWNS, CLONE_NEWCGROUP, CLONE_NEWUTS, CLONE_NEWIPC};
  int denied = 0;
  for (unsigned int i = 0; i < sizeof(flags)/sizeof(flags[0]); i++) {
   errno = 0;
   long result = syscall(SYS_clone, flags[i] | SIGCHLD, 0, 0, 0, 0);
   if (result == -1 && errno == EPERM) denied++;
   if (result == 0) _exit(99);
   if (result > 0) waitpid((pid_t)result, NULL, 0);
  }
  struct clone_args args = {0};
  args.flags = CLONE_NEWUSER | CLONE_NEWPID;
  args.exit_signal = SIGCHLD;
  errno = 0;
  long result = syscall(SYS_clone3, &args, sizeof(args));
  int fallback = result == -1 && errno == ENOSYS;
  if (result == 0) _exit(99);
  if (result > 0) waitpid((pid_t)result, NULL, 0);
  printf("{\"namespaceFlagsDenied\":%d,\"clone3Fallback\":%d}\n", denied, fallback);
  return 0;
 }
 if (!strcmp(argv[1], "launch")) {
  pid_t child = fork();
  if (child < 0) return 3;
  if (!child) { execl(argv[2], argv[2], "--pure", argv[0], "descendants", NULL); return 4; }
  for (;;) pause();
 }
 if (!strcmp(argv[1], "inspect")) {
  struct rlimit cpu, file, core;
  getrlimit(RLIMIT_CPU, &cpu); getrlimit(RLIMIT_FSIZE, &file); getrlimit(RLIMIT_CORE, &core);
  errno = 0; int sock = socket(AF_INET, SOCK_STREAM, 0); int socket_error = errno;
  int pair[2]; errno = 0; int pairs = socketpair(AF_UNIX, SOCK_STREAM, 0, pair); int pair_error = errno;
  errno = 0; int fd = fcntl(256, F_GETFD); int fd_error = errno;
  errno = 0; int session = setsid(); int session_error = errno;
  errno = 0; int group = setpgid(0, 0); int group_error = errno;
  printf("{\"uid\":%u,\"gid\":%u,\"noNewPrivileges\":%d,\"cpu\":%lu,\"file\":%lu,\"core\":%lu,\"socketDenied\":%d,\"socketpairDenied\":%d,\"highFdClosed\":%d,\"sessionDenied\":%d,\"groupDenied\":%d}\n",
   getuid(), getgid(), prctl(PR_GET_NO_NEW_PRIVS, 0, 0, 0, 0), (unsigned long)cpu.rlim_max, (unsigned long)file.rlim_max, (unsigned long)core.rlim_max,
   sock == -1 && socket_error == EPERM, pairs == -1 && pair_error == EPERM, fd == -1 && fd_error == EBADF,
   session == -1 && session_error == EPERM, group == -1 && group_error == EPERM);
  return 0;
 }
 if (!strcmp(argv[1], "descendants") || !strcmp(argv[1], "orphan")) {
  pid_t child = fork();
  if (child < 0) return 3;
  if (!child) { for (;;) pause(); }
  printf("{\"pid\":%d,\"child\":%d,\"guard\":%d}\n", getpid(), child, getppid()); fflush(stdout);
  if (!strcmp(argv[1], "orphan")) return 7;
  for (;;) pause();
 }
 if (!strcmp(argv[1], "file")) {
  int fd = open(argv[2], O_WRONLY | O_CREAT, 0600);
  if (fd < 0) return 3;
  char data[1024] = {0};
  for (int i = 0; i < 100; i++) if (write(fd, data, sizeof(data)) < 0) return 4;
  return 0;
 }
 if (!strcmp(argv[1], "cpu")) { for (;;) {} }
 return 2;
}
`;

beforeAll(() => {
  if (!compiler) return;
  directory = mkdtempSync(join(tmpdir(), "skills-runtime-guard-"));
  chmodSync(directory, 0o755);
  guard = join(directory, "guard");
  probe = join(directory, "probe");
  writeFileSync(join(directory, "probe.c"), source);
  for (const [input, output] of [
    [new URL("../../runtime/guard.c", import.meta.url).pathname, guard],
    [join(directory, "probe.c"), probe],
  ]) {
    const result = Bun.spawnSync([compiler, "-O2", "-Wall", "-Wextra", "-Werror", input!, "-o", output!]);
    expect(result.stderr.toString()).toBe("");
    expect(result.exitCode).toBe(0);
  }
  if (root) {
    // The developer's Bun binary can live beneath a private home directory.
    bun = join(directory, "bun");
    copyFileSync(process.execPath, bun);
    chmodSync(bun, 0o755);
  }
});
afterAll(() => { if (directory) rmSync(directory, { recursive: true, force: true }); });

function alive(pid: number): boolean {
  try {
    // A reparented zombie has already stopped and cannot execute or hold FDs.
    return !/\) Z /.test(readFileSync(`/proc/${pid}/stat`, "utf8"));
  } catch { return false; }
}
async function stopped(pids: number[]) {
  const deadline = Date.now() + 2_000;
  while (pids.some(alive) && Date.now() < deadline) await Bun.sleep(20);
  for (const pid of pids) expect(alive(pid)).toBe(false);
}
async function firstLine(stream: ReadableStream<Uint8Array>): Promise<{ pid: number; child: number; guard: number }> {
  const reader = stream.getReader();
  let value = "";
  try {
    while (!value.includes("\n")) {
      const next = await reader.read();
      if (next.done) throw Error("Probe exited before reporting its owned processes");
      value += new TextDecoder().decode(next.value);
    }
    return JSON.parse(value.split("\n")[0]!);
  } finally { reader.releaseLock(); }
}
function work(source: string, input = { pattern: "--mode=\u0000", text: "before--mode=\u0000after", flags: "g" }): RuntimeWork {
  const bundleRoot = mkdtempSync(join(directory, "bundle-"));
  mkdirSync(join(bundleRoot, "src"));
  writeFileSync(join(bundleRoot, "src/index.ts"), source);
  writeFileSync(join(bundleRoot, "package.json"), JSON.stringify({ name: "synthetic-pure", version: "1.0.0", dependencies: {} }));
  writeFileSync(join(bundleRoot, "skill.json"), JSON.stringify({ kind: "executable", runtime: { runtime: "bun", entrypoint: "src/index.ts", env: [] } }));
  const bundle = packSkillBundle(bundleRoot);
  return {
    bundleBase64: Buffer.from(bundle.bytes).toString("base64"), input,
    admission: {
      contractVersion: 1, runId: "synthetic-pure-run", tenantId: "synthetic-tenant", skillId: "synthetic-pure", skillVersion: "1.0.0",
      bundleDigest: bundle.sha256, runtimeImageDigest: "sha256:" + "a".repeat(64), dependencyLayerTag: null,
      runtime: "bun", inputDigest: digestInput(input), idempotencyKey: "synthetic-pure-key", createdAt: new Date().toISOString(),
      policy: { egress: "deny", egressAllowlist: [], networkByteCap: 0 }, limits: { ...PURE_LIMITS },
      executionContract: { id: "regex-test.v1", descriptorDigest: PURE_DESCRIPTOR_DIGEST, entrypoint: "src/index.ts", entrypointDigest: createHash("sha256").update(source).digest("hex") },
    },
  };
}

describe.skipIf(!compiler)("compiled Linux runtime boundary", () => {
  test.skipIf(root)("refuses to run without the privilege needed for identity separation", () => {
    expect(Bun.spawnSync([guard, "--pure", probe, "inspect"]).exitCode).toBe(125);
  });
  test.skipIf(!root)("pure mode enforces identity, no egress, limits and closes descriptors above the lowered limit", () => {
    const result = Bun.spawnSync([probe, "inherited", guard]);
    expect(result.exitCode).toBe(0);
    expect(JSON.parse(result.stdout.toString())).toEqual({
      uid: 65534, gid: 65534, noNewPrivileges: 1, cpu: 5, file: 16384, core: 0,
      socketDenied: 1, socketpairDenied: 1, highFdClosed: 1, sessionDenied: 1, groupDenied: 1,
    });
  });
  test.skipIf(!root)("preserves the existing PDF resource limits and egress boundary", () => {
    const result = Bun.spawnSync([guard, probe, "inspect"]);
    expect(result.exitCode).toBe(0);
    expect(JSON.parse(result.stdout.toString())).toMatchObject({
      uid: 65534, gid: 65534, noNewPrivileges: 1, cpu: 60, file: 2_000_000, core: 0,
      socketDenied: 1, socketpairDenied: 1,
    });
  });
  test.skipIf(!root)("refuses every namespace clone flag and forces clone3 through the inspected legacy syscall", () => {
    const result = Bun.spawnSync([guard, "--pure", probe, "namespace"]);
    expect(result.exitCode).toBe(0);
    expect(JSON.parse(result.stdout.toString())).toEqual({ namespaceFlagsDenied: 7, clone3Fallback: 1 });
  });
  test.skipIf(!root)("runs plain Bun with the unprivileged identity and an explicit environment", () => {
    const result = Bun.spawnSync([guard, "--pure", bun, "-e", 'console.log(JSON.stringify({uid:process.getuid(),matches:"caaab".match(/a+/g), credential:process.env.RUNTIME_GUARD_TEST_ONLY??null}))'], {
      env: { PATH: "/usr/bin:/bin", HOME: directory, TMPDIR: directory, LANG: "C.UTF-8" },
    });
    expect(result.exitCode).toBe(0);
    expect(JSON.parse(result.stdout.toString())).toEqual({ uid: 65534, matches: ["aaa"], credential: null });
  });
  test.skipIf(!root)("Bun Workers either complete or fail within the same bounded process boundary", async () => {
    // Worker support varies by Bun image/architecture. A bounded failure is not
    // evidence that a Worker-dependent package is eligible for admission; the
    // exact image still needs its own successful compatibility proof. In either
    // case no socket filter is relaxed and the owned process must be gone.
    const worker = join(directory, "worker.js");
    const entrypoint = join(directory, "worker-entry.js");
    writeFileSync(worker, 'postMessage({matches: "caaab".match(/a+/g), credential: process.env.RUNTIME_GUARD_TEST_ONLY ?? null});');
    writeFileSync(entrypoint, 'console.log(JSON.stringify({pid:process.pid})); const worker = new Worker(new URL("./worker.js", import.meta.url)); worker.onmessage = ({data}) => {console.log(JSON.stringify(data)); worker.terminate();}; worker.onerror = () => process.exit(1);');
    const started = Date.now();
    const result = Bun.spawn([guard, "--pure", bun, entrypoint], {
      stdout: "pipe", stderr: "pipe",
      env: { PATH: "/usr/bin:/bin", HOME: directory, TMPDIR: directory, LANG: "C.UTF-8" },
    });
    const [stdout, , status] = await Promise.all([
      new Response(result.stdout).text(), new Response(result.stderr).text(), result.exited,
    ]);
    const lines = stdout.trim().split("\n");
    const pid = (JSON.parse(lines[0]!) as { pid: number }).pid;
    expect(pid).toBeGreaterThan(1);
    expect(Date.now() - started).toBeLessThan(6_500);
    if (status === 0) expect(JSON.parse(lines[1]!)).toEqual({ matches: ["aaa"], credential: null });
    else expect(status).toBeGreaterThan(0);
    await stopped([pid]);
  });
  test.skipIf(!root)("the kernel stops regular-file output at sixteen KiB", () => {
    const output = join(directory, "output");
    mkdirSync(output);
    chmodSync(output, 0o700);
    chownSync(output, 65534, 65534);
    const filename = join(output, "bounded");
    const result = Bun.spawnSync([guard, "--pure", probe, "file", filename]);
    expect(result.exitCode).not.toBe(0);
    expect(statSync(filename).size).toBe(16_384);
  });
  test.skipIf(!root)("the complete pure worker preserves option-like and NUL input without credentials or PDF dependencies", async () => {
    const invocation = work(`import {existsSync} from "node:fs";
      const input = JSON.parse(process.env.SKILLS_INPUT_JSON!);
      if (process.env.RUNTIME_GUARD_TEST_ONLY || process.env.SKILLS_RUNTIME_TOKEN || existsSync("node_modules") || input.format !== "json" || process.argv.length !== 2) process.exit(1);
      const matches = Array.from(input.text.matchAll(new RegExp(input.pattern,input.flags)), m => ({match:m[0], groups:m.slice(1),namedGroups:m.groups??null,index:m.index}));
      console.log(JSON.stringify({pattern:input.pattern,flags:input.flags,matches}));`);
    const previous = process.env.RUNTIME_GUARD_TEST_ONLY;
    const previousToken = process.env.SKILLS_RUNTIME_TOKEN;
    process.env.RUNTIME_GUARD_TEST_ONLY = "synthetic-ambient-canary";
    process.env.SKILLS_RUNTIME_TOKEN = "test";
    try {
      const result = await executeRuntimeWork(invocation, { dependenciesPath: directory, executable: bun, guardPath: guard });
      expect(result.exitCode).toBe(0);
      expect(result.artifacts).toEqual([]);
      expect(JSON.parse(result.stdout)).toEqual({ pattern: "--mode=\u0000", flags: "g", matches: [{ match: "--mode=\u0000", groups: [], namedGroups: null, index: 6 }] });
    } finally {
      if (previous === undefined) delete process.env.RUNTIME_GUARD_TEST_ONLY;
      else process.env.RUNTIME_GUARD_TEST_ONLY = previous;
      if (previousToken === undefined) delete process.env.SKILLS_RUNTIME_TOKEN;
      else process.env.SKILLS_RUNTIME_TOKEN = previousToken;
    }
  });
  test.skipIf(!root)("the complete pure worker stops output floods and their owned descendants before rejecting", async () => {
    const reports = join(directory, "reports");
    mkdirSync(reports);
    chmodSync(reports, 0o700);
    chownSync(reports, 65534, 65534);
    const report = join(reports, "owned-pids.json");
    const invocation = work(`import {writeFileSync} from "node:fs";
      const child = Bun.spawn([process.execPath,"-e","setInterval(()=>{},1000)"], {stdout:"ignore",stderr:"ignore"});
      writeFileSync(${JSON.stringify(report)},JSON.stringify([process.pid,child.pid]));
      process.stdout.write("x".repeat(32768)); setInterval(()=>{},1000);`);
    const started = Date.now();
    await expect(executeRuntimeWork(invocation, { dependenciesPath: directory, executable: bun, guardPath: guard })).rejects.toThrow("Runtime log limit exceeded");
    expect(Date.now() - started).toBeLessThan(6_500);
    await stopped(JSON.parse(readFileSync(report, "utf8")) as number[]);
  });
  test.skipIf(!root)("cleans surviving descendants when the entrypoint returns", async () => {
    const result = Bun.spawn([guard, "--pure", probe, "orphan"], { stdout: "pipe", stderr: "pipe" });
    const pids = await firstLine(result.stdout);
    expect(await result.exited).toBe(7);
    await stopped([pids.pid, pids.child]);
  });
  test.skipIf(!root)("retains ownership of the leader PID even if its caller ignored child signals", async () => {
    const result = Bun.spawn([probe, "ignored-child-signal", guard], { stdout: "pipe", stderr: "pipe" });
    const pids = await firstLine(result.stdout);
    expect(await result.exited).toBe(7);
    await stopped([pids.pid, pids.child]);
  });
  test.skipIf(!root)("cleans all owned descendants when the supervisor requests cancellation", async () => {
    const result = Bun.spawn([guard, "--pure", probe, "descendants"], { stdout: "pipe", stderr: "pipe" });
    const pids = await firstLine(result.stdout);
    result.kill("SIGTERM");
    expect(await result.exited).toBe(124);
    await stopped([pids.pid, pids.child]);
  });
  test.skipIf(!root)("handles a cancellation already pending before guard startup without blocking", async () => {
    const started = Date.now();
    const result = Bun.spawn([probe, "pending-stop", guard], { stdout: "pipe", stderr: "pipe" });
    expect(await result.exited).toBe(124);
    expect(Date.now() - started).toBeLessThan(2_000);
  });
  test.skipIf(!root)("cleans all owned descendants when its supervisor dies", async () => {
    const result = Bun.spawn([probe, "launch", guard], { stdout: "pipe", stderr: "pipe" });
    const pids = await firstLine(result.stdout);
    result.kill("SIGKILL");
    await result.exited;
    await stopped([pids.guard, pids.pid, pids.child]);
  });
  test.skipIf(!root)("enforces the pure wall deadline independently of its supervisor", async () => {
    const started = Date.now();
    const result = Bun.spawn([guard, "--pure", probe, "descendants"], { stdout: "pipe", stderr: "pipe" });
    const pids = await firstLine(result.stdout);
    expect(await result.exited).toBe(124);
    expect(Date.now() - started).toBeLessThan(6_500);
    await stopped([pids.pid, pids.child]);
  }, 10_000);
});
