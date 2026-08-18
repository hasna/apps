/**
 * Regression tests for P1-1 hook env isolation.
 *
 * A hook child must never receive credential-bearing variables, even when the
 * parent passes process.env wholesale. The sanitizer keeps the non-secret
 * session allowlist and projects non-secret HOOKS_* config, and strips every
 * deny-listed NAME — the deny list is name-based by design (a value-shape
 * test would have to miss something for a credential to leak).
 */

import { describe, expect, test, beforeAll, afterAll } from "bun:test";
import { chmodSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from "fs";
import { dirname, join } from "path";
import { tmpdir } from "os";
import { runHook } from "../index.js";
import { executeVerifiedScript } from "./run.js";
import { buildHookEnv, isBashFunctionEnvName, isDeniedEnvName, isInterpreterInjectionEnvName } from "./hook-env.js";
import { closeDb } from "../db/index.js";

const TEST_DIR = mkdtempSync(join(tmpdir(), "hooks-env-test-"));
const HOOKS_DIR = join(TEST_DIR, "hooks");

/**
 * Sentinel builders — the CI secrets gate scans ADDED LINES for real token
 * shapes, so fixtures build the shape at runtime by concatenation (P2-6).
 */
const sentinel = {
  skAnt: (body: string) => `sk-${"ant-"}-${body}`,
  ghp: (body: string) => `gh${"p_"}${body}`,
};

function installCustomHook(name: string, script: string, scriptPath = "script.ts", env?: Record<string, string>): string {
  const dir = join(HOOKS_DIR, name);
  mkdirSync(dir, { recursive: true });
  writeFileSync(
    join(dir, "manifest.json"),
    JSON.stringify({ name, version: "1.0.0", events: ["PostToolUse"], script: scriptPath, ...(env ? { env } : {}) }),
  );
  const scriptFile = join(dir, scriptPath);
  writeFileSync(scriptFile, script);
  return scriptFile;
}

const ENV_DUMP_SCRIPT = `const input = JSON.parse(await Bun.stdin.text());
console.log(JSON.stringify({ env: process.env, want: input.want }));
`;

beforeAll(() => {
  process.env.HASNA_HOOKS_DATA_DIR = TEST_DIR;
  process.env.HASNA_HOOKS_DB_PATH = ":memory:";
});

afterAll(() => {
  delete process.env.HASNA_HOOKS_DATA_DIR;
  delete process.env.HASNA_HOOKS_DB_PATH;
  closeDb();
  rmSync(TEST_DIR, { recursive: true, force: true });
});

describe("buildHookEnv sanitizer", () => {
  test("keeps the documented allowlist and drops everything credential-shaped", () => {
    const source: Record<string, string | undefined> = {
      PATH: "/usr/bin:/bin",
      HOME: "/home/hasna",
      LANG: "en_US.UTF-8",
      TZ: "Europe/Bucharest",
      SHELL: "/bin/bash",
      TERM: "xterm-256color",
      USER: "hasna",
      PWD: "/home/hasna/work",
      OPENAI_API_KEY: sentinel.skAnt("should-never-leak"),
      ANTHROPIC_API_KEY: sentinel.skAnt("should-never-leak"),
      GITHUB_TOKEN: sentinel.ghp("should-never-leak"),
      AWS_SECRET_ACCESS_KEY: "aws-should-never-leak",
      AZURE_CLIENT_SECRET: "azure-should-never-leak",
      GCP_PROJECT: "gcp-should-never-leak",
      VAULT_TOKEN: "vault-should-never-leak",
      DATABASE_URL: "postgres://u:p@h/db",
      PRISMA_DATABASE_URL: "postgres://u:p@h/db2",
      MEMENTOS_API_URL: "https://mementos.example.com",
      DB_URL: "https://db.example.com:5432",
      MY_API_KEY: "custom-key",
      DB_PASSWORD: "pw",
      HASNA_HOOKS_API_KEY: "hooks-key",
      HOOKS_API_KEY: "hooks-key-bare",
      HASNA_TODOS_API_KEY: "todos-key",
      HASNA_HOOKS_DATA_DIR: TEST_DIR,
      CUSTOM_NON_SECRET_VAR: "keep-me",
    };
    const env = buildHookEnv(source);
    for (const denied of [
      "OPENAI_API_KEY",
      "ANTHROPIC_API_KEY",
      "GITHUB_TOKEN",
      "AWS_SECRET_ACCESS_KEY",
      "AZURE_CLIENT_SECRET",
      "GCP_PROJECT",
      "VAULT_TOKEN",
      "DATABASE_URL",
      "PRISMA_DATABASE_URL",
      "MEMENTOS_API_URL",
      "DB_URL",
      "MY_API_KEY",
      "DB_PASSWORD",
      "HASNA_HOOKS_API_KEY",
      "HOOKS_API_KEY",
      "HASNA_TODOS_API_KEY",
      "HASNA_HOOKS_DATA_DIR",
    ]) {
      expect(env[denied], `expected ${denied} to be stripped`).toBeUndefined();
    }
    // allowlist survives — PATH rebuilt from the trusted baseline (the
    // sanitizer appends the runner's own bun dir to the system dirs).
    expect(env.PATH).toContain("/usr/bin");
    expect(env.PATH).toContain("/bin");
    expect(env.PATH).toContain(dirname(process.execPath));
    expect(env.HOME).toBe("/home/hasna");
    expect(env.LANG).toBe("en_US.UTF-8");
    expect(env.TZ).toBe("Europe/Bucharest");
    expect(env.SHELL).toBe("/bin/bash");
    expect(env.TERM).toBe("xterm-256color");
    expect(env.USER).toBe("hasna");
    expect(env.PWD).toBe("/home/hasna/work");
    // non-secret extras survive
    expect(env.CUSTOM_NON_SECRET_VAR).toBe("keep-me");
    // HASNA_HOOKS_* config is projected to the bare alias
    expect(env.HOOKS_DATA_DIR).toBe(TEST_DIR);
  });

  test("a caller's extra env cannot reintroduce a denied name", () => {
    const env = buildHookEnv({}, { GITHUB_TOKEN: sentinel.ghp("reintroduced"), PATH: "/opt/bin" });
    expect(env.GITHUB_TOKEN).toBeUndefined();
    expect(env.PATH).toBe("/opt/bin");
  });

  test("isDeniedEnvName covers the documented prefix/suffix/contains sets", () => {
    expect(isDeniedEnvName("AWS_ACCESS_KEY_ID")).toBe(true);
    expect(isDeniedEnvName("MY_TOKEN")).toBe(true);
    expect(isDeniedEnvName("super_secret")).toBe(true);
    expect(isDeniedEnvName("PASSWORD")).toBe(true);
    expect(isDeniedEnvName("DB_PASSWORD")).toBe(true);
    expect(isDeniedEnvName("POSTGRES_PASSWORD")).toBe(true);
    expect(isDeniedEnvName("FOO_DATABASE_URL")).toBe(true);
    expect(isDeniedEnvName("HASNA_SOMETHING")).toBe(true);
    expect(isDeniedEnvName("MYSQL_ROOT_PASSWORD")).toBe(true);
    expect(isDeniedEnvName("REDIS_URL")).toBe(true);
    // P3-11: URL/URI-bearing names and MEMENTOS_* are denied classes too.
    expect(isDeniedEnvName("MEMENTOS_API_URL")).toBe(true);
    expect(isDeniedEnvName("MEMENTOS_DB_PATH")).toBe(true);
    expect(isDeniedEnvName("DB_URL")).toBe(true);
    expect(isDeniedEnvName("SERVICE_URI")).toBe(true);
    expect(isDeniedEnvName("PATH")).toBe(false);
    expect(isDeniedEnvName("HOOKS_DATA_DIR")).toBe(false);
    expect(isDeniedEnvName("LANG")).toBe(false);
    expect(isDeniedEnvName("TERM")).toBe(false);
  });
});

describe("interpreter-injection variables (bug cf99cf76)", () => {
  test("isInterpreterInjectionEnvName covers the sourcing and interpreter-config set", () => {
    for (const name of [
      "BASH_ENV",
      "ENV",
      "BASHOPTS",
      "SHELLOPTS",
      "NODE_OPTIONS",
      "NODE_PATH",
      "PYTHONSTARTUP",
      "PYTHONINSPECT",
      "PYTHONPATH",
      "LD_PRELOAD",
      "LD_LIBRARY_PATH",
    ]) {
      expect(isInterpreterInjectionEnvName(name), `${name} must be flagged`).toBe(true);
    }
    // Non-interpreter names are not flagged by the injection predicate
    // (they may still be denied as credential-shaped — separate predicate).
    expect(isInterpreterInjectionEnvName("PATH")).toBe(false);
    expect(isInterpreterInjectionEnvName("BASH_VERSION")).toBe(false);
    expect(isInterpreterInjectionEnvName("HOOKS_DATA_DIR")).toBe(false);
  });

  test("buildHookEnv strips interpreter-injection names from source and from extras", () => {
    const source: Record<string, string | undefined> = {
      PATH: "/usr/bin:/bin",
      BASH_ENV: "/home/hasna/.config/hasna-cloud-env.sh",
      ENV: "/home/hasna/.config/hasna-cloud-env.sh",
      BASHOPTS: "checkwinsize:cmdhist",
      SHELLOPTS: "braceexpand:hashall",
      NODE_OPTIONS: "--require /tmp/inject.js",
      NODE_PATH: "/tmp/node_modules",
      PYTHONSTARTUP: "/tmp/startup.py",
      PYTHONINSPECT: "1",
      PYTHONPATH: "/tmp/pylibs",
      LD_PRELOAD: "/tmp/libinject.so",
      LD_LIBRARY_PATH: "/tmp/libs",
      CUSTOM_NON_SECRET_VAR: "keep-me",
    };
    const env = buildHookEnv(source);
    for (const name of [
      "BASH_ENV",
      "ENV",
      "BASHOPTS",
      "SHELLOPTS",
      "NODE_OPTIONS",
      "NODE_PATH",
      "PYTHONSTARTUP",
      "PYTHONINSPECT",
      "PYTHONPATH",
      "LD_PRELOAD",
      "LD_LIBRARY_PATH",
    ]) {
      expect(env[name], `expected ${name} to be stripped`).toBeUndefined();
    }
    expect(env.PATH).toContain("/usr/bin");
    expect(env.CUSTOM_NON_SECRET_VAR).toBe("keep-me");

    // A caller's extras cannot reintroduce an interpreter-injection name.
    const withExtra = buildHookEnv({}, { BASH_ENV: "/tmp/evil.sh", NODE_OPTIONS: "--require /tmp/evil.js", PATH: "/opt/bin" });
    expect(withExtra.BASH_ENV).toBeUndefined();
    expect(withExtra.NODE_OPTIONS).toBeUndefined();
    expect(withExtra.PATH).toBe("/opt/bin");
  });
});

describe("executed hook env isolation (P1-1)", () => {
  test("a real hook child sees no credential variables but keeps PATH and HOME", async () => {
    const scriptPath = installCustomHook(
      "env-isolation-demo",
      `const input = JSON.parse(await Bun.stdin.text());\nconsole.log(JSON.stringify({ env: process.env, want: input.want }));\n`,
    );
    // Seed the PARENT process with credential-shaped variables, exactly the
    // attacker model: the parent holds them, the child must not.
    const seeded: Array<[string, string]> = [
      ["OPENAI_API_KEY", "sk-parent-only"],
      ["GITHUB_TOKEN", sentinel.ghp("parent_only")],
      ["AWS_SECRET_ACCESS_KEY", "aws-parent-only"],
      ["DATABASE_URL", "postgres://u:p@h/db"],
      ["HASNA_HOOKS_API_KEY", "hooks-parent-only"],
    ];
    const previous = new Map<string, string | undefined>();
    for (const [name, value] of seeded) {
      previous.set(name, process.env[name]);
      process.env[name] = value;
    }
    try {
      const result = await executeVerifiedScript({
        name: "env-isolation-demo",
        scriptPath,
        content: await Bun.file(scriptPath).arrayBuffer().then((b) => Buffer.from(b)),
        args: [],
        stdin: JSON.stringify({ want: [] }),
      });
      expect(result.exitCode).toBe(0);
      const { env } = JSON.parse(result.stdout);
      for (const [name] of seeded) {
        expect(env[name], `child must not see ${name}`).toBeUndefined();
      }
      expect(env.PATH).toBeTruthy();
      expect(env.HOME).toBeTruthy();
      expect(env.HOOKS_DATA_DIR).toBe(TEST_DIR);
    } finally {
      for (const [name, value] of seeded) {
        if (value === undefined) delete process.env[name];
        else process.env[name] = value;
      }
    }
  });

  test("runHook passes no parent credentials to the hook child", async () => {
    const scriptPath = installCustomHook(
      "env-isolation-runhook",
      `console.log(JSON.stringify({ env: process.env }));\n`,
    );
    const previous = process.env.GITHUB_TOKEN;
    process.env.GITHUB_TOKEN = sentinel.ghp("runhook_parent");
    try {
      const res = await runHook("env-isolation-runhook", { session_id: "s-env" });
      expect(res.exitCode).toBe(0);
      const env = (res.output as any).env ?? {};
      expect(env.GITHUB_TOKEN).toBeUndefined();
      expect(env.PATH).toBeTruthy();
    } finally {
      if (previous === undefined) delete process.env.GITHUB_TOKEN;
      else process.env.GITHUB_TOKEN = previous;
    }
  });
});

describe("BASH_ENV / interpreter-injection at the live child boundary (bug cf99cf76)", () => {
  const CF_DIR = join(TEST_DIR, "cf99");
  let sourcingFile: string;
  let sourcingLog: string;

  /**
   * The file a maliciously-set BASH_ENV would point at: it exports a marker
   * variable (a name the deny list does NOT catch — the whole point of the
   * vector is that the credential is re-imported from the FILE, never from
   * the parent env) and records that it ran. The marker value is built by
   * concatenation so the CI secrets gate never sees a token-shaped literal.
   */
  function writeSourcingFile(): void {
    mkdirSync(CF_DIR, { recursive: true });
    sourcingLog = join(CF_DIR, "sourced.log");
    sourcingFile = join(CF_DIR, "hasna-cloud-env.sh");
    writeFileSync(
      sourcingFile,
      `# simulated fleet credential env, as BASH_ENV would source it\necho "sourced-ran" >> "${sourcingLog}"\nexport HOOKS_MARKER="marker-${"leak"}-${"sentinel"}"\n`,
    );
    writeFileSync(join(CF_DIR, "inject.js"), "// no-op: the interpreter must never be told to load this\n");
  }

  /** The bash hook: dumps its full child env to a scratch file named by $1. */
  function envDumpSh(dumpPath: string): string {
    return `env > "$1"\necho "hook-done"\n`;
  }

  function seedParent(previous: Map<string, string | undefined>): void {
    for (const [name, value] of [
      ["BASH_ENV", sourcingFile],
      ["ENV", sourcingFile],
      ["NODE_OPTIONS", `--require ${join(CF_DIR, "inject.js")}`],
    ] as Array<[string, string]>) {
      previous.set(name, process.env[name]);
      process.env[name] = value;
    }
  }

  function restoreParent(previous: Map<string, string | undefined>): void {
    for (const [name, value] of previous) {
      if (value === undefined) delete process.env[name];
      else process.env[name] = value;
    }
  }

  async function readDump(dumpPath: string): Promise<string> {
    return (await Bun.file(dumpPath).exists())
      ? Bun.file(dumpPath).text()
      : "";
  }

  test("a .sh hook with BASH_ENV seeded: the file is never sourced and the child env has no marker and no sourcing vars", async () => {
    writeSourcingFile();
    const dumpPath = join(CF_DIR, "sh-env-dump.txt");
    const hookPath = join(CF_DIR, "dump-env.sh");
    writeFileSync(hookPath, envDumpSh(dumpPath), { mode: 0o600 });

    const previous = new Map<string, string | undefined>();
    seedParent(previous);
    try {
      const result = await executeVerifiedScript({
        name: "cf99-bash-env",
        scriptPath: hookPath,
        content: await Bun.file(hookPath).arrayBuffer().then((b) => Buffer.from(b)),
        args: [dumpPath],
        stdin: "",
      });
      expect(result.exitCode).toBe(0);
      expect(result.stdout).toContain("hook-done");

      const dumped = await readDump(dumpPath);
      expect(dumped, "child env dump must not contain the marker the sourcing file exports").not.toContain("HOOKS_MARKER=");
      expect(dumped, "child env must carry no BASH_ENV entry at all").not.toContain("BASH_ENV=");
      expect(dumped, "child env must carry no ENV entry at all").not.toMatch(/(^|\n)ENV=/);
      expect(dumped, "child env must carry no NODE_OPTIONS entry at all").not.toContain("NODE_OPTIONS=");
      expect(result.stdout).not.toContain("marker-leak-sentinel");

      // The sourcing file must never have RUN: bash sources BASH_ENV before
      // the script, so a surviving pointer would be visible here even if the
      // marker export were filtered later.
      expect(await Bun.file(sourcingLog).exists(), "the BASH_ENV file must never be sourced").toBe(false);
    } finally {
      restoreParent(previous);
    }
  });

  test("a shebang-bash hook (.ts file, #!/bin/bash) is equally protected", async () => {
    writeSourcingFile();
    const dumpPath = join(CF_DIR, "shebang-env-dump.txt");
    const hookPath = join(CF_DIR, "dump-env.shebang.ts");
    writeFileSync(hookPath, `#!/bin/bash\n${envDumpSh(dumpPath)}`, { mode: 0o600 });

    const previous = new Map<string, string | undefined>();
    seedParent(previous);
    try {
      const result = await executeVerifiedScript({
        name: "cf99-shebang",
        scriptPath: hookPath,
        content: await Bun.file(hookPath).arrayBuffer().then((b) => Buffer.from(b)),
        args: [dumpPath],
        stdin: "",
      });
      expect(result.exitCode).toBe(0);
      const dumped = await readDump(dumpPath);
      expect(dumped).not.toContain("HOOKS_MARKER=");
      expect(dumped).not.toContain("BASH_ENV=");
      expect(await Bun.file(sourcingLog).exists(), "the BASH_ENV file must never be sourced").toBe(false);
    } finally {
      restoreParent(previous);
    }
  });

  test("a node/bun hook with NODE_OPTIONS seeded: the child env has no NODE_OPTIONS and no marker", async () => {
    writeSourcingFile();
    const hookPath = join(CF_DIR, "dump-env.ts");
    writeFileSync(hookPath, `console.log(JSON.stringify({ env: process.env }));\n`);

    const previous = new Map<string, string | undefined>();
    seedParent(previous);
    try {
      const result = await executeVerifiedScript({
        name: "cf99-node-options",
        scriptPath: hookPath,
        content: await Bun.file(hookPath).arrayBuffer().then((b) => Buffer.from(b)),
        args: [],
        stdin: "",
      });
      expect(result.exitCode).toBe(0);
      const { env } = JSON.parse(result.stdout);
      expect(env.NODE_OPTIONS, "child must not see NODE_OPTIONS").toBeUndefined();
      expect(env.BASH_ENV, "child must not see BASH_ENV").toBeUndefined();
      expect(env.HOOKS_MARKER, "child must not see the marker").toBeUndefined();
      expect(await Bun.file(sourcingLog).exists(), "the BASH_ENV file must never be sourced").toBe(false);
    } finally {
      restoreParent(previous);
    }
  });
});

describe("bash exported-function env vectors — BASH_FUNC_* (reviewer P1)", () => {
  test("isBashFunctionEnvName flags every BASH_FUNC_* form and nothing else", () => {
    expect(isBashFunctionEnvName("BASH_FUNC_env%%")).toBe(true);
    expect(isBashFunctionEnvName("BASH_FUNC_env%")).toBe(true);
    expect(isBashFunctionEnvName("BASH_FUNC_env")).toBe(true);
    expect(isBashFunctionEnvName("BASH_FUNC_cat%%")).toBe(true);
    // Bash imports only FUNCTIONS from the environment. Aliases are NOT
    // importable (BASH_ALIASES is an associative array, never exported), so
    // they are deliberately not part of the strip.
    expect(isBashFunctionEnvName("BASH_ALIASES")).toBe(false);
    expect(isBashFunctionEnvName("BASH_ENV")).toBe(false);
    expect(isBashFunctionEnvName("BASH_VERSION")).toBe(false);
    expect(isBashFunctionEnvName("PATH")).toBe(false);
  });

  test("buildHookEnv strips every BASH_FUNC_* entry from source and from extras", () => {
    const func = '() { echo "marker-leak-sentinel"; }';
    const source: Record<string, string | undefined> = {
      PATH: "/usr/bin:/bin",
      "BASH_FUNC_env%%": func,
      "BASH_FUNC_cat%%": func,
      "BASH_FUNC_git%%": func,
      "BASH_FUNC_node%%": func,
      CUSTOM_NON_SECRET_VAR: "keep-me",
    };
    const env = buildHookEnv(source);
    for (const name of ["BASH_FUNC_env%%", "BASH_FUNC_cat%%", "BASH_FUNC_git%%", "BASH_FUNC_node%%"]) {
      expect(env[name], `${name} must be stripped`).toBeUndefined();
    }
    expect(env.CUSTOM_NON_SECRET_VAR).toBe("keep-me");
    expect(env.PATH).toContain("/usr/bin");

    // A caller's extras cannot reintroduce a function entry either.
    const withExtra = buildHookEnv({ PATH: "/usr/bin:/bin" }, { "BASH_FUNC_env%%": func, CUSTOM_NON_SECRET_VAR: "x" });
    expect(withExtra["BASH_FUNC_env%%"]).toBeUndefined();
    expect(withExtra.CUSTOM_NON_SECRET_VAR).toBe("x");
  });

  test("a .sh hook child never imports BASH_FUNC_env%% — the real env command runs, no marker", async () => {
    const dir = join(TEST_DIR, "bashfunc");
    mkdirSync(dir, { recursive: true });
    const dumpPath = join(dir, "env-dump.txt");
    const hookPath = join(dir, "dump-env.sh");
    writeFileSync(hookPath, `env > "$1"\necho "hook-done"\n`, { mode: 0o600 });
    const previous = new Map<string, string | undefined>();
    const func = '() { echo "marker-leak-sentinel"; }';
    // The function REPLACES env/cat/git/node in a bash child that imports it:
    // any of these shadowed means attacker code ran on the hook's first command.
    for (const [name, value] of [
      ["BASH_FUNC_env%%", func],
      ["BASH_FUNC_cat%%", func],
      ["BASH_FUNC_git%%", func],
      ["BASH_FUNC_node%%", func],
    ] as Array<[string, string]>) {
      previous.set(name, process.env[name]);
      process.env[name] = value;
    }
    try {
      const result = await executeVerifiedScript({
        name: "bashfunc-shadow",
        scriptPath: hookPath,
        content: await Bun.file(hookPath).arrayBuffer().then((b) => Buffer.from(b)),
        args: [dumpPath],
        stdin: "",
      });
      expect(result.exitCode).toBe(0);
      expect(result.stdout).toContain("hook-done");
      expect(result.stdout).not.toContain("marker-leak-sentinel");
      const dumped = (await Bun.file(dumpPath).exists()) ? await Bun.file(dumpPath).text() : "";
      // The REAL env command ran: its output carries the session variables.
      expect(dumped, "child env dump must come from the real env binary").toContain("HOME=");
      expect(dumped).toContain("PATH=");
      // No function entry reached the child, and no marker was printed.
      expect(dumped).not.toContain("BASH_FUNC_");
      expect(dumped).not.toContain("marker-leak-sentinel");
    } finally {
      for (const [name, value] of previous) {
        if (value === undefined) delete process.env[name];
        else process.env[name] = value;
      }
    }
  });
});

describe("same-class interpreter / TLS-trust / git-config vectors (reviewer P2)", () => {
  const SAME_CLASS_VECTORS = [
    "GCONV_PATH", // glibc iconv module directory (gconv code injection)
    "LOCPATH", // glibc locale data directory (locale code injection)
    "PYTHONHOME", // python stdlib hijack
    "GIT_CONFIG_GLOBAL", // git config override (code exec via config)
    "GIT_CONFIG_SYSTEM",
    "GIT_CONFIG_NOSYSTEM",
    "GIT_CONFIG_COUNT",
    "NODE_EXTRA_CA_CERTS", // TLS trust redirection (MITM)
    "NODE_TLS_REJECT_UNAUTHORIZED", // TLS verification disable (MITM)
    "SSL_CERT_FILE", // TLS trust redirection (MITM)
    "SSL_CERT_DIR", // TLS trust redirection (MITM)
    "CURL_CA_BUNDLE", // TLS trust redirection (MITM)
    "GIT_SSL_CAINFO", // git TLS trust redirection (MITM)
    "AWS_CA_BUNDLE", // AWS SDK TLS trust redirection (MITM)
    "PERL5OPT", // perl option list (code injection, like NODE_OPTIONS)
    "RUBYOPT", // ruby option list (code injection, like NODE_OPTIONS)
  ];

  test("isInterpreterInjectionEnvName flags the same-class vectors", () => {
    for (const name of SAME_CLASS_VECTORS) {
      expect(isInterpreterInjectionEnvName(name), `${name} must be flagged`).toBe(true);
    }
    expect(isInterpreterInjectionEnvName("GIT_DIR")).toBe(false);
    expect(isInterpreterInjectionEnvName("CUSTOM_NON_SECRET_VAR")).toBe(false);
  });

  test("buildHookEnv strips the same-class vectors from source and from extras", () => {
    const source: Record<string, string | undefined> = { PATH: "/usr/bin:/bin" };
    for (const name of SAME_CLASS_VECTORS) source[name] = `value-${name}`;
    source.CUSTOM_NON_SECRET_VAR = "keep-me";
    const env = buildHookEnv(source);
    for (const name of SAME_CLASS_VECTORS) {
      expect(env[name], `${name} must be stripped`).toBeUndefined();
    }
    expect(env.CUSTOM_NON_SECRET_VAR).toBe("keep-me");
    expect(env.PATH).toContain("/usr/bin");

    const withExtra = buildHookEnv(
      { PATH: "/usr/bin:/bin" },
      { GCONV_PATH: "/tmp/gconv", PERL5OPT: "-Mevil", GIT_CONFIG_GLOBAL: "/tmp/gitconfig", NODE_EXTRA_CA_CERTS: "/tmp/ca.pem", RUBYOPT: "-revil" },
    );
    expect(withExtra.GCONV_PATH).toBeUndefined();
    expect(withExtra.PERL5OPT).toBeUndefined();
    expect(withExtra.GIT_CONFIG_GLOBAL).toBeUndefined();
    expect(withExtra.NODE_EXTRA_CA_CERTS).toBeUndefined();
    expect(withExtra.RUBYOPT).toBeUndefined();
  });

  test("a real hook child sees none of the same-class vectors (executed boundary)", async () => {
    const scriptPath = installCustomHook(
      "same-class-vectors",
      `const input = JSON.parse(await Bun.stdin.text());\nconsole.log(JSON.stringify({ env: process.env, want: input.want }));\n`,
    );
    const previous = new Map<string, string | undefined>();
    for (const name of SAME_CLASS_VECTORS) {
      previous.set(name, process.env[name]);
      process.env[name] = `value-${name}`;
    }
    try {
      const result = await executeVerifiedScript({
        name: "same-class-vectors",
        scriptPath,
        content: await Bun.file(scriptPath).arrayBuffer().then((b) => Buffer.from(b)),
        args: [],
        stdin: JSON.stringify({ want: [] }),
      });
      expect(result.exitCode).toBe(0);
      const { env } = JSON.parse(result.stdout);
      for (const name of SAME_CLASS_VECTORS) {
        expect(env[name], `child must not see ${name}`).toBeUndefined();
      }
    } finally {
      for (const [name, value] of previous) {
        if (value === undefined) delete process.env[name];
        else process.env[name] = value;
      }
    }
  });
});

describe("hook PATH sanitization (reviewer P2)", () => {
  const FAKE_HOME = "/home/fake-hook-user";

  test("buildHookEnv rebuilds PATH from the trusted baseline and drops unsafe entries", () => {
    const dirty = `${FAKE_HOME}/bin:/tmp/fakebin:/var/tmp/x:/usr/bin:/bin:/usr/local/bin:/sbin:/usr/sbin`;
    const env = buildHookEnv({ PATH: dirty, HOME: FAKE_HOME });
    expect(env.PATH, "PATH must never keep the fake's dirs").not.toContain(FAKE_HOME);
    expect(env.PATH).not.toContain("/tmp/fakebin");
    expect(env.PATH).not.toContain("/var/tmp");
    for (const systemDir of ["/usr/bin", "/bin", "/usr/local/bin", "/sbin", "/usr/sbin"]) {
      expect(env.PATH, `${systemDir} must be in the hook PATH`).toContain(systemDir);
    }
    // The runner's own bun dir is always present — the interpreter the hook runs under.
    expect(env.PATH).toContain(dirname(process.execPath));
  });

  test("empty and relative PATH entries are dropped (they resolve against the child's cwd)", () => {
    const env = buildHookEnv({ PATH: "::relative/bin:/usr/bin:/bin", HOME: FAKE_HOME });
    const parts = env.PATH!.split(":");
    expect(parts).not.toContain("");
    expect(parts).not.toContain("relative/bin");
  });

  test("does not confuse a sibling home prefix with the configured home", () => {
    const sibling = `${FAKE_HOME}-archive/bin`;
    const env = buildHookEnv({ PATH: `${sibling}:/usr/bin:/bin`, HOME: FAKE_HOME });
    expect(env.PATH).toContain(sibling);
  });

  test("a world-writable PATH entry is dropped even outside HOME and /tmp", () => {
    const wwDir = "/dev/shm/hooks-ww-" + Math.random().toString(36).slice(2);
    let created = false;
    try {
      mkdirSync(wwDir, { recursive: true });
      chmodSync(wwDir, 0o777);
      created = true;
    } catch {
      // /dev/shm unavailable on this machine — the world-writable arm is skipped.
    }
    if (created) {
      try {
        const env = buildHookEnv({ PATH: `${wwDir}:/usr/bin:/bin`, HOME: FAKE_HOME });
        expect(env.PATH, "a world-writable dir must be dropped from the hook PATH").not.toContain(wwDir);
      } finally {
        rmSync(wwDir, { recursive: true, force: true });
      }
    }
  });

  test("an explicit per-hook env.PATH override wins verbatim (manifest override)", () => {
    const env = buildHookEnv({ PATH: `${FAKE_HOME}/bin:/usr/bin:/bin`, HOME: FAKE_HOME }, { PATH: "/custom/only" });
    expect(env.PATH).toBe("/custom/only");
  });

  test("a fake node planted in $HOME/bin and /tmp cannot hijack the hook's commands", async () => {
    const fakeHome = join(TEST_DIR, "path-fake-home");
    const fakeHomeBin = join(fakeHome, "bin");
    const fakeTmp = join(tmpdir(), `hooks-fake-node-${Math.random().toString(36).slice(2)}`);
    mkdirSync(fakeHomeBin, { recursive: true });
    mkdirSync(fakeTmp, { recursive: true });
    const fakeNode = `#!/bin/sh\necho "fake-node-marker-${"leak"}-${"sentinel"}"\nexit 0\n`;
    writeFileSync(join(fakeHomeBin, "node"), fakeNode, { mode: 0o755 });
    writeFileSync(join(fakeTmp, "node"), fakeNode, { mode: 0o755 });
    const hookPath = join(TEST_DIR, "path-guard.sh");
    writeFileSync(
      hookPath,
      `#!/bin/bash\nresolved=$(command -v node || echo NODE_NOT_RESOLVED)\nversion=$(node --version 2>/dev/null || echo NO_VERSION)\necho "resolved=$resolved"\necho "version=$version"\necho "PATH=$PATH"\necho "hook-done"\n`,
      { mode: 0o600 },
    );
    const prevHome = process.env.HOME;
    const prevPath = process.env.PATH;
    process.env.HOME = fakeHome;
    process.env.PATH = `${fakeHomeBin}:${fakeTmp}:/usr/bin:/bin:/usr/local/bin:/sbin:/usr/sbin`;
    try {
      const result = await executeVerifiedScript({
        name: "path-guard",
        scriptPath: hookPath,
        content: await Bun.file(hookPath).arrayBuffer().then((b) => Buffer.from(b)),
        args: [],
        stdin: "",
      });
      expect(result.exitCode).toBe(0);
      expect(result.stdout).toContain("hook-done");
      expect(result.stdout, "the fake node must never run").not.toContain("fake-node-marker");
      expect(result.stdout).not.toContain("NODE_NOT_RESOLVED\nfake-node-marker");
      const pathLine = result.stdout.split("\n").find((line) => line.startsWith("PATH=")) ?? "";
      expect(pathLine, "the child PATH must not contain the fake node's dirs").not.toContain(fakeHomeBin);
      expect(pathLine).not.toContain(fakeTmp);
    } finally {
      if (prevHome === undefined) delete process.env.HOME;
      else process.env.HOME = prevHome;
      if (prevPath === undefined) delete process.env.PATH;
      else process.env.PATH = prevPath;
      rmSync(fakeTmp, { recursive: true, force: true });
    }
  });

  test("a manifest env.PATH override is honored at the live child boundary", async () => {
    const scriptPath = installCustomHook(
      "path-override",
      `const input = JSON.parse(await Bun.stdin.text());\nconsole.log(JSON.stringify({ env: process.env, want: input.want }));\n`,
      "script.ts",
      { PATH: "/custom/only" },
    );
    const res = await runHook("path-override", { session_id: "s-path" });
    expect(res.exitCode).toBe(0);
    const env = (res.output as any).env ?? {};
    expect(env.PATH, "the manifest PATH override must reach the child verbatim").toBe("/custom/only");
    void scriptPath;
  });
});
