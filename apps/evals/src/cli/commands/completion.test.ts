import { describe, test, expect } from "bun:test";
import { join } from "path";

// Sol-guided coverage (tests-coverage-sol workflow, evals lane):
//   "Completion tests must assert bash contains _evals_completions and every
//    subcommand, zsh contains #compdef evals, and an unknown shell exits 1
//    naming bash/zsh."

const CLI = join(import.meta.dir, "../index.ts");

async function runCli(args: string[]): Promise<{ stdout: string; stderr: string; exitCode: number }> {
  const proc = Bun.spawn(["bun", "run", CLI, ...args], {
    stdout: "pipe",
    stderr: "pipe",
    env: { ...process.env, EVALS_DB_PATH: ":memory:", ANTHROPIC_API_KEY: "test-key" },
  });
  const [stdout, stderr, exitCode] = await Promise.all([
    new Response(proc.stdout).text(),
    new Response(proc.stderr).text(),
    proc.exited,
  ]);
  return { stdout, stderr, exitCode };
}

describe("evals completion bash", () => {
  test("emits the _evals_completions function and the complete binding", async () => {
    const { stdout, exitCode } = await runCli(["completion", "bash"]);
    expect(exitCode).toBe(0);
    expect(stdout).toContain("_evals_completions()");
    expect(stdout).toContain("complete -F _evals_completions evals");
  });

  test("advertises every core subcommand", async () => {
    const bash = await runCli(["completion", "bash"]);
    // The completion script's own command list (events commands are registered
    // dynamically by @hasna/events and are not part of the static completions).
    const core = ["run", "ci", "judge", "compare", "estimate", "generate", "calibrate", "capture", "doctor", "mcp", "completion", "runs"];
    for (const name of core) {
      expect(bash.stdout).toContain(name);
    }
  });
});

describe("evals completion zsh", () => {
  test("emits the #compdef evals directive", async () => {
    const { stdout, exitCode } = await runCli(["completion", "zsh"]);
    expect(exitCode).toBe(0);
    expect(stdout).toContain("#compdef evals");
  });
});

describe("evals completion unknown shell", () => {
  test("exits 1 and names bash and zsh as the supported shells", async () => {
    const { stderr, exitCode, stdout } = await runCli(["completion", "fish"]);
    expect(exitCode).toBe(1);
    expect(stdout).toBe("");
    expect(stderr).toContain("Unknown shell: fish");
    expect(stderr).toContain("bash");
    expect(stderr).toContain("zsh");
  });
});
