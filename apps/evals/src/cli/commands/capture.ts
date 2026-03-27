import { Command } from "commander";
import { createServer } from "http";
import { appendFileSync, writeFileSync } from "fs";
import type { EvalCase } from "../../types/index.js";

export function captureCommand(): Command {
  return new Command("capture")
    .description("Capture production traffic and write to a staging dataset")
    .requiredOption("--app <url>", "Upstream app URL to proxy to")
    .option("--port <n>", "Proxy port", "19441")
    .option("--rate <n>", "Sampling rate 0.0–1.0", "0.1")
    .option("--output <path>", "Output JSONL file", "captured.jsonl")
    .action((opts: Record<string, string>) => {
      const appUrl = opts["app"] ?? "";
      const port = parseInt(opts["port"] ?? "19441");
      const rate = parseFloat(opts["rate"] ?? "0.1");
      const output = opts["output"] ?? "captured.jsonl";
      let captured = 0;

      writeFileSync(output, ""); // reset

      const server = createServer(async (req, res) => {
        const body = await new Promise<string>((resolve) => {
          let data = "";
          req.on("data", (chunk) => { data += chunk; });
          req.on("end", () => resolve(data));
        });

        // Proxy to upstream
        const upstreamRes = await fetch(`${appUrl}${req.url}`, {
          method: req.method,
          headers: Object.fromEntries(Object.entries(req.headers).filter(([, v]) => v !== undefined)) as Record<string, string>,
          body: req.method !== "GET" ? body : undefined,
        });

        const responseBody = await upstreamRes.text();

        // Forward response to client
        res.writeHead(upstreamRes.status, Object.fromEntries(upstreamRes.headers));
        res.end(responseBody);

        // Sample at configured rate
        if (Math.random() < rate) {
          try {
            const reqJson = JSON.parse(body) as Record<string, unknown>;
            const resJson = JSON.parse(responseBody) as Record<string, unknown>;
            const input = String(
              (reqJson["messages"] as Array<{ content: string }>)?.at(-1)?.content ??
              reqJson["input"] ?? body
            );
            const output = String(
              (resJson["choices"] as Array<{ message: { content: string } }>)?.[0]?.message?.content ??
              resJson["content"] ?? responseBody
            );

            const evalCase: EvalCase = {
              id: `captured-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`,
              input,
              expected: "Review and add expected behavior before promoting to eval suite",
              tags: ["captured", "needs-review"],
              metadata: { capturedAt: new Date().toISOString(), responsePreview: output.slice(0, 200) },
            };

            appendFileSync(output, JSON.stringify(evalCase) + "\n");
            captured++;
            if (captured % 10 === 0) console.log(`Captured ${captured} cases → ${output}`);
          } catch { /* non-JSON traffic, skip */ }
        }
      });

      server.listen(port, () => {
        console.log(`\x1b[32m✓ Capture proxy running on http://localhost:${port}\x1b[0m`);
        console.log(`  Forwarding to: ${appUrl}`);
        console.log(`  Sampling rate: ${(rate * 100).toFixed(0)}%`);
        console.log(`  Output: ${output}`);
        console.log("  Ctrl+C to stop\n");
      });
    });
}
