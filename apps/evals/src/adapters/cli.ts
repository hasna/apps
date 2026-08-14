import type { CliAdapterConfig } from "../types/index.js";
import type { AdapterResponse } from "./http.js";

export async function callCliAdapter(
  config: CliAdapterConfig,
  input: string
): Promise<AdapterResponse> {
  const start = Date.now();

  try {
    const command = config.command.replace("{{input}}", input);
    const proc = Bun.spawn(["bash", "-c", command], {
      stdin: "pipe",
      stdout: "pipe",
      stderr: "pipe",
      env: { ...process.env, ...config.env },
    });

    // Write input to stdin then close it
    proc.stdin.write(input);
    proc.stdin.end();

    // Apply timeout
    const timeoutMs = config.timeoutMs ?? 30_000;
    const timeoutId = setTimeout(() => proc.kill(), timeoutMs);

    const [stdout, _stderr, exitCode] = await Promise.all([
      new Response(proc.stdout).text(),
      new Response(proc.stderr).text(),
      proc.exited,
    ]);

    clearTimeout(timeoutId);

    if (exitCode !== 0) {
      return {
        output: stdout,
        durationMs: Date.now() - start,
        error: `CLI exited with code ${exitCode}`,
      };
    }

    return { output: stdout.trim(), durationMs: Date.now() - start };
  } catch (err) {
    return {
      output: "",
      durationMs: Date.now() - start,
      error: err instanceof Error ? err.message : String(err),
    };
  }
}
