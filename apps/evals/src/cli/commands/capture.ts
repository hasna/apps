import { Command } from "commander";
import { createServer } from "http";
import { appendFileSync, writeFileSync } from "fs";
import type { EvalCase } from "../../types/index.js";

interface CaptureEvalCaseOptions {
  now?: Date;
  random?: () => number;
}

function readLatestMessageContent(messages: unknown): string | undefined {
  if (!Array.isArray(messages)) return undefined;
  const latest = messages.at(-1);
  if (!latest || typeof latest !== "object") return undefined;
  const content = (latest as Record<string, unknown>)["content"];
  return typeof content === "string" ? content : undefined;
}

function readOpenAIContent(response: Record<string, unknown>): string | undefined {
  const choices = response["choices"];
  if (!Array.isArray(choices)) return undefined;
  const first = choices[0];
  if (!first || typeof first !== "object") return undefined;
  const message = (first as Record<string, unknown>)["message"];
  if (!message || typeof message !== "object") return undefined;
  const content = (message as Record<string, unknown>)["content"];
  return typeof content === "string" ? content : undefined;
}

export function buildCapturedEvalCase(
  requestBody: string,
  responseBody: string,
  options: CaptureEvalCaseOptions = {}
): EvalCase | null {
  try {
    const reqJson = JSON.parse(requestBody) as Record<string, unknown>;
    const resJson = JSON.parse(responseBody) as Record<string, unknown>;
    const input = String(
      readLatestMessageContent(reqJson["messages"]) ??
      reqJson["input"] ?? requestBody
    );
    const responseText = String(
      readOpenAIContent(resJson) ??
      resJson["content"] ?? responseBody
    );
    const capturedAt = (options.now ?? new Date()).toISOString();
    const suffix = (options.random ?? Math.random)().toString(36).slice(2, 7);

    return {
      id: `captured-${Date.parse(capturedAt)}-${suffix}`,
      input,
      expected: "Review and add expected behavior before promoting to eval suite",
      tags: ["captured", "needs-review"],
      metadata: {
        capturedAt,
        responsePreview: responseText.slice(0, 200),
      },
    };
  } catch {
    return null;
  }
}

export function appendCapturedEvalCase(outputPath: string, evalCase: EvalCase): void {
  appendFileSync(outputPath, JSON.stringify(evalCase) + "\n");
}

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
      const outputPath = opts["output"] ?? "captured.jsonl";
      let captured = 0;

      writeFileSync(outputPath, ""); // reset

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
          const evalCase = buildCapturedEvalCase(body, responseBody);
          if (evalCase) {
            appendCapturedEvalCase(outputPath, evalCase);
            captured++;
            if (captured % 10 === 0) console.log(`Captured ${captured} cases → ${outputPath}`);
          }
        }
      });

      server.listen(port, () => {
        console.log(`\x1b[32m✓ Capture proxy running on http://localhost:${port}\x1b[0m`);
        console.log(`  Forwarding to: ${appUrl}`);
        console.log(`  Sampling rate: ${(rate * 100).toFixed(0)}%`);
        console.log(`  Output: ${outputPath}`);
        console.log("  Ctrl+C to stop\n");
      });
    });
}
