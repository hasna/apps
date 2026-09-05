import { randomUUID } from "node:crypto";
import { writeSync } from "node:fs";
import type { Command } from "commander";
import {
  TODOS_AI_DEFAULTS,
  TODOS_AI_EXIT_CODES,
  TODOS_AI_FORMATS,
  TODOS_AI_LIMITS,
  TODOS_AI_RUNTIME_PROTOCOL_VERSION,
  TODOS_AI_SCHEMA_VERSION,
  TodosAiContractError,
  assertTodosAiRunResult,
  createTodosAiFailureResult,
  createTodosAiNeedsInputResult,
  isTodosAiRuntimeEvent,
  loadTodosAiRuntime,
  normalizeTodosAiPrompt,
  parseTodosAiJson,
  parseTodosAiOutputSchema,
  parseTodosAiVariables,
  resolveTodosAiCommandOptions,
  todosAiExitCodeForResult,
  type TodosAiFormat,
  type TodosAiRunRequest,
  type TodosAiRunResult,
  type TodosAiRuntimeEvent,
  type TodosAiStoredConfig,
  type TodosAiStreamRecord,
} from "../../ai.js";
import { createTodosAiToolSource } from "../../ai-tools.js";
import { getTodosAiConfig } from "../../lib/config.js";
import { env } from "../../lib/env.js";
import { getPackageVersion } from "../../lib/package-version.js";

interface TodosAiCliOptions {
  format?: string;
  inputJson?: string;
  input?: string;
  var?: string[];
  outputSchema?: string;
  provider?: string;
  model?: string;
  profile?: string;
  writeMode?: string;
  approvalMode?: string;
  approval?: string[];
  dryRun?: boolean;
  maxSteps?: string;
  timeoutMs?: string;
  resume?: string;
  nonInteractive?: boolean;
}

function appendOption(value: string, previous: string[]): string[] {
  return [...previous, value];
}

function globalOptions(program: Command): Record<string, unknown> {
  const command = program as Command & { optsWithGlobals?: () => Record<string, unknown> };
  return command.optsWithGlobals?.() ?? program.opts();
}

function commandRawArgs(command: Command): readonly string[] {
  let root = command;
  while (root.parent) root = root.parent;
  const rawArgs = (root as Command & { rawArgs?: string[] }).rawArgs;
  return rawArgs && rawArgs.length > 0 ? rawArgs : process.argv;
}

function commanderJsonRequested(command: Command): boolean {
  const args = commandRawArgs(command);
  let globalJson = false;
  let format: string | undefined;
  for (let index = 0; index < args.length; index += 1) {
    const arg = args[index];
    if (arg === undefined) continue;
    if (arg === "--") break;
    if (arg === "--json" || arg === "-j") {
      globalJson = true;
    } else if (arg.startsWith("--format=")) {
      format = arg.slice("--format=".length);
    } else if (arg === "--format") {
      format = args[index + 1];
      index += 1;
    }
  }
  return format === undefined ? globalJson : format === "json";
}

function optionalString(value: unknown): string | null {
  if (typeof value !== "string") return null;
  const trimmed = value.trim();
  return trimmed || null;
}

function requestedErrorFormat(
  options: TodosAiCliOptions,
  globalOpts: Record<string, unknown>,
  configFormat?: unknown,
): TodosAiFormat {
  if (TODOS_AI_FORMATS.includes(options.format as TodosAiFormat)) {
    return options.format as TodosAiFormat;
  }
  if (globalOpts["json"] === true) return "json";
  const envFormat = env.aiFormat();
  if (TODOS_AI_FORMATS.includes(envFormat as TodosAiFormat)) return envFormat as TodosAiFormat;
  if (TODOS_AI_FORMATS.includes(configFormat as TodosAiFormat)) {
    return configFormat as TodosAiFormat;
  }
  return TODOS_AI_DEFAULTS.format;
}

function loadTodosAiStoredConfig(): TodosAiStoredConfig | undefined {
  let ai: unknown;
  try {
    ai = getTodosAiConfig();
  } catch (cause) {
    throw new TodosAiContractError(
      "invalid_configuration",
      "Todos AI configuration could not be read",
      TODOS_AI_EXIT_CODES.usage,
      { cause },
    );
  }
  if (ai !== undefined && (ai === null || typeof ai !== "object" || Array.isArray(ai))) {
    throw new TodosAiContractError(
      "invalid_configuration",
      "Todos AI configuration must be an object",
    );
  }
  if (ai === undefined) return undefined;

  const record = ai as Record<string, unknown>;
  for (const field of [
    "provider",
    "model",
    "profile",
    "format",
    "write_mode",
    "approval_mode",
  ]) {
    if (record[field] !== undefined && typeof record[field] !== "string") {
      throw new TodosAiContractError(
        "invalid_configuration",
        `Todos AI configuration field ${field} must be a string`,
      );
    }
  }
  for (const field of ["max_steps", "timeout_ms"]) {
    if (record[field] !== undefined && typeof record[field] !== "number") {
      throw new TodosAiContractError(
        "invalid_configuration",
        `Todos AI configuration field ${field} must be a number`,
      );
    }
  }
  return record as unknown as TodosAiStoredConfig;
}

async function readBoundedStdin(): Promise<string> {
  const chunks: Buffer[] = [];
  let bytes = 0;
  for await (const chunk of process.stdin) {
    const buffer = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk);
    bytes += buffer.byteLength;
    if (bytes > TODOS_AI_LIMITS.max_prompt_bytes) {
      throw new TodosAiContractError(
        "invalid_input",
        `stdin prompt exceeds ${TODOS_AI_LIMITS.max_prompt_bytes} bytes`,
      );
    }
    chunks.push(buffer);
  }
  return Buffer.concat(chunks, bytes).toString("utf8");
}

function normalizeResumeRunId(value: string | undefined): string | null {
  const runId = optionalString(value);
  if (!runId) return null;
  if (Buffer.byteLength(runId, "utf8") > TODOS_AI_LIMITS.max_resume_run_id_bytes) {
    throw new TodosAiContractError(
      "invalid_input",
      `--resume may not exceed ${TODOS_AI_LIMITS.max_resume_run_id_bytes} bytes`,
    );
  }
  return runId;
}

function resultJson(result: TodosAiRunResult): string {
  const serialized = JSON.stringify(result);
  if (Buffer.byteLength(serialized, "utf8") > TODOS_AI_LIMITS.max_result_bytes) {
    throw new TodosAiContractError(
      "runtime_invalid_result",
      `optional AI runtime result exceeds ${TODOS_AI_LIMITS.max_result_bytes} bytes`,
      TODOS_AI_EXIT_CODES.failed,
    );
  }
  return serialized;
}

function renderTextResult(result: TodosAiRunResult): void {
  switch (result.status) {
    case "answered":
    case "completed":
      if (result.answer) {
        console.log(result.answer);
      } else if (result.data !== null) {
        console.log(JSON.stringify(result.data, null, 2));
      } else {
        console.log(`AI run ${result.run_id} completed.`);
      }
      return;
    case "needs_input":
      console.log(result.pending_input?.prompt ?? "The AI runtime needs additional input.");
      return;
    case "needs_approval":
      console.log(result.pending_approval?.summary ?? "The AI runtime needs approval.");
      if (result.pending_approval?.id) console.log(`Approval: ${result.pending_approval.id}`);
      return;
    case "failed":
      console.error(result.error?.message ?? "The AI runtime failed.");
  }
}

function renderTerminalResult(result: TodosAiRunResult, format: TodosAiFormat): void {
  const serialized = resultJson(result);
  if (format === "json") {
    console.log(serialized);
    return;
  }
  if (format === "stream-json") {
    const record: TodosAiStreamRecord = {
      schema_version: TODOS_AI_SCHEMA_VERSION,
      kind: "result",
      result,
    };
    console.log(JSON.stringify(record));
    return;
  }
  renderTextResult(result);
}

function errorResult(
  runId: string,
  error: unknown,
): TodosAiRunResult {
  if (error instanceof TodosAiContractError) {
    return createTodosAiFailureResult(runId, error.code, error.message);
  }
  return createTodosAiFailureResult(
    runId,
    "internal_error",
    "optional AI runtime failed",
  );
}

async function withLoadDeadline<T>(
  operation: () => Promise<T>,
  controller: AbortController,
  timeoutMs: number,
): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    let settled = false;
    const settle = (callback: () => void): void => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      callback();
    };
    const timer = setTimeout(() => {
      const error = new TodosAiContractError(
        "timeout",
        `AI run timed out after ${timeoutMs}ms`,
        TODOS_AI_EXIT_CODES.timeout,
      );
      controller.abort(error);
      settle(() => reject(error));
    }, timeoutMs);

    Promise.resolve()
      .then(operation)
      .then(
        (value) => settle(() => resolve(value)),
        (error: unknown) => settle(() => reject(error)),
      );
  });
}

async function withInterrupt<T>(
  operation: () => Promise<T>,
  controller: AbortController,
): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    let settled = false;
    const settle = (callback: () => void): void => {
      if (settled) return;
      settled = true;
      process.removeListener("SIGINT", onInterrupt);
      callback();
    };
    const onInterrupt = (): void => {
      const error = new TodosAiContractError(
        "interrupted",
        "AI run interrupted",
        TODOS_AI_EXIT_CODES.interrupted,
      );
      controller.abort(error);
      settle(() => reject(error));
    };
    process.once("SIGINT", onInterrupt);

    Promise.resolve()
      .then(operation)
      .then(
        (value) => settle(() => resolve(value)),
        (error: unknown) => settle(() => reject(error)),
      );
  });
}

function throwIfAborted(signal: AbortSignal): void {
  if (!signal.aborted) return;
  if (signal.reason instanceof Error) throw signal.reason;
  throw new TodosAiContractError(
    "interrupted",
    "AI run interrupted",
    TODOS_AI_EXIT_CODES.interrupted,
  );
}

interface RuntimeEventSink {
  emit(event: TodosAiRuntimeEvent): void;
  assertResult(result: TodosAiRunResult, maxSteps: number): void;
  raceWithFailure<T>(operation: Promise<T>): Promise<T>;
  failureRunId(fallback: string): string;
  close(): void;
}

function createRuntimeEventSink(
  format: TodosAiFormat,
  controller: AbortController,
  expectedRunId: string | null,
): RuntimeEventSink {
  let eventCount = 0;
  let streamBytes = 0;
  let lastSequence = -1;
  let runId: string | null = expectedRunId;
  let failure: TodosAiContractError | null = null;
  let closed = false;
  let rejectFailure!: (reason: unknown) => void;
  const failurePromise = new Promise<never>((_resolve, reject) => {
    rejectFailure = reject;
  });
  void failurePromise.catch(() => undefined);

  const fail = (message: string): TodosAiContractError => {
    if (failure) return failure;
    const error = new TodosAiContractError(
      "runtime_invalid_result",
      message,
      TODOS_AI_EXIT_CODES.failed,
    );
    failure = error;
    controller.abort(error);
    rejectFailure(error);
    return error;
  };

  return {
    emit(event: TodosAiRuntimeEvent): void {
      if (closed) return;
      if (failure) return;
      if (!isTodosAiRuntimeEvent(event)) {
        fail("optional AI runtime emitted an invalid event");
        return;
      }
      if (runId !== null && event.run_id !== runId) {
        fail("optional AI runtime changed run_id while streaming");
        return;
      }
      if (event.sequence <= lastSequence) {
        fail("optional AI runtime event sequence must increase");
        return;
      }
      if (eventCount >= TODOS_AI_LIMITS.max_stream_events) {
        fail(`optional AI runtime exceeded ${TODOS_AI_LIMITS.max_stream_events} events`);
        return;
      }

      const record: TodosAiStreamRecord = {
        schema_version: TODOS_AI_SCHEMA_VERSION,
        kind: "event",
        event,
      };
      let serialized: string;
      try {
        serialized = JSON.stringify(record);
      } catch {
        fail("optional AI runtime emitted an event that could not be serialized");
        return;
      }
      const recordBytes = Buffer.byteLength(serialized, "utf8");
      if (recordBytes > TODOS_AI_LIMITS.max_stream_record_bytes) {
        fail(`optional AI runtime event exceeds ${TODOS_AI_LIMITS.max_stream_record_bytes} bytes`);
        return;
      }
      if (streamBytes + recordBytes + 1 > TODOS_AI_LIMITS.max_stream_bytes) {
        fail(`optional AI runtime stream exceeds ${TODOS_AI_LIMITS.max_stream_bytes} bytes`);
        return;
      }

      runId = event.run_id;
      lastSequence = event.sequence;
      eventCount += 1;
      streamBytes += recordBytes + 1;
      if (format === "stream-json") process.stdout.write(`${serialized}\n`);
    },

    assertResult(result: TodosAiRunResult, maxSteps: number): void {
      if (failure) throw failure;
      if (runId !== null && result.run_id !== runId) {
        throw fail("optional AI runtime result run_id does not match its streamed events");
      }
      if (result.steps > maxSteps) {
        throw fail(`optional AI runtime exceeded the max step limit of ${maxSteps}`);
      }
    },

    raceWithFailure<T>(operation: Promise<T>): Promise<T> {
      return Promise.race([failurePromise, operation]);
    },

    failureRunId(fallback: string): string {
      return runId ?? fallback;
    },

    close(): void {
      closed = true;
    },
  };
}

async function runTodosAi(
  promptParts: readonly string[],
  options: TodosAiCliOptions,
  program: Command,
): Promise<void> {
  const globalOpts = globalOptions(program);
  let format = requestedErrorFormat(options, globalOpts);
  const hostRunId = randomUUID();
  let eventSink: RuntimeEventSink | null = null;

  try {
    const config = loadTodosAiStoredConfig();
    format = requestedErrorFormat(options, globalOpts, config?.format);
    const interactive = options.nonInteractive !== true &&
      process.stdin.isTTY === true &&
      process.stdout.isTTY === true;
    const resolved = resolveTodosAiCommandOptions({
      cli: {
        provider: options.provider,
        model: options.model,
        profile: options.profile,
        format: options.format ?? (globalOpts["json"] === true ? "json" : undefined),
        maxSteps: options.maxSteps,
        timeoutMs: options.timeoutMs,
        writeMode: options.writeMode,
        approvalMode: options.approvalMode,
        approvalRefs: options.approval,
        dryRun: options.dryRun,
      },
      config,
      env: process.env,
      interactive,
    });
    format = resolved.format;

    const resumeRunId = normalizeResumeRunId(options.resume);
    let rawPrompt = promptParts.join(" ");
    if (!rawPrompt.trim() && process.stdin.isTTY !== true) {
      rawPrompt = await readBoundedStdin();
    }
    const prompt = normalizeTodosAiPrompt(rawPrompt);
    if (!prompt && !resumeRunId) {
      if (!interactive) {
        throw new TodosAiContractError(
          "invalid_input",
          "Provide a prompt as arguments or non-TTY stdin.",
        );
      }
      const result = createTodosAiNeedsInputResult(hostRunId, "Provide a prompt as arguments or non-TTY stdin.");
      renderTerminalResult(result, format);
      process.exitCode = todosAiExitCodeForResult(result);
      return;
    }

    if (options.inputJson !== undefined && options.input !== undefined) {
      throw new TodosAiContractError(
        "invalid_input",
        "Pass either --input-json or --input, not both.",
      );
    }
    const inputJson = options.inputJson ?? options.input;
    const request: TodosAiRunRequest = {
      schema_version: TODOS_AI_SCHEMA_VERSION,
      prompt,
      input: inputJson === undefined
        ? null
        : parseTodosAiJson(inputJson, "input"),
      variables: parseTodosAiVariables(options.var ?? []),
      output_schema: options.outputSchema === undefined
        ? null
        : parseTodosAiOutputSchema(options.outputSchema),
      provider: resolved.provider,
      model: resolved.model,
      profile: resolved.profile,
      format: resolved.format,
      interactive: resolved.interactive,
      context: {
        project: optionalString(globalOpts["project"]),
        agent: optionalString(globalOpts["agent"]),
        session: optionalString(globalOpts["session"]),
      },
      authority: {
        write_mode: resolved.write_mode,
        approval_mode: resolved.approval_mode,
        approval_refs: resolved.approval_refs,
        dry_run: resolved.dry_run,
      },
      limits: {
        max_steps: resolved.max_steps,
        timeout_ms: resolved.timeout_ms,
      },
      resume_run_id: resumeRunId,
    };

    const controller = new AbortController();
    const sink = createRuntimeEventSink(format, controller, resumeRunId);
    eventSink = sink;
    const runtimeResult = await withInterrupt(
      async () => {
        const runtime = await withLoadDeadline(
          () => loadTodosAiRuntime({
            package_name: "@hasna/todos",
            package_version: getPackageVersion(),
            protocol_version: TODOS_AI_RUNTIME_PROTOCOL_VERSION,
            tool_source: createTodosAiToolSource({
              env: process.env,
              workspacePath: process.cwd(),
            }),
          }),
          controller,
          resolved.timeout_ms,
        );
        throwIfAborted(controller.signal);
        const runtimeOperation = Promise.resolve().then(() => {
          throwIfAborted(controller.signal);
          return runtime.run(request, {
            signal: controller.signal,
            emit: (event) => sink.emit(event),
          });
        });
        return sink.raceWithFailure(runtimeOperation);
      },
      controller,
    );
    const result = assertTodosAiRunResult(runtimeResult);
    eventSink.assertResult(result, resolved.max_steps);
    eventSink.close();
    renderTerminalResult(result, format);
    process.exitCode = todosAiExitCodeForResult(result);
  } catch (error) {
    eventSink?.close();
    const result = errorResult(eventSink?.failureRunId(hostRunId) ?? hostRunId, error);
    renderTerminalResult(result, format);
    process.exitCode = error instanceof TodosAiContractError
      ? error.exitCode
      : TODOS_AI_EXIT_CODES.failed;
  }
}

export function registerAiCommands(program: Command): void {
  const command = program
    .command("ai [prompt...]")
    .description("Run the optional provider-neutral Todos AI runtime")
    .option("--format <format>", "Output format: text, json, or stream-json")
    .option("--input-json <json>", "Structured JSON input supplied to the runtime")
    .option("--input <json>", "Compatibility alias for --input-json")
    .option("--var <key=value>", "Non-secret runtime variable; repeatable", appendOption, [])
    .option("--output-schema <json>", "JSON Schema object for structured output")
    .option("--provider <name>", "Runtime provider override")
    .option("--model <name>", "Runtime model override")
    .option("--profile <name>", "Runtime profile override")
    .option("--write-mode <mode>", "Authority: read-only, plan, or execute")
    .option("--approval-mode <mode>", "Approval handling: deny, required, prompt, or existing")
    .option("--approval <reference>", "Existing approval reference; repeatable", appendOption, [])
    .option("--dry-run", "Force plan-only authority without mutation")
    .option("--max-steps <n>", `Maximum runtime steps (${TODOS_AI_LIMITS.min_steps}-${TODOS_AI_LIMITS.max_steps})`)
    .option("--timeout-ms <ms>", `Timeout in milliseconds (${TODOS_AI_LIMITS.min_timeout_ms}-${TODOS_AI_LIMITS.max_timeout_ms})`)
    .option("--resume <run-id>", "Resume a runtime run, optionally with a new prompt")
    .option("--non-interactive", "Disable all runtime prompting");
  const defaultOutputError = command.configureOutput().outputError;
  command.configureOutput({
    outputError: (message, write) => {
      if (commanderJsonRequested(command)) return;
      if (defaultOutputError) {
        defaultOutputError(message, write);
      } else {
        write(message);
      }
    },
  });
  command.exitOverride((error) => {
    if (error.exitCode === 0) process.exit(0);
    if (commanderJsonRequested(command)) {
      const result = createTodosAiFailureResult(
        randomUUID(),
        "invalid_input",
        error.message,
      );
      writeSync(process.stdout.fd, `${resultJson(result)}\n`);
    }
    process.exit(TODOS_AI_EXIT_CODES.usage);
  });
  command.action(async (prompt: string[] | undefined, options: TodosAiCliOptions) => {
    await runTodosAi(prompt ?? [], options, program);
  });
}
