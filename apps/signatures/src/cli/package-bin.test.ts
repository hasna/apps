import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import {
  copyFileSync,
  existsSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

interface PackageManifest {
  version: string;
  bin: Record<string, string>;
}

const packagePath = fileURLToPath(
  new URL("../../package.json", import.meta.url),
);
const packageRoot = dirname(packagePath);
const packageManifest = JSON.parse(
  readFileSync(packagePath, "utf8"),
) as PackageManifest;
const launcherBin = join(packageRoot, packageManifest.bin["open-signatures"]!);
const scratchDir = mkdtempSync(join(tmpdir(), "open-signatures-cli-"));
const childPidPath = join(scratchDir, "cli.pid");

function isRunning(pid: number): boolean {
  try {
    process.kill(pid, 0);
    return true;
  } catch {
    return false;
  }
}

async function waitFor(
  condition: () => boolean,
  timeoutMs: number,
): Promise<boolean> {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    if (condition()) return true;
    await Bun.sleep(25);
  }
  return condition();
}

beforeAll(() => {
  // Build through the package script rather than a test-local Bun.build, so a
  // bin that scripts.build:js stops emitting fails here instead of at `npm i -g`.
  const build = Bun.spawnSync({
    cmd: [process.execPath, "run", "build:js"],
    cwd: packageRoot,
    stdout: "pipe",
    stderr: "pipe",
  });
  if (build.exitCode !== 0) {
    throw new Error(`bun run build:js failed: ${build.stderr.toString()}`);
  }
});

afterAll(() => {
  if (existsSync(childPidPath)) {
    const pid = Number(readFileSync(childPidPath, "utf8"));
    if (Number.isInteger(pid) && isRunning(pid)) process.kill(pid, "SIGKILL");
  }
  rmSync(scratchDir, { recursive: true, force: true });
});

describe("package CLI binaries", () => {
  test("exposes both CLI names through the Node-safe launcher", () => {
    expect(packageManifest.bin["open-signatures"]).toBe(
      "dist/cli/launcher.js",
    );
    expect(packageManifest.bin["signatures"]).toBe("dist/cli/launcher.js");
    expect(packageManifest.bin["signatures-mcp"]).toBe("dist/mcp/index.js");
    expect(packageManifest.bin["signatures-serve"]).toBe(
      "dist/server/index.js",
    );
  });

  test("emits every declared bin from the package build", () => {
    const missing = Object.entries(packageManifest.bin)
      .filter(([, relativePath]) => !existsSync(join(packageRoot, relativePath)))
      .map(([name, relativePath]) => `${name} -> ${relativePath}`);

    expect(missing).toEqual([]);
  });

  test("launches the Bun-only CLI when a package shim invokes it with Node", () => {
    const nodePath = Bun.which("node");
    expect(nodePath).not.toBeNull();

    const result = Bun.spawnSync({
      cmd: [nodePath as string, launcherBin, "--version"],
      env: {
        ...process.env,
        HASNA_SIGNATURES_DB_PATH: join(scratchDir, "signatures.db"),
      },
      stdout: "pipe",
      stderr: "pipe",
    });
    const stderr = result.stderr.toString();

    expect(stderr).not.toContain("ERR_UNSUPPORTED_ESM_URL_SCHEME");
    expect(result.exitCode).toBe(0);
    expect(result.stdout.toString().trim()).toBe(packageManifest.version);
  });

  test("forwards termination signals instead of orphaning the Bun CLI", async () => {
    const nodePath = Bun.which("node");
    expect(nodePath).not.toBeNull();

    // The launcher resolves its CLI as ./index.js next to itself, so a stub
    // beside a copy of the shipped launcher gives us a long-lived child.
    copyFileSync(launcherBin, join(scratchDir, "launcher.js"));
    writeFileSync(
      join(scratchDir, "index.js"),
      [
        'import { writeFileSync } from "node:fs";',
        `writeFileSync(${JSON.stringify(childPidPath)}, String(process.pid));`,
        "await new Promise((resolve) => setTimeout(resolve, 60_000));",
        "",
      ].join("\n"),
    );

    const launcher = Bun.spawn({
      cmd: [nodePath as string, join(scratchDir, "launcher.js")],
      stdout: "pipe",
      stderr: "pipe",
    });

    expect(await waitFor(() => existsSync(childPidPath), 5_000)).toBe(true);
    const childPid = Number(readFileSync(childPidPath, "utf8"));
    expect(await waitFor(() => isRunning(childPid), 5_000)).toBe(true);

    launcher.kill("SIGTERM");
    await launcher.exited;

    expect(await waitFor(() => !isRunning(childPid), 5_000)).toBe(true);
    expect(launcher.signalCode).toBe("SIGTERM");
  }, 30_000);
});
