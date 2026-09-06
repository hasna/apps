import { redactSecrets } from "../src/lib/redact.js";

/** Test-only runner: keep the original process boundary and expose failed exits safely. */
export async function runRedactionCli(
  cliPath: string,
  env: Record<string, string>,
  args: string[],
  expectedExitCode = 0,
): Promise<{ stdout: string; stderr: string; exitCode: number }> {
  const started = performance.now();
  const proc = Bun.spawn(["bun", "run", cliPath, ...args], {
    env,
    stdout: "pipe",
    stderr: "pipe",
  });
  const [stdout, stderr, exitCode] = await Promise.all([
    new Response(proc.stdout).text(),
    new Response(proc.stderr).text(),
    proc.exited,
  ]);
  if (exitCode !== expectedExitCode) {
    // Redact before truncating: slicing through a token first could expose a
    // fragment that no longer matches a credential pattern. Never include
    // argv, environment values, or stdout (which deliberately contains leak
    // canaries in these tests). Keep the original exit/content assertions too.
    const safeStderr = redactSecrets(stderr).trim();
    throw new Error("Redaction CLI fixture exited unexpectedly: " + JSON.stringify({
      expectedExitCode,
      exitCode,
      signalCode: proc.signalCode,
      elapsedMs: Math.round(performance.now() - started),
      stderr: safeStderr.slice(0, 4000),
      stderrTruncated: safeStderr.length > 4000,
      stdoutBytes: Buffer.byteLength(stdout),
    }));
  }
  return { stdout: stdout.trim(), stderr: stderr.trim(), exitCode };
}
