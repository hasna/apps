/** Test-only process supervisor. Never launches a recording program. */
import { chmodSync, closeSync, constants, existsSync, fstatSync, fsyncSync, lstatSync, mkdtempSync, openSync, readSync, realpathSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, isAbsolute, join, resolve } from "node:path";
import { signingFixtureCommand } from "../src/__tests__/helpers/signing-fixture";
const repository = resolve(import.meta.dir, "..");
const reportArgs = process.argv.slice(2);
if (reportArgs.length !== 0 && !(reportArgs.length === 2 && reportArgs[0] === "--junit-output" && reportArgs[1] && isAbsolute(reportArgs[1]))) throw new Error("Only an absolute --junit-output is supported");
const destination = reportArgs[1];
if (destination) {
  const parent = dirname(destination), metadata = lstatSync(parent);
  if (resolve(destination) !== destination || realpathSync(parent) !== parent || !metadata.isDirectory() || metadata.isSymbolicLink() ||
      metadata.uid !== process.getuid?.() || (metadata.mode & 0o777) !== 0o700 || existsSync(destination)) {
    throw new Error("JUnit output requires a new path in a canonical owned private directory");
  }
  try { lstatSync(destination); throw new Error("JUnit output already exists"); } catch (error) { if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error; }
}
const root = realpathSync(mkdtempSync(join(tmpdir(), "recordings-recorder-suite-")));
chmodSync(root, 0o700);
const report = join(root, "junit.xml");
let child: ReturnType<typeof Bun.spawn> | undefined;
let timer: ReturnType<typeof setTimeout> | undefined;
try {
  // Independent OS control: even bypassing the preload cannot execute a live capture or host tool.
  if (process.platform === "darwin") {
    for (const tool of ["/usr/bin/open", "/usr/bin/codesign", "/usr/bin/security", "/usr/bin/defaults"]) {
      const probe = Bun.spawnSync(signingFixtureCommand(root, ["/bin/bash", "-c", '"$1" --help', "probe", tool]), { env: { HOME: root, TMPDIR: root, PATH: "/usr/bin:/bin" }, stdout: "pipe", stderr: "pipe" });
      if (probe.exitCode === 0 || !probe.stderr.toString().includes("Operation not permitted")) throw new Error("recorder OS process boundary failed");
    }
    const rec = Bun.which("rec");
    if (rec) {
      const probe = Bun.spawnSync(signingFixtureCommand(root, ["/bin/bash", "-c", '"$1" --help', "probe", rec]), { env: { HOME: root, TMPDIR: root, PATH: "/usr/bin:/bin" }, stdout: "pipe", stderr: "pipe" });
      if (probe.exitCode === 0 || !probe.stderr.toString().includes("Operation not permitted")) throw new Error("recorder OS microphone program boundary failed");
    }
  }
  child = Bun.spawn(signingFixtureCommand(root, [process.execPath, "test", "--preload", join(repository, "src/__tests__/helpers/recorder-process-fixture.ts"), "src/__tests__/recorder.test.ts", ...(reportArgs.length ? ["--reporter=junit", `--reporter-outfile=${report}`] : [])]), {
    cwd: repository, env: { HOME: root, TMPDIR: root, PATH: "/usr/bin:/bin", HASNA_RECORDINGS_LOCAL: "1" },
    detached: true, stdout: "inherit", stderr: "inherit",
  });
  timer = setTimeout(() => { if (child?.exitCode === null) { try { process.kill(-child.pid, "SIGKILL"); } catch {} } }, 30000);
  const status = await child.exited;
  clearTimeout(timer); timer = undefined;
  if (destination && existsSync(report)) {
    const source = openSync(report, constants.O_RDONLY | constants.O_NOFOLLOW);
    try {
      const metadata = fstatSync(source);
      if (!metadata.isFile() || metadata.size > 32 * 1024 * 1024) throw new Error("JUnit source is not a bounded regular file");
      const bytes = Buffer.alloc(metadata.size);
      let offset = 0;
      while (offset < bytes.byteLength) {
        const count = readSync(source, bytes, offset, bytes.byteLength - offset, offset);
        if (count === 0) throw new Error("JUnit source changed during export");
        offset += count;
      }
      if (readSync(source, Buffer.alloc(1), 0, 1, offset) !== 0) throw new Error("JUnit source changed during export");
      const output = openSync(destination, constants.O_WRONLY | constants.O_CREAT | constants.O_EXCL | constants.O_NOFOLLOW, 0o600);
      try { writeFileSync(output, bytes); fsyncSync(output); } finally { closeSync(output); }
    } finally { closeSync(source); }
  }
  process.exitCode = status;
} finally {
  if (timer) clearTimeout(timer);
  if (child?.exitCode === null) { try { process.kill(-child.pid, "SIGKILL"); } catch {} await child.exited; }
  rmSync(root, { recursive: true, force: true });
}
