#!/usr/bin/env node

import { pathToFileURL } from "node:url";
import type {
  TodosAiRunRequest,
  TodosAiRunResult,
  TodosAiRuntimeHostContext,
} from "@hasna/todos";
import {
  DEFAULT_TODOS_AI_MODEL,
  DEFAULT_TODOS_AI_PROVIDER,
} from "./types";
import { createTodosAiRuntime } from "./runtime";

const SMOKE_PROMPT_MAX_BYTES = 4_096;
const SMOKE_OUTPUT_MAX_BYTES = 65_536;
const SMOKE_ANSWER_MAX_BYTES = 32_768;
const encoder = new TextEncoder();
const decoder = new TextDecoder();

class SmokeConfigurationError extends Error {}

export interface GroqSmokeOptions {
  prompt?: string;
  provider?: string;
  model?: string;
  signal?: AbortSignal;
  write?: (line: string) => void;
}

function bounded(value: string, maxBytes: number): string {
  const bytes = encoder.encode(value);
  if (bytes.byteLength <= maxBytes) return value;
  const suffix = "\n[truncated]";
  const suffixBytes = encoder.encode(suffix).byteLength;
  let end = Math.max(0, maxBytes - suffixBytes);
  while (end > 0 && (bytes[end] ?? 0) >> 6 === 0b10) {
    end -= 1;
  }
  return `${decoder.decode(bytes.subarray(0, end))}${suffix}`;
}

function smokeRequest(options: GroqSmokeOptions): TodosAiRunRequest {
  const prompt = options.prompt ?? "Reply with the single word OK.";
  if (encoder.encode(prompt).byteLength > SMOKE_PROMPT_MAX_BYTES) {
    throw new SmokeConfigurationError(
      `Smoke prompt exceeds ${SMOKE_PROMPT_MAX_BYTES} bytes.`,
    );
  }
  return {
    schema_version: 1,
    prompt,
    input: null,
    variables: {},
    output_schema: null,
    provider: options.provider ?? DEFAULT_TODOS_AI_PROVIDER,
    model: options.model ?? DEFAULT_TODOS_AI_MODEL,
    profile: null,
    format: "json",
    interactive: false,
    context: {
      project: null,
      agent: null,
      session: null,
    },
    authority: {
      write_mode: "read-only",
      approval_mode: "deny",
      approval_refs: [],
      dry_run: false,
    },
    limits: {
      max_steps: 1,
      timeout_ms: 30_000,
    },
    resume_run_id: null,
  };
}

function smokeReport(result: TodosAiRunResult): string {
  const report = {
    schema_version: result.schema_version,
    run_id: result.run_id,
    status: result.status,
    answer: result.answer === null
      ? null
      : bounded(result.answer, SMOKE_ANSWER_MAX_BYTES),
    steps: result.steps,
    usage: result.usage,
    error: result.error,
  };
  return bounded(JSON.stringify(report), SMOKE_OUTPUT_MAX_BYTES);
}

function resultExitCode(result: TodosAiRunResult): number {
  if (result.status === "answered" || result.status === "completed") return 0;
  if (result.error?.code === "timeout") return 124;
  if (result.error?.code === "interrupted") return 130;
  return 6;
}

export async function runGroqSmoke(options: GroqSmokeOptions = {}): Promise<number> {
  const context: TodosAiRuntimeHostContext = {
    package_name: "@hasna/todos",
    package_version: "companion-smoke",
    protocol_version: 1,
  };
  const signal = options.signal ?? new AbortController().signal;
  const runtime = createTodosAiRuntime(context);
  const result = await runtime.run(smokeRequest(options), {
    signal,
    emit() {
      // The smoke path prints only the bounded terminal report.
    },
  });
  (options.write ?? console.log)(smokeReport(result));
  return resultExitCode(result);
}

interface ParsedSmokeArgs {
  live: boolean;
  options: GroqSmokeOptions;
}

function parseArgs(args: readonly string[]): ParsedSmokeArgs {
  const options: GroqSmokeOptions = {};
  let live = false;
  for (let index = 0; index < args.length; index += 1) {
    const argument = args[index];
    if (argument === "--live") {
      live = true;
      continue;
    }
    if (argument === "--prompt" || argument === "--provider" || argument === "--model") {
      const value = args[index + 1];
      if (!value) throw new SmokeConfigurationError(`${argument} requires a value.`);
      if (argument === "--prompt") options.prompt = value;
      if (argument === "--provider") options.provider = value;
      if (argument === "--model") options.model = value;
      index += 1;
      continue;
    }
    throw new SmokeConfigurationError(`Unknown smoke option: ${argument}`);
  }
  return { live, options };
}

async function main(): Promise<number> {
  try {
    const parsed = parseArgs(process.argv.slice(2));
    if (!parsed.live) {
      console.error(
        "Live Groq smoke is opt-in. Re-run with --live after providing GROQ_API_KEY to the process environment.",
      );
      return 2;
    }
    return await runGroqSmoke(parsed.options);
  } catch (error) {
    const message = error instanceof SmokeConfigurationError
      ? error.message
      : "Groq smoke failed safely.";
    console.error(bounded(message, 1_024));
    return 2;
  }
}

const invokedPath = process.argv[1];
if (invokedPath && import.meta.url === pathToFileURL(invokedPath).href) {
  process.exitCode = await main();
}
