import { expect, test } from "bun:test";
import { createHash, randomUUID } from "node:crypto";
import { chmod, lstat, mkdir, mkdtemp, readFile, readdir, realpath, rm, stat, symlink, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { EnvAssignmentError, prepareEnvAssignment } from "./env-assignment.js";
import { useDefaultTestTimeout } from "../test-preload.js";

useDefaultTestTimeout();

const hash = (value: string | Buffer) => createHash("sha256").update(value).digest("hex");

test("literal env updates preserve unrelated lines, export spacing, comments, duplicate keys and CRLF", () => {
  const existing = '# Retain\r\nOTHER=before\r\n export QA_TARGET = old # note\r\nQA_TARGET="duplicate"\r\nTAIL=after';
  expect(prepareEnvAssignment("QA_TARGET=new=value==", existing)).toEqual({ key: "QA_TARGET",
    content: '# Retain\r\nOTHER=before\r\n export QA_TARGET = new=value== # note\r\nQA_TARGET=new=value==\r\nTAIL=after' });
  expect(prepareEnvAssignment("ADDED=", existing).content).toBe(existing + "\r\nADDED=\r\n");
  expect(prepareEnvAssignment("QA_TARGET=", "QA_TARGET=before\n").content).toBe("QA_TARGET=\n");
  expect(prepareEnvAssignment("QA_TARGET=simple", "").content).toBe("QA_TARGET=simple\n");
});

test("ambiguous existing records and unsupported assignments fail before content is produced", () => {
  for (const assignment of ["", "missing-equals", "=empty", "QA_.*=new", "QA_[=new", "1KEY=new", " A=new", "A =new",
    "QA_TARGET=line\nOTHER=injected", "QA_TARGET=line\rOTHER=injected", "QA_TARGET=control\x1b", "QA_TARGET=control\x00",
    "QA_TARGET=control\t", "QA_TARGET=separator\u2028", "QA_TARGET=odd\\", "QA_TARGET=all'\"`quotes", "QA_TARGET=one'`\\ntwo", "QA_TARGET=terminal\\$"]) {
    expect(() => prepareEnvAssignment(assignment, "OTHER=retained\n")).toThrow();
  }
  for (const existing of ['OTHER="first\nQA_TARGET=inside\nlast"\n', "OTHER='unterminated\n", "OTHER=`unterminated\n",
    "not-an-assignment\n", "OTHER='closed' trailing\n", "OTHER=bare\rcarriage\n", "OTHER=control\x00\n"]) {
    expect(() => prepareEnvAssignment("QA_TARGET=simple", existing)).toThrow("Cannot safely update .env");
  }
});

test("Bun dotenv preserves every accepted quote, backslash and dollar combination in a batched matrix", async () => {
  const root = await realpath(await mkdtemp(join(tmpdir(), "skills-env-matrix-")));
  const alphabet = ["a", "'", '"', "`", "\\", "$", "n", "r", " ", "#", "=", "é"];
  const cases: string[] = [];
  for (const first of alphabet) for (const second of alphabet) for (const third of alphabet) cases.push(first + second + third);
  cases.push("one'\\ntwo", "one'\\rtwo", "one'\\\\ntwo", "one'`\\ntwo", "one'`\\rtwo", "one'`\\ttwo", "aa$", "aa$$", "aa\\$", "aa\\$$", "aa\\\\$", "aa'\\$", "aa'`$", "aa'`\\$", "aa'\\\\n$", "aa'\\r$");
  try {
    const accepted: { key: string; expectedHash: string }[] = [];
    let content = "", rejected = 0;
    for (const [index, value] of cases.entries()) {
      const key = `QA_MATRIX_${index}`;
      try {
        content += prepareEnvAssignment(`${key}=${value}`, "").content;
        accepted.push({ key, expectedHash: hash(value) });
      } catch (error) { expect(error instanceof EnvAssignmentError).toBe(true); rejected++; }
    }
    expect(accepted.length).toBeGreaterThan(1000);
    expect(accepted.length + rejected).toBe(cases.length);
    const envFile = join(root, "matrix.env"), keysFile = join(root, "keys.json"), reader = join(root, "read.ts");
    await writeFile(envFile, content);
    await writeFile(keysFile, JSON.stringify(accepted.map(row => row.key)));
    await writeFile(reader, `import{createHash}from'node:crypto';import{readFileSync}from'node:fs';
      const keys=JSON.parse(readFileSync(process.argv[2],'utf8'));console.log(JSON.stringify(keys.map(key=>createHash('sha256').update(process.env[key]??'').digest('hex'))));\n`);
    const child = Bun.spawn([process.execPath, "--env-file", envFile, reader, keysFile], { cwd: root,
      env: { HOME: root, PATH: join(root, "empty-path") }, stdout: "pipe", stderr: "pipe" });
    const [stdout, stderr, exitCode] = await Promise.all([new Response(child.stdout).text(), new Response(child.stderr).text(), child.exited]);
    expect(exitCode).toBe(0); expect(stderr.length).toBe(0);
    const hashes = JSON.parse(stdout) as string[];
    expect(hashes.length).toBe(accepted.length);
    // Only case IDs are printed on failure; neither source values nor parsed values leave the fixture.
    expect(accepted.filter((row, index) => row.expectedHash !== hashes[index]).map(row => row.key)).toEqual([]);
  } finally { await rm(root, { recursive: true, force: true }); }
});

test("built CLI env assignment round-trips literal values and rejects unsafe writes without output leaks", async () => {
  const root = await realpath(await mkdtemp(join(tmpdir(), "skills-env-assignment-")));
  const project = join(root, "project"), bundle = join(root, "bundle"), home = join(root, "home"), data = join(root, "data");
  await Promise.all([project, bundle, home, data].map(path => mkdir(path)));
  const envFile = join(project, ".env"), guard = join(root, "network-guard.ts"), networkMarker = join(root, "network-attempt");
  const env = { HOME: home, HASNA_HOME: join(home, ".hasna"), XDG_CONFIG_HOME: join(home, ".config"), HASNA_SKILLS_DIR: data,
    SKILLS_DATA_DIR: data, HASNA_PROFILE: "env-assignment-owned", HASNA_STATION: "env-assignment-no-credential",
    HASNA_SKILLS_API_URL: "", SKILLS_API_URL: "", HASNA_SKILLS_API_KEY: "", SKILLS_API_KEY: "", HASNA_SKILLS_API_KEY_OVERRIDE: "",
    PATH: join(root, "empty-path"), NO_COLOR: "1", TERM: "dumb" };
  const run = async (args: string[]) => {
    const child = Bun.spawn(args, { cwd: project, env, stdout: "pipe", stderr: "pipe" });
    const timeout = setTimeout(() => child.kill(), 10_000);
    try {
      const [stdout, stderr, exitCode] = await Promise.all([new Response(child.stdout).text(), new Response(child.stderr).text(), child.exited]);
      return { stdout, stderr, exitCode };
    } finally { clearTimeout(timeout); }
  };
  try {
    const built = await Bun.build({ entrypoints: [join(import.meta.dir, "index.tsx")], outdir: bundle, target: "bun" });
    expect(built.success).toBe(true);
    await writeFile(guard, `import {writeFileSync} from 'node:fs'; const original=globalThis.fetch;globalThis.fetch=((input,init)=>{
      if(String(input).startsWith('data:'))return original(input,init);writeFileSync(${JSON.stringify(networkMarker)},'attempt');throw Error('Unexpected fixture network');}) as typeof fetch;\n`);
    const cli = (assignment: string, json = true, command = "env-check") => run([process.execPath, "--no-env-file", "--preload", guard,
      join(bundle, "index.js"), command, "--set", assignment, ...(json ? ["--json"] : [])]);
    const reader = join(root, "read-env.ts");
    await writeFile(reader, `import{createHash}from'node:crypto';console.log(JSON.stringify({hash:createHash('sha256').update(process.env.QA_TARGET??'').digest('hex'),unrelated:process.env.UNRELATED==='retained'}));\n`);
    const values = ["simple", "", "a=b==", " spaces ", "a#b", "a$b", "a${UNRELATED}", "a\\b", "a\\nb", "a\\$UNRELATED", "a\\\\$UNRELATED",
      "a\\\\", "a'b", 'a"b', "a`b", "a'\"b", "a$&b", "a$`b", "a$'b", "a$$b", "a${UNRELATED:-fallback}", "résumé",
      "one'\\ntwo", "one'\\rtwo", "one'\\ttwo", "one'\\\\ntwo", "one\"\\ntwo", "one'\"\\rtwo", "one'`dollar$",
      "aa$", "aa$$", "aa\\$$", "aa'\\\\n$", "aa'\\r$"];
    for (const [index, value] of values.entries()) {
      const before = "# Keep bytes\nUNRELATED=retained\nQA_TARGET=before\nAFTER=retained\n";
      await writeFile(envFile, before, { mode: 0o600 });
      await chmod(envFile, index % 2 === 0 ? 0o600 : 0o640);
      const beforeMode = (await stat(envFile)).mode;
      const actual = await cli(`QA_TARGET=${value}`, index % 2 === 0, index % 2 === 0 ? "env-check" : "check-env");
      expect(actual.exitCode).toBe(0);
      if (value.length > 4) expect((actual.stdout + actual.stderr).includes(value)).toBe(false);
      const content = await readFile(envFile, "utf8");
      expect(content.startsWith("# Keep bytes\nUNRELATED=retained\n")).toBe(true);
      expect(content.endsWith("\nAFTER=retained\n")).toBe(true);
      expect((await stat(envFile)).mode).toBe(beforeMode);
      const loaded = await run([process.execPath, "--env-file", envFile, reader]);
      expect(loaded.exitCode).toBe(0);
      // Compare digests so an assertion failure never prints the supplied value.
      expect(JSON.parse(loaded.stdout)).toEqual({ hash: hash(value), unrelated: true });
    }
    const canary = `dummy-${randomUUID()}`;
    const invalid = [canary, "", `=${canary}`, `QA_.*=${canary}`, `QA_[=${canary}`, `9KEY=${canary}`, ` QA_TARGET=${canary}`,
      `QA_TARGET=${canary}\nINJECTED=yes`, `QA_TARGET=${canary}\rINJECTED=yes`, `QA_TARGET=${canary}\t`,
      `QA_TARGET=${canary}\\`, `QA_TARGET=${canary}'\"\``, `QA_TARGET=${canary}'\`\\n`, `QA_TARGET=${canary}'\`\\r`,
      `QA_TARGET=${canary}\\$`, `QA_TARGET=${canary}\\\\$`, `QA_TARGET=${canary}'\\$`];
    for (const json of [true, false]) for (const assignment of invalid) {
      const before = "QA_TARGET_OTHER=retained\nQA_TARGET=before\nAFTER=retained\n";
      await writeFile(envFile, before);
      const info = await stat(envFile), actual = await cli(assignment, json), after = await stat(envFile);
      expect(actual.exitCode).toBe(1);
      expect((actual.stdout + actual.stderr).includes(canary)).toBe(false);
      if (json) expect(JSON.parse(actual.stdout).set).toBe(false);
      expect(hash(await readFile(envFile, "utf8"))).toBe(hash(before));
      expect([after.ino, after.mode, after.mtimeMs]).toEqual([info.ino, info.mode, info.mtimeMs]);
    }
    for (const before of ['UNRELATED="first\nQA_TARGET=inside\nlast"\n', "UNRELATED='unterminated\n", "unsupported-record\n"]) {
      await writeFile(envFile, before);
      const actual = await cli(`QA_TARGET=${canary}`);
      expect(actual.exitCode).toBe(1);
      expect((actual.stdout + actual.stderr).includes(canary)).toBe(false);
      expect(hash(await readFile(envFile, "utf8"))).toBe(hash(before));
    }
    const invalidUtf8 = Buffer.concat([Buffer.from("UNRELATED="), Buffer.from([0xff]), Buffer.from("\n")]);
    await writeFile(envFile, invalidUtf8);
    expect((await cli(`QA_TARGET=${canary}`)).exitCode).toBe(1);
    expect(hash(await readFile(envFile))).toBe(hash(invalidUtf8));
    await rm(envFile);
    expect((await cli(canary)).exitCode).toBe(1);
    expect(await readdir(project)).toEqual([]);
    expect((await cli("QA_TARGET=first")).exitCode).toBe(0);
    expect(hash(await readFile(envFile, "utf8"))).toBe(hash("QA_TARGET=first\n"));
    expect((await stat(envFile)).mode & 0o777).toBe(0o600);
    await rm(envFile);
    const otherFile = join(root, "other.env"), otherContent = "OTHER=owned-canary\n";
    await writeFile(otherFile, otherContent, { mode: 0o640 });
    const originalInfo = await stat(otherFile);
    for (const target of [otherFile, join(root, "missing.env")]) {
      await symlink(target, envFile);
      const actual = await cli(`QA_TARGET=${canary}`);
      expect(actual.exitCode).toBe(1);
      expect((actual.stdout + actual.stderr).includes(canary)).toBe(false);
      expect((await lstat(envFile)).isSymbolicLink()).toBe(true);
      expect(hash(await readFile(otherFile, "utf8"))).toBe(hash(otherContent));
      const after = await stat(otherFile);
      expect([after.ino, after.mode, after.mtimeMs]).toEqual([originalInfo.ino, originalInfo.mode, originalInfo.mtimeMs]);
      await rm(envFile);
    }
    expect((await readdir(root)).includes("missing.env")).toBe(false);
    await mkdir(envFile);
    expect((await cli(`QA_TARGET=${canary}`)).exitCode).toBe(1);
    expect(await readdir(envFile)).toEqual([]);
    await rm(envFile, { recursive: true });
    // A FIFO must be refused before opening it, without waiting for a reader.
    const fifo = Bun.spawn(["/usr/bin/mkfifo", envFile], { env, stdout: "pipe", stderr: "pipe" });
    expect(await fifo.exited).toBe(0);
    expect((await cli(`QA_TARGET=${canary}`)).exitCode).toBe(1);
    expect((await lstat(envFile)).isFIFO()).toBe(true);
    expect(await readdir(project)).toEqual([".env"]);
    expect(await readdir(data)).toEqual([]);
    expect(await readdir(home)).toEqual([]);
    expect((await readdir(root)).includes("network-attempt")).toBe(false);
  } finally { await rm(root, { recursive: true, force: true }); }
}, 90_000);
