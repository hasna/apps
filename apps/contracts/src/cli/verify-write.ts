import { readFileSync } from "node:fs";
import type { CapturedRead } from "../safe-read";
import { runCaptured } from "../safe-read-exec";
import { verifyFetchedWrite, type VerifyWriteResult } from "../verify-write";

export interface VerifyWriteCliOptions {
  authored: string;
  idPath?: string;
  contentPath?: string;
  json?: boolean;
}

interface VerifyWriteCliIo {
  log: (line: string) => void;
  err: (line: string) => void;
}

const defaultIo: VerifyWriteCliIo = {
  log: (line) => console.log(line),
  err: (line) => console.error(line)
};

function refusal(code: string, message: string) {
  return { ok: false as const, status: "refused" as const, code, message };
}

function writeResult(result: VerifyWriteResult | ReturnType<typeof refusal>, json: boolean, io: VerifyWriteCliIo): number {
  if (json) {
    io.log(JSON.stringify(result));
  } else if (result.status === "match") {
    io.log(`MATCH — ${result.message}`);
  } else if (result.status === "refused") {
    io.err(`REFUSED [${result.code}] — ${result.message}`);
  } else if (result.status === "grew") {
    io.err(`GREW BY ${result.deltaBytes} BYTES — ${result.message}`);
  } else if (result.status === "shrunk") {
    io.err(`SHRANK BY ${Math.abs(result.deltaBytes)} BYTES — ${result.message}`);
  } else {
    io.err(`MISMATCH — ${result.message}`);
  }

  if (result.status === "match") return 0;
  if (result.status === "refused") return 2;
  return 1;
}

export function runVerifyWriteCli(
  targetId: string,
  argv: string[],
  options: VerifyWriteCliOptions,
  io: VerifyWriteCliIo = defaultIo,
  run: (argv: string[]) => CapturedRead = runCaptured
): number {
  if (!targetId || !options.authored || argv.length === 0) {
    writeResult(
      refusal("usage", "target, --authored, and a fetch command after -- are required; stored body NOT rendered"),
      Boolean(options.json),
      io
    );
    return 3;
  }

  let authored: Buffer;
  try {
    authored = readFileSync(options.authored);
  } catch {
    return writeResult(
      refusal("authored_read_failed", "authored payload could not be read; stored body NOT rendered"),
      Boolean(options.json),
      io
    );
  }

  let captured: CapturedRead;
  try {
    captured = run(argv);
  } catch {
    return writeResult(
      refusal("fetch_failed", "fetch command could not be executed; captured output NOT rendered"),
      Boolean(options.json),
      io
    );
  }

  if (captured.code !== 0) {
    return writeResult(
      refusal("fetch_failed", "fetch command did not succeed; captured output NOT rendered"),
      Boolean(options.json),
      io
    );
  }

  let fetched: unknown;
  try {
    fetched = JSON.parse(captured.stdout);
  } catch {
    return writeResult(
      refusal("fetch_invalid_json", "fetch command did not return one JSON object; captured output NOT rendered"),
      Boolean(options.json),
      io
    );
  }

  const result = verifyFetchedWrite({
    targetId,
    authored,
    fetched,
    idPath: options.idPath ?? "id",
    contentPath: options.contentPath ?? "body"
  });
  return writeResult(result, Boolean(options.json), io);
}
