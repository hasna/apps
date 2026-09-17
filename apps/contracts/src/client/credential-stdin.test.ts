import { expect, test } from "bun:test";

test("importing the built credential transport preserves caller stdin", async () => {
  const transport = new URL("../../dist/client/transport.js", import.meta.url).href;
  const input = '{"fixture":"credential transport must preserve this request"}\n';
  const code = `await import(${JSON.stringify(transport)}); await new Promise(resolve => setTimeout(resolve, 25)); let input = ''; for await (const chunk of process.stdin) input += chunk; process.stdout.write(input);`;
  for (const kind of ["blob", "pipe"] as const) {
    const child = Bun.spawn([process.execPath, "--no-env-file", "-e", code], {
      env: { PATH: process.env.PATH },
      stdin: kind === "blob" ? new Blob([input]) : "pipe",
      stdout: "pipe", stderr: "pipe",
    });
    const timer = setTimeout(() => child.kill("SIGKILL"), 10_000);
    try {
      if (kind === "pipe") {
        const writer = child.stdin as import("bun").FileSink;
        writer.write(input);
        await writer.end();
      }
      const [exit, stdout, stderr] = await Promise.all([
        child.exited, new Response(child.stdout).text(), new Response(child.stderr).text(),
      ]);
      expect(exit, kind).toBe(0);
      expect(stderr, kind).toBe("");
      expect(stdout, kind).toBe(input);
    } finally { clearTimeout(timer); }
  }
});
