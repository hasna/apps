import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import {
  chmodSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  appsListText,
  discoverApps,
  findInPath,
  globalDirs,
  helpText,
  main,
  missingMessage,
  readAppVersion,
  resolveApp,
} from "../src/cli/index.ts";

let work: string;
let binDir: string;
let globalDir: string;
let origPath: string;
let origDirs: string | undefined;

function writeExec(path: string, content: string) {
  writeFileSync(path, content);
  chmodSync(path, 0o755);
}

function mkpkg(dir: string, pkg: object) {
  mkdirSync(join(globalDir, dir), { recursive: true });
  writeFileSync(join(globalDir, dir, "package.json"), JSON.stringify(pkg));
}

beforeAll(() => {
  work = mkdtempSync(join(tmpdir(), "hasna-cli-test-"));
  binDir = join(work, "bin");
  globalDir = join(work, "global", "node_modules", "@hasna");
  mkdirSync(binDir, { recursive: true });
  mkdirSync(globalDir, { recursive: true });

  writeExec(
    join(binDir, "argv-dump"),
    `#!/usr/bin/env bash\n{ [ $# -gt 0 ] && printf '%s\\n' "$@" || true; } > "$DUMP_OUT"\n`,
  );
  writeExec(join(binDir, "exit-42"), `#!/usr/bin/env bash\nexit 42\n`);
  writeExec(join(binDir, "shield.sh"), `#!/usr/bin/env bash\nexit 0\n`);
  writeExec(join(binDir, "open-signatures"), `#!/usr/bin/env bash\nexit 0\n`);

  mkpkg("realone", { name: "@hasna/realone", version: "1.2.3", bin: { realone: "dist/cli.js" } });
  mkpkg("realtwo", { name: "@hasna/realtwo", version: "2.0.0", bin: { rt2: "dist/cli.js" } });
  mkpkg("stringbin", { name: "@hasna/stringbin", version: "3.0.0", bin: "dist/index.js" });
  mkpkg("stale.bak-1.0.0", { name: "@hasna/stale", version: "9.9.9", bin: { stale: "x" } });
  mkpkg("stale.old", { name: "@hasna/stale", version: "9.9.9", bin: { stale: "x" } });
  mkpkg("stale.pre-0.1", { name: "@hasna/stale", version: "9.9.9", bin: { stale: "x" } });
  mkpkg("nobin", { name: "@hasna/nobin", version: "0.9.0" });
  writeFileSync(join(globalDir, "not-a-dir.txt"), "junk");

  origPath = process.env.PATH ?? "";
  origDirs = process.env.HASNA_CLI_GLOBAL_DIRS;
  process.env.PATH = binDir + ":/usr/bin:/bin";
  process.env.HASNA_CLI_GLOBAL_DIRS = globalDir;
});

afterAll(() => {
  process.env.PATH = origPath;
  if (origDirs === undefined) delete process.env.HASNA_CLI_GLOBAL_DIRS;
  else process.env.HASNA_CLI_GLOBAL_DIRS = origDirs;
  rmSync(work, { recursive: true, force: true });
});

describe("argv passthrough", () => {
  test("byte-exact argv reaches the child", async () => {
    const dump = join(work, "argv.txt");
    process.env.DUMP_OUT = dump;
    const code = await main(["app", "argv-dump", "--flag", "value", "multi word", "-x=1"]);
    expect(code).toBe(0);
    const lines = readFileSync(dump, "utf8").trimEnd().split("\n");
    expect(lines).toEqual(["--flag", "value", "multi word", "-x=1"]);
  });

  test("empty args pass through", async () => {
    const dump = join(work, "argv2.txt");
    process.env.DUMP_OUT = dump;
    const code = await main(["app", "argv-dump"]);
    expect(code).toBe(0);
    expect(readFileSync(dump, "utf8")).toBe("");
  });
});

describe("exit code passthrough", () => {
  test("child exit code is propagated", async () => {
    expect(await main(["app", "exit-42"])).toBe(42);
  });
});

describe("missing app", () => {
  test("returns 127", async () => {
    expect(await main(["app", "definitely-missing-app"])).toBe(127);
  });

  test("message carries install hint and known apps", () => {
    const m = missingMessage("definitely-missing-app");
    expect(m).toContain("bun install -g @hasna/definitely-missing-app");
    expect(m).toContain("todos");
    expect(m).toContain("conversations");
  });
});

describe("discovery", () => {
  test("skips .bak/.old/.pre- and no-bin dirs", () => {
    const names = discoverApps(globalDir).map((a) => a.name);
    expect(names).toContain("realone");
    expect(names).toContain("realtwo");
    expect(names).toContain("stringbin");
    expect(names).not.toContain("stale");
    expect(names).not.toContain("nobin");
  });

  test("bins are read from package.json", () => {
    const realtwo = discoverApps(globalDir).find((a) => a.name === "realtwo");
    expect(realtwo?.bins).toEqual(["rt2"]);
  });

  test("missing dir yields empty list", () => {
    expect(discoverApps(join(work, "does-not-exist"))).toEqual([]);
  });
});

describe("resolution", () => {
  test("exact bin name resolves in PATH first", () => {
    expect(resolveApp("argv-dump")).toBe(join(binDir, "argv-dump"));
  });

  test("discovery table maps signatures -> open-signatures", () => {
    expect(resolveApp("signatures")).toBe(join(binDir, "open-signatures"));
  });

  test("discovery table maps shield -> shield.sh", () => {
    expect(resolveApp("shield")).toBe(join(binDir, "shield.sh"));
  });

  test("unknown app resolves to null", () => {
    expect(resolveApp("no-such-bin-anywhere")).toBeNull();
  });

  test("findInPath ignores non-executable files", () => {
    writeFileSync(join(binDir, "plain"), "not executable\n");
    expect(findInPath("plain")).toBeNull();
  });
});

describe("status", () => {
  test("reads version from global package.json", () => {
    expect(readAppVersion("realone", [globalDir])).toBe("1.2.3");
    expect(readAppVersion("nobin", [globalDir])).toBe("0.9.0");
    expect(readAppVersion("missing-pkg", [globalDir])).toBeNull();
  });

  test("apps status exits 0 for installed app", async () => {
    expect(await main(["apps", "status", "realone"])).toBe(0);
  });

  test("apps status exits 1 for missing app", async () => {
    expect(await main(["apps", "status", "missing-pkg"])).toBe(1);
  });
});

describe("help and version", () => {
  test("help lists every command", () => {
    const h = helpText();
    for (const cmd of [
      "hasna app <name>",
      "hasna apps list",
      "hasna apps status",
      "hasna apps install",
      "hasna apps update",
      "hasna doctor",
      "hasna version",
    ]) {
      expect(h).toContain(cmd);
    }
  });

  test("--help exits 0", async () => {
    expect(await main(["--help"])).toBe(0);
  });

  test("version exits 0", async () => {
    expect(await main(["version"])).toBe(0);
  });

  test("unknown command exits 1", async () => {
    expect(await main(["frobnicate"])).toBe(1);
  });
});

describe("apps list", () => {
  test("lists discovered apps", async () => {
    expect(await main(["apps", "list"])).toBe(0);
    const text = appsListText();
    expect(text).toContain("realone");
    expect(text).not.toContain("stale");
  });
});
