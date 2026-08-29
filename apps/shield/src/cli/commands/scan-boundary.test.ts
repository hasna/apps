import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { execFileSync, spawnSync } from "child_process";
import { mkdtempSync, rmSync, symlinkSync, writeFileSync } from "fs";
import { tmpdir } from "os";
import { join } from "path";

describe("CLI scan source and error boundaries", () => {
  let tempDir: string;
  let repoDir: string;
  let env: NodeJS.ProcessEnv;

  beforeEach(() => {
    tempDir = mkdtempSync(join(tmpdir(), "shield-cli-boundary-"));
    repoDir = join(tempDir, "repo");
    execFileSync("mkdir", ["-p", repoDir]);
    env = {
      ...process.env,
      HOME: tempDir,
      USERPROFILE: tempDir,
      SECURITY_DB: join(tempDir, "shield.db"),
      CEREBRAS_API_KEY: "",
    };
  });

  afterEach(() => rmSync(tempDir, { recursive: true, force: true }));

  test("ordinary scan omits history until the current command explicitly opts in", () => {
    const syntheticSecret = "ghp" + "_SYNTHETICONLYABCDEFGHIJKLMNOPQRSTUVWXYZ12";
    execFileSync("git", ["init", "-q"], { cwd: repoDir });
    execFileSync("git", ["config", "user.email", "synthetic@example.invalid"], { cwd: repoDir });
    execFileSync("git", ["config", "user.name", "Synthetic Test"], { cwd: repoDir });
    writeFileSync(join(repoDir, "history.txt"), `TOKEN=${syntheticSecret}\n`, "utf-8");
    execFileSync("git", ["add", "history.txt"], { cwd: repoDir });
    execFileSync("git", ["commit", "-qm", "synthetic secret"], { cwd: repoDir });
    writeFileSync(join(repoDir, "history.txt"), "safe=true\n", "utf-8");
    execFileSync("git", ["add", "history.txt"], { cwd: repoDir });
    execFileSync("git", ["commit", "-qm", "remove synthetic secret"], { cwd: repoDir });

    const normal = spawnSync("bun", ["run", "src/cli/index.tsx", "scan", repoDir, "--format", "json"], {
      cwd: process.cwd(), env, encoding: "utf-8",
    });
    expect(normal.status).toBe(0);
    expect(normal.stderr).not.toContain("git-history");
    expect(normal.stdout).not.toContain(syntheticSecret);

    const optedIn = spawnSync("bun", ["run", "src/cli/index.tsx", "scan", repoDir, "--format", "json", "--git-history"], {
      cwd: process.cwd(), env, encoding: "utf-8",
    });
    expect(optedIn.stderr).toContain("git-history");
    expect(`${optedIn.stdout}${optedIn.stderr}`).not.toContain(syntheticSecret);
  });

  test("completed JSON scan metadata matches the persisted findings", () => {
    const scheme = "postgres" + "://";
    const credentials = "app" + ":" + "Th3R3alPassw0rd!";
    writeFileSync(
      join(repoDir, "database.ts"),
      `const databaseUrl = "${scheme}${credentials}@db.prod.internal:5432/example";\n`,
    );

    const result = spawnSync(
      "bun",
      ["run", "src/cli/index.tsx", "scan", repoDir, "--scanner", "secrets", "--format", "json"],
      { cwd: process.cwd(), env, encoding: "utf-8" },
    );

    expect(result.status).toBe(1);
    const report = JSON.parse(result.stdout);
    expect(report.scan.status).toBe("completed");
    expect(report.findings).toHaveLength(1);
    expect(report.summary.total_findings).toBe(1);
    expect(report.scan.findings_count).toBe(report.findings.length);
    expect(report.scan.completed_at).toBeString();
    expect(report.scan.duration_ms).toBeNumber();
    expect(report.scan.duration_ms).toBeGreaterThanOrEqual(0);
  });

  test("files-only command scans regular files and withholds failing paths", () => {
    const syntheticSecret = "ghp" + "_SYNTHETICONLYABCDEFGHIJKLMNOPQRSTUVWXYZ12";
    const file = join(tempDir, "synthetic.env");
    writeFileSync(file, `TOKEN=${syntheticSecret}\n`, "utf-8");
    const regular = spawnSync("bun", ["run", "src/cli/index.tsx", "secrets", file, "--files-only", "--json"], {
      cwd: process.cwd(), env, encoding: "utf-8",
    });
    expect(regular.status).toBe(1);
    expect(regular.stdout).toContain('"total"');
    expect(regular.stdout).not.toContain(syntheticSecret);

    const loop = join(tempDir, syntheticSecret);
    symlinkSync(loop, loop);
    const failed = spawnSync("bun", ["run", "src/cli/index.tsx", "secrets", loop, "--files-only", "--json"], {
      cwd: process.cwd(), env, encoding: "utf-8",
    });
    expect(failed.status).toBe(1);
    expect(`${failed.stdout}${failed.stderr}`).not.toContain(syntheticSecret);
  });
});
