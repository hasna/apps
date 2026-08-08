import { parentPort } from "node:worker_threads";
import { extractTextFromBuffer } from "../lib/extraction.js";
import type { ExtractTextFromBufferInput } from "../lib/extraction.js";

interface HostedExtractionWorkerInput extends Omit<ExtractTextFromBufferInput, "redact_patterns"> {
  redact_patterns?: string[];
}

interface HostedExtractionWorkerSuccess {
  ok: true;
  result: ReturnType<typeof extractTextFromBuffer>;
}

interface HostedExtractionWorkerFailure {
  ok: false;
  error: {
    name: string;
    message: string;
  };
}

const port = parentPort;
if (!port) {
  throw new Error("Hosted extraction worker requires a parent port.");
}

port.once("message", (input: HostedExtractionWorkerInput) => {
  try {
    const result = extractTextFromBuffer({
      ...input,
      bytes: Buffer.from(input.bytes),
      redact_patterns: (input.redact_patterns ?? []).map((pattern) => new RegExp(pattern, "g")),
    });
    port.postMessage({ ok: true, result } satisfies HostedExtractionWorkerSuccess);
  } catch (error) {
    port.postMessage({
      ok: false,
      error: {
        name: error instanceof Error ? error.name : "Error",
        message: error instanceof Error ? error.message : String(error),
      },
    } satisfies HostedExtractionWorkerFailure);
  }
});
