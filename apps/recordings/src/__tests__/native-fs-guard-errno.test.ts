import { expect, test } from "bun:test";
import { chmodSync, cpSync, mkdirSync, mkdtempSync, readFileSync, realpathSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { confinedShellCommand } from "./helpers/confined-shell-fixture";

const packageRoot = resolve(import.meta.dir, "../..");

function fixtureCommand(root: string, command: string[], tools: string[] = []): string[] {
  const confined = confinedShellCommand(root, command, tools);
  if (process.platform === "darwin") {
    // The release runner deliberately changes HOME. Keep the real host paths
    // denied as well as the synthetic home covered by the shared helper.
    confined[2] += `\n(deny mach-lookup)
(deny file-read* (subpath "/Library/Keychains")
  (regex #"^/Users/[^/]+/Applications(/|$)")
  (regex #"^/Users/[^/]+/Library/(Keychains|Preferences|Application Support/com.apple.TCC)(/|$)")
  (regex #"^/Users/[^/]+/[.]hasna/recordings(/|$)"))`;
  }
  return confined;
}

/** Compile a test translation unit, never change/load the packaged addon. Native
 * execution happens only in the confined child, after its actual OS probes. */
function directoryFixture(kind: "normal" | "append-errno" | "append-errno-before-fix" | "read-error") {
  const parent = realpathSync(mkdtempSync(join(tmpdir(), "recordings-dir-errno-")));
  const root = join(parent, "fixture"), outside = join(parent, "outside");
  mkdirSync(root, { mode: 0o700 }); mkdirSync(outside, { mode: 0o700 });
  mkdirSync(join(root, "tmp"), { mode: 0o700 });
  mkdirSync(join(root, "home"), { mode: 0o700 });
  const env = { HOME: join(root, "home"), TMPDIR: join(root, "tmp") + "/",
    PATH: "/usr/bin:/bin:/usr/sbin:/sbin", BUN_RUNTIME_TRANSPILER_CACHE_PATH: join(root, "cache"),
    RECORDINGS_TEST_CONFINED_ROOT: root, FIXTURE_OUTSIDE: outside, FIXTURE_PARENT: String(process.pid) };
  try {
    const prefix = `#define _DARWIN_C_SOURCE 1
#define _GNU_SOURCE 1
#include <node_api.h>
#include <dirent.h>
#include <errno.h>
#include <unistd.h>
${kind.startsWith("append-errno") ? `
static napi_status fixture_set_element(napi_env env, napi_value object, uint32_t index, napi_value value) {
  napi_status status = napi_set_element(env, object, index, value);
  if (status == napi_ok) errno = EIO;
  return status;
}
#define napi_set_element fixture_set_element
` : kind === "read-error" ? `
static struct dirent *fixture_readdir(DIR *stream) {
  /* Invalidate the iterator's real descriptor before its first kernel read.
   * readdir itself must return EBADF; this does not synthesize its result. */
  if (close(dirfd(stream)) != 0) _exit(95);
#ifdef __APPLE__
  /* Darwin fdopendir may eagerly buffer the whole directory. Discard only
   * this fixture stream's cache so libc attempts the invalid kernel read. */
  stream->__dd_loc = stream->__dd_size = 0;
  stream->__dd_flags &= ~(__DTF_READALL | __DTF_SKIPREAD | __DTF_ATEND);
#endif
  struct dirent *entry = readdir(stream);
  if (entry != NULL || errno != EBADF) _exit(96);
  return entry;
}
#define readdir fixture_readdir
` : ""}
`;
    const source = join(root, "guard.c"), addon = join(root, "guard.node");
    let body = readFileSync(join(packageRoot, "scripts/native/recordings_fs_guard.c"), "utf8");
    if (kind === "append-errno-before-fix") {
      const protectedRead = `    errno = 0;
    struct dirent *entry = readdir(stream);`;
      expect(body.split(protectedRead)).toHaveLength(2);
      const loopStart = "  int saved_errno = 0;\n  for (;;) {";
      expect(body.split(loopStart)).toHaveLength(2);
      // Only the owned test translation unit reinstates the defect. The actual
      // N-API insertion still succeeds and the actual libc reaches clean EOF.
      body = body.replace(protectedRead, "    struct dirent *entry = readdir(stream);")
        .replace(loopStart, "  int saved_errno = 0;\n  errno = 0;\n  for (;;) {");
    }
    writeFileSync(source, prefix + body);
    cpSync(join(packageRoot, "node_modules/node-api-headers/include"), join(root, "include"), { recursive: true });
    const compiler = process.platform === "darwin"
      ? Bun.spawnSync(["/usr/bin/xcrun", "--find", "clang"]).stdout.toString().trim() : "/usr/bin/cc";
    expect(compiler.startsWith("/")).toBeTrue();
    const flags = process.platform === "darwin" ? ["-bundle", "-undefined", "dynamic_lookup", "-isysroot",
      realpathSync(Bun.spawnSync(["/usr/bin/xcrun", "--sdk", "macosx", "--show-sdk-path"]).stdout.toString().trim())] : ["-shared", "-fPIC"];
    const compile = Bun.spawnSync(fixtureCommand(root, [compiler, ...flags, "-std=c11", "-Wall", "-Wextra", "-Werror",
      "-DNAPI_VERSION=9", "-DNODE_GYP_MODULE_NAME=recordings_fs_guard", "-I", join(root, "include"), source, "-o", addon],
      [realpathSync(compiler), "/Library/Developer/CommandLineTools/usr/bin/ld"]), { cwd: root, env, timeout: 30_000 });
    expect(compile.exitCode, compile.stderr.toString()).toBe(0);
    chmodSync(addon, 0o700);
    mkdirSync(join(root, "entries"), { mode: 0o700 });
    writeFileSync(join(root, "entries", "fictional.txt"), "fictional fixture\n", { mode: 0o600 });
    writeFileSync(join(root, "run.ts"), `
import { createRequire } from 'node:module';
import { requirePublicationFixtureConfinement } from ${JSON.stringify(join(packageRoot, "src/__tests__/helpers/publication-fixture-confinement.ts"))};
requirePublicationFixtureConfinement();
const guard = createRequire(import.meta.url)(${JSON.stringify(addon)});
const home = guard.openTrustedHome(${JSON.stringify(root)}, process.getuid());
const directory = guard.openDirAt(home, 'entries');
try {
  const first = guard.readDir(directory);
  const second = guard.readDir(directory);
  console.log(JSON.stringify({first, second}));
} catch (error) { console.log(JSON.stringify({error: error.message, code: error.code})); }
finally { guard.close(directory); guard.close(home); }
`);
    const child = Bun.spawnSync(fixtureCommand(root, [process.execPath, join(root, "run.ts")]),
      { cwd: root, env, timeout: 15_000, stdout: "pipe", stderr: "pipe" });
    expect(child.exitCode, child.stderr.toString()).toBe(0);
    return JSON.parse(child.stdout.toString());
  } finally { rmSync(parent, { recursive: true, force: true }); }
}

test("native directory iteration keeps exact entries across repeated reads", () => {
  expect(directoryFixture("normal")).toEqual({ first: ["fictional.txt"], second: ["fictional.txt"] });
}, 60_000);

test("native directory EOF ignores errno left by successful N-API array insertion", () => {
  expect(directoryFixture("append-errno")).toEqual({ first: ["fictional.txt"], second: ["fictional.txt"] });
}, 60_000);

test("native directory errno control detects the pre-fix loop in an owned translation unit", () => {
  const result = directoryFixture("append-errno-before-fix");
  expect(result.error).toContain("read directory capability");
  expect(result.code).toBe("ERRNO_5");
}, 60_000);

test("native directory iteration still reports a real readdir descriptor failure", () => {
  const result = directoryFixture("read-error");
  expect(result.error).toContain("read directory capability");
  expect(result.error).toContain("Bad file descriptor");
  expect(result.code).toBe("ERRNO_9");
  expect(result).not.toHaveProperty("first");
}, 60_000);
