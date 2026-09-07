import { lstatSync, realpathSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";

let verified = false;

/** These tests include in-process native filesystem calls, so confine the whole test
 * runner. An environment marker alone is insufficient: exercise the OS boundary. */
export function requirePublicationFixtureConfinement(): void {
  if (process.platform !== "darwin" || verified) return;
  const root = process.env.RECORDINGS_TEST_CONFINED_ROOT;
  const outside = process.env.FIXTURE_OUTSIDE;
  const parent = Number(process.env.FIXTURE_PARENT);
  if (!root || !outside || !Number.isSafeInteger(parent) || parent <= 1 || parent === process.pid) {
    throw new Error("Run these Darwin fixtures with helpers/run-publication-fixtures.py --bun <pinned Bun>");
  }
  for (const path of [root, outside]) {
    const details = lstatSync(path);
    if (!details.isDirectory() || details.isSymbolicLink() || realpathSync(path) !== path ||
        details.uid !== process.getuid?.() || (details.mode & 0o777) !== 0o700) {
      throw new Error("Confinement roots must be owned canonical private directories");
    }
  }
  if (dirname(root) !== dirname(outside) || root === outside ||
      !realpathSync(tmpdir()).startsWith(`${root}/`)) {
    throw new Error("Confinement requires distinct sibling probe and fixture roots");
  }
  const canary = join(outside, `denied-write-${process.pid}`);
  let deniedWrite = false;
  let deniedExec = false;
  let deniedSignal = false;
  try { writeFileSync(canary, "fixture boundary probe", { flag: "wx" }); }
  catch (error) { deniedWrite = ["EPERM", "EACCES"].includes((error as NodeJS.ErrnoException).code ?? ""); }
  if (!deniedWrite) rmSync(canary, { force: true });
  // `help` cannot change preferences even if a broken profile allowed execution.
  try { Bun.spawnSync(["/usr/bin/defaults", "help"], { stdout: "ignore", stderr: "ignore" }); }
  catch (error) { deniedExec = ["EPERM", "EACCES"].includes((error as NodeJS.ErrnoException).code ?? ""); }
  // Signal zero probes permission; it does not send a signal to the outside parent.
  try { process.kill(parent, 0); }
  catch (error) { deniedSignal = (error as NodeJS.ErrnoException).code === "EPERM"; }
  process.kill(process.pid, 0);
  if (!deniedWrite || !deniedExec || !deniedSignal) throw new Error("OS confinement controls failed");
  const allowed = join(root, `allowed-write-${process.pid}`);
  writeFileSync(allowed, "fixture write allowed", { flag: "wx" });
  rmSync(allowed);
  verified = true;
}
