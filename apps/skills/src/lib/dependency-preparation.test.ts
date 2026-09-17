import { afterEach, describe, expect, test } from "bun:test";
import { chmodSync, existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, symlinkSync, writeFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { tmpdir } from "node:os";
import { useDefaultTestTimeout } from "../test-preload.js";

useDefaultTestTimeout();
const roots: string[] = [];
afterEach(() => { for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true }); });
const packageRoot = resolve(import.meta.dir, "..");

type Mode = "success" | "nonzero" | "missing" | "timeout" | "readonly" | "spawn" | "lifecycle-timeout" | "pending" | "malformed" | "symlink";
async function scenario(mode: Mode, surface: "library" | "cli" = "library", retry = false, repair = false) {
  const root = mkdtempSync(join(tmpdir(), "skills-preparation-"));
  roots.push(root);
  const home = join(root, "home"), corpus = join(root, "data", "installed", "preparation-probe");
  const project = join(root, "project"), cache = join(root, "cache"), temporary = join(root, "tmp");
  for (const path of [home, corpus, project, cache, temporary]) mkdirSync(path, { recursive: true });
  const marker = join(root, "entry"), prepared = join(root, "prepared"), descendant = join(root, "descendant");
  const requests: string[] = [];
  const registry = Bun.serve({ hostname: "127.0.0.1", port: 0, fetch(request) {
    requests.push(new URL(request.url).pathname);
    if (mode === "timeout") return new Promise<Response>(() => {});
    return Response.json({ error: "owned missing dependency" }, { status: 404 });
  } });
  const registryUrl = `http://127.0.0.1:${registry.port}/`;
  writeFileSync(join(home, "npmrc"), `registry=${registryUrl}\n`);
  writeFileSync(join(home, "global-npmrc"), "");
  writeFileSync(join(corpus, ".npmrc"), `registry=${registryUrl}\n`);
  const dependency = join(root, "dependency");
  mkdirSync(dependency);
  writeFileSync(join(dependency, "package.json"), JSON.stringify({ name: "owned-local-dependency", version: "1.0.0", main: "index.js" }));
  writeFileSync(join(dependency, "index.js"), "module.exports = 'prepared';\n");
  writeFileSync(join(corpus, "package.json"), JSON.stringify({
    name: "preparation-probe", version: "1.0.0", type: "module", bin: { probe: "entry.ts" },
    dependencies: mode === "missing" || mode === "timeout" ? { "owned-missing-dependency": "1.0.0" } : { "owned-local-dependency": `file:${dependency}` },
    scripts: { postinstall: "bun prepare.ts" },
  }));
  writeFileSync(join(corpus, "SKILL.md"), "---\nname: preparation-probe\ndescription: Owned preparation fixture\nkind: executable\n---\n\n# Preparation Probe\n");
  writeFileSync(join(corpus, "prepare.ts"), `import{writeFileSync}from'node:fs';writeFileSync(${JSON.stringify(prepared)},process.env.HOME!);process.stdout.write('x'.repeat(1048576));process.stderr.write('OWNED_DIAGNOSTIC_MUST_NOT_ESCAPE');process.exit(${mode === "nonzero" ? 17 : 0});`);
  if (mode === "readonly") writeFileSync(join(corpus, "prepare.ts"), `import{writeFileSync}from'node:fs';writeFileSync(${JSON.stringify(join(corpus, "must-be-writable"))},'prepared');`);
  if (mode === "lifecycle-timeout") {
    writeFileSync(join(corpus, "descendant.ts"), `import{writeFileSync}from'node:fs';writeFileSync(${JSON.stringify(descendant)},String(process.pid));setInterval(()=>{},100);`);
    writeFileSync(join(corpus, "prepare.ts"), `const child=Bun.spawn([process.execPath,'descendant.ts'],{stdout:'inherit',stderr:'inherit'});await child.exited;`);
  }
  writeFileSync(join(corpus, "entry.ts"), `import{appendFileSync}from'node:fs';appendFileSync(${JSON.stringify(marker)},'executed\\n');console.log(JSON.stringify({args:process.argv.slice(2),home:process.env.HOME}));`);
  const env: Record<string, string> = {
    PATH: `${dirname(process.execPath)}:/usr/bin:/bin`, HOME: home, TMPDIR: temporary,
    HASNA_SKILLS_DIR: join(root, "data"), HASNA_HOME: join(root, "hasna"), HASNA_PROFILE: "",
    HASNA_SKILLS_LOCAL: "1", SKILLS_LOCAL: "1", NO_COLOR: "1",
    NPM_CONFIG_USERCONFIG: join(home, "npmrc"), NPM_CONFIG_GLOBALCONFIG: join(home, "global-npmrc"),
    NPM_CONFIG_CACHE: cache, BUN_INSTALL_CACHE_DIR: cache, BUN_RUNTIME_TRANSPILER_CACHE_PATH: "0",
  };
  const selectedHome = join(root, "selected-home"); mkdirSync(selectedHome);
  const probe = join(root, "probe.ts");
  writeFileSync(probe, `import{runSkill}from${JSON.stringify(join(packageRoot, "index.ts"))};const invoke=()=>runSkill('preparation-probe',['--help'],{stdio:'pipe',preparationTimeoutMs:${mode === "timeout" || mode === "lifecycle-timeout" ? 1000 : 10000},env:${JSON.stringify({ HOME: selectedHome, ...(mode === "spawn" ? { PATH: join(root, "missing-bin") } : {}) })}});const result=await invoke();${retry && surface === "library" ? "result.__retry=await invoke();" : ""}console.log(JSON.stringify(result));process.exitCode=result.exitCode;`);
  const markerDirectory = join(corpus, ".skills-dependency-preparation");
  if (["pending", "malformed", "symlink"].includes(mode)) {
    // An existing dependency tree does not override incomplete preparation.
    mkdirSync(join(corpus, "node_modules"));
    if (mode === "symlink") symlinkSync(join(root, "missing-marker-target"), markerDirectory);
    else {
      mkdirSync(markerDirectory);
      writeFileSync(join(markerDirectory, "state.json"), mode === "malformed" ? "invalid state" : JSON.stringify({ version: 1, status: "pending" }));
    }
  }
  const installerPid = join(root, "installer-pid"), observer = join(root, "observer.ts");
  // Observe the real installer, without substituting its process or result, so
  // the fixture watchdog can clean its detached group even on a regression.
  writeFileSync(observer, `import{writeFileSync}from'node:fs';const original=Bun.spawn;Bun.spawn=((argv,options)=>{const child=original(argv,options);if(Array.isArray(argv)&&argv[1]==='install')writeFileSync(${JSON.stringify(installerPid)},String(child.pid));return child;});`);
  const cleanInstaller = () => {
    if (!existsSync(installerPid)) return;
    const pid = Number(readFileSync(installerPid, "utf8"));
    if (!Number.isSafeInteger(pid) || pid < 2) throw new Error("Invalid owned installer PID");
    try { process.kill(process.platform === "win32" ? pid : -pid, "SIGKILL"); } catch { /* reaped */ }
  };
  if (mode === "readonly") chmodSync(corpus, 0o555);
  try {
    const child = Bun.spawn([process.execPath, "--no-env-file", "--preload", observer, surface === "cli" ? join(packageRoot, "cli/index.tsx") : probe, ...(surface === "cli" ? ["run", "--json", "preparation-probe", "--help"] : [])], { cwd: project, env, stdin: "ignore", stdout: "pipe", stderr: "pipe" });
    const timer = setTimeout(() => { cleanInstaller(); child.kill("SIGKILL"); }, 20_000);
    let exitCode: number, stdout: string, stderr: string;
    try { [exitCode, stdout, stderr] = await Promise.all([child.exited, new Response(child.stdout).text(), new Response(child.stderr).text()]); }
    finally { clearTimeout(timer); }
    if (!stdout.trim()) throw new Error(`Fixture child returned no JSON (exit ${exitCode}): ${stderr}`);
    const result = JSON.parse(stdout);
    const entryBeforeRetry = existsSync(marker);
    let retried: { exitCode: number; result: any } | undefined = result.__retry ? { exitCode: result.__retry.exitCode, result: result.__retry } : undefined;
    if (retry && surface === "cli") {
      if (repair) writeFileSync(join(corpus, "prepare.ts"), `import{writeFileSync}from'node:fs';writeFileSync(${JSON.stringify(prepared)},process.env.HOME!);`);
      const child = Bun.spawn([process.execPath, "--no-env-file", "--preload", observer, surface === "cli" ? join(packageRoot, "cli/index.tsx") : probe, ...(surface === "cli" ? ["run", "--json", "preparation-probe", "--help"] : [])], { cwd: project, env, stdin: "ignore", stdout: "pipe", stderr: "pipe" });
      const deadline = setTimeout(() => { cleanInstaller(); child.kill("SIGKILL"); }, 20_000);
      try {
        const [exitCode, output] = await Promise.all([child.exited, new Response(child.stdout).text(), new Response(child.stderr).text()]);
        retried = { exitCode, result: JSON.parse(output) };
      } finally { clearTimeout(deadline); }
    }
    let descendantAlive = false;
    if (existsSync(descendant)) {
      const pid = Number(readFileSync(descendant, "utf8"));
      // Give the OS a bounded window to reap an orphaned lifecycle child.
      for (let attempt = 0; attempt < 20; attempt++) {
        try { process.kill(pid, 0); descendantAlive = true; } catch { descendantAlive = false; break; }
        await Bun.sleep(25);
      }
    }
    return { result, retried, retriedStored: retried?.result.run ? JSON.parse(readFileSync(join(project, retried.result.run.paths.runDir, "run.json"), "utf8")) : undefined, entryBeforeRetry, entryExecutions: existsSync(marker) ? readFileSync(marker, "utf8").trim().split("\n").length : 0, markerExists: existsSync(markerDirectory), installerObserved: existsSync(installerPid), preparationState: existsSync(join(markerDirectory, "state.json")) ? readFileSync(join(markerDirectory, "state.json"), "utf8") : undefined, exitCode, stdout, stderr, requests, descendantObserved: existsSync(descendant), descendantAlive, entry: existsSync(marker), preparedHome: existsSync(prepared) ? readFileSync(prepared, "utf8") : undefined, expectedHome: surface === "cli" ? home : selectedHome, stored: result.run ? JSON.parse(readFileSync(join(project, result.run.paths.runDir, "run.json"), "utf8")) : undefined };
  } finally { cleanInstaller(); chmodSync(corpus, 0o755); registry.stop(true); }
}

describe("actual dependency preparation through public root export and CLI", () => {
  for (const surface of ["library", "cli"] as const) {
    test(`${surface} drains successful preparation and preserves forwarded help`, async () => {
      const value = await scenario("success", surface);
      expect(value.exitCode).toBe(0); expect(value.entry).toBe(true);
      expect(value.preparedHome).toBe(value.expectedHome);
      expect(JSON.parse(value.result.stdout)).toEqual({ args: ["--help"], home: value.expectedHome });
      expect(value.requests).toEqual([]); expect(value.markerExists).toBe(false);
      expect(value.stdout + value.stderr).not.toContain("OWNED_DIAGNOSTIC_MUST_NOT_ESCAPE");
      if (surface === "cli") { expect(value.result.run.status).toBe("completed"); expect(value.stored.status).toBe("completed"); }
    });
    test(`${surface} retries preparation after failure leaves partial node_modules`, async () => {
      const value = await scenario("nonzero", surface, true);
      expect(value.exitCode).toBe(1);
      expect(value.retried?.exitCode).toBe(1); expect(value.entry).toBe(false);
      expect(JSON.parse(value.preparationState!)).toEqual({ version: 1, status: "failed" });
      if (surface === "cli") expect(value.retried?.result.run.status).toBe("failed");
    });
    for (const mode of ["missing", "nonzero"] as const) {
      test(`${surface} stops before entry after ${mode} preparation and records failure`, async () => {
        const value = await scenario(mode, surface);
        expect(value.exitCode).toBe(1); expect(value.entry).toBe(false);
        expect(value.result.error).toContain("dependency preparation failed");
        expect(value.stdout + value.stderr).not.toContain("OWNED_DIAGNOSTIC_MUST_NOT_ESCAPE");
        if (mode === "missing") expect(value.requests).toEqual(["/owned-missing-dependency"]);
        if (surface === "cli") { expect(value.result.run.status).toBe("failed"); expect(value.stored.status).toBe("failed"); }
      });
    }
  }
  test("CLI completes a repaired retry, executes once, and clears failed preparation state", async () => {
    const value = await scenario("nonzero", "cli", true, true);
    expect(value.exitCode).toBe(1); expect(value.entryBeforeRetry).toBe(false);
    expect(value.retried?.exitCode).toBe(0); expect(value.entryExecutions).toBe(1);
    expect(value.markerExists).toBe(false);
    expect(value.retried?.result.run.status).toBe("completed");
    expect(value.retriedStored.status).toBe("completed");
  });
  for (const mode of ["pending", "malformed", "symlink"] as const) {
    test(`refuses ${mode} preparation state even with node_modules present`, async () => {
      const value = await scenario(mode);
      expect(value.exitCode).toBe(1); expect(value.entry).toBe(false);
      expect(value.installerObserved).toBe(false);
      expect(value.result.error).toContain("Skill dependency preparation is incomplete");
    });
  }
  test("public root export bounds an actual stalled registry request", async () => {
    const value = await scenario("timeout");
    expect(value.exitCode).toBe(124); expect(value.entry).toBe(false);
    expect(value.result.error).toBe("Skill dependency preparation timed out");
    expect(value.requests).toEqual(["/owned-missing-dependency"]);
  });
  test("preparation timeout terminates the actual lifecycle descendant", async () => {
    const value = await scenario("lifecycle-timeout");
    expect(value.exitCode).toBe(124); expect(value.entry).toBe(false);
    expect(value.descendantObserved).toBe(true); expect(value.descendantAlive).toBe(false);
  });
  test("public root export returns a fixed failure when selected PATH cannot spawn installer", async () => {
    const value = await scenario("spawn");
    expect(value.exitCode).toBe(1); expect(value.entry).toBe(false);
    expect(value.result.error).toBe("Could not start skill dependency preparation");
  });
  test.skipIf(process.getuid?.() === 0)("public root export does not execute after read-only corpus preparation fails", async () => {
    const value = await scenario("readonly");
    expect(value.exitCode).toBe(1); expect(value.entry).toBe(false);
    expect(value.result.error).toContain("dependency preparation is incomplete");
    expect(value.installerObserved).toBe(false);
  });
});
