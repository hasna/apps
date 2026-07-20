#!/usr/bin/env bun
/**
 * `sandboxes` CLI — disposable sandbox lifecycle over the managed E2B/Daytona
 * adapters (and a local simulator). Every command resolves a SandboxBackend via
 * ../runtime/resolve and calls the provider-neutral seam. Credentials are read
 * from the environment or the `secrets` vault and are never printed.
 */
import { Command, CommanderError } from "commander"
import { readFileSync } from "node:fs"
import { resolveBackend, isSandboxProvider, SANDBOX_PROVIDERS, type SecretsReader } from "../runtime/resolve"
import type { SandboxBackend, SandboxProvider } from "../runtime/types"

export const CLI_VERSION = "1.0.0"

export interface CliDeps {
  env?: NodeJS.ProcessEnv
  home?: string
  secretsReader?: SecretsReader
  stdout?: (chunk: string) => void
  stderr?: (chunk: string) => void
  stdin?: () => Uint8Array | undefined
}

function collectKeyValue(value: string, previous: Record<string, string>): Record<string, string> {
  const eq = value.indexOf("=")
  if (eq === -1) return previous
  return { ...previous, [value.slice(0, eq)]: value.slice(eq + 1) }
}

export async function runCli(argv: string[], deps: CliDeps = {}): Promise<number> {
  const out = deps.stdout ?? ((chunk: string): void => void process.stdout.write(chunk))
  const err = deps.stderr ?? ((chunk: string): void => void process.stderr.write(chunk))
  const env = deps.env ?? process.env
  const state = { exitCode: 0 }

  const program = new Command()
  program
    .name("sandboxes")
    .description("Disposable cloud sandboxes over managed E2B/Daytona adapters")
    .version(CLI_VERSION, "-v, --version", "print version")
    .option("-p, --provider <provider>", `provider: ${SANDBOX_PROVIDERS.join("|")}`, "local")
    .option("--json", "emit machine-readable JSON", false)
    .enablePositionalOptions()
    .exitOverride()
    .configureOutput({
      writeOut: (str) => out(str),
      writeErr: (str) => err(str),
    })

  const backendFor = async (): Promise<SandboxBackend> => {
    const providerOpt = String(program.opts().provider ?? "local")
    if (!isSandboxProvider(providerOpt)) {
      throw new Error(`unknown provider '${providerOpt}' (expected ${SANDBOX_PROVIDERS.join("|")})`)
    }
    return resolveBackend(providerOpt as SandboxProvider, {
      env,
      ...(deps.home === undefined ? {} : { home: deps.home }),
      ...(deps.secretsReader === undefined ? {} : { secretsReader: deps.secretsReader }),
    })
  }

  const json = (): boolean => program.opts().json === true
  const emit = (human: string, data: unknown): void => {
    if (json()) out(`${JSON.stringify(data, null, 2)}\n`)
    else out(`${human}\n`)
  }

  const wrap = (action: (backend: SandboxBackend, ...args: never[]) => Promise<void>) => {
    return async (...args: unknown[]): Promise<void> => {
      try {
        const backend = await backendFor()
        try {
          await action(backend, ...(args as never[]))
        } finally {
          await backend.close()
        }
      } catch (error) {
        state.exitCode = 1
        const message = error instanceof Error ? error.message : String(error)
        if (json()) out(`${JSON.stringify({ error: message }, null, 2)}\n`)
        else err(`error: ${message}\n`)
      }
    }
  }

  program
    .command("create")
    .description("create a new sandbox")
    .option("-t, --template <template>", "template / image alias")
    .option("--timeout <ms>", "auto-expire after N milliseconds")
    .option("-m, --metadata <kv>", "metadata key=value (repeatable)", collectKeyValue, {})
    .action(
      wrap(async (backend, options: { template?: string; timeout?: string; metadata: Record<string, string> }) => {
        const record = await backend.create({
          ...(options.template === undefined ? {} : { template: options.template }),
          ...(options.timeout === undefined ? {} : { timeout_ms: Number(options.timeout) }),
          metadata: options.metadata,
        })
        emit(`created ${record.id} (${record.provider}, ${record.status})`, record)
      }),
    )

  program
    .command("list")
    .alias("ls")
    .description("list sandboxes")
    .action(
      wrap(async (backend) => {
        const records = await backend.list()
        const human = records.length === 0 ? "no sandboxes" : records.map((r) => `${r.id}\t${r.status}\t${r.created_at}`).join("\n")
        emit(human, records)
      }),
    )

  program
    .command("get <id>")
    .description("get sandbox details")
    .action(
      wrap(async (backend, id: string) => {
        const record = await backend.get(id)
        emit(`${record.id}\t${record.status}\t${record.provider}\t${record.created_at}`, record)
      }),
    )

  program
    .command("destroy <id>")
    .aliases(["rm", "delete"])
    .description("delete a sandbox")
    .action(
      wrap(async (backend, id: string) => {
        await backend.destroy(id)
        emit(`destroyed ${id}`, { id, destroyed: true })
      }),
    )

  program
    .command("stop <id>")
    .description("stop / pause a sandbox")
    .action(
      wrap(async (backend, id: string) => {
        const record = await backend.stop(id)
        emit(`stopped ${id} (${record.status})`, record)
      }),
    )

  program
    .command("keep-alive <id>")
    .description("extend sandbox lifetime")
    .requiredOption("--timeout <ms>", "new lifetime in milliseconds")
    .action(
      wrap(async (backend, id: string, options: { timeout: string }) => {
        const record = await backend.keepAlive(id, Number(options.timeout))
        emit(`extended ${id} -> ${record.expires_at ?? "unbounded"}`, record)
      }),
    )

  program
    .command("exec <id> [cmd...]")
    .description("execute a command in a sandbox")
    .option("--cwd <dir>", "working directory")
    .option("--timeout <ms>", "wall timeout in milliseconds")
    .passThroughOptions()
    .action(
      wrap(async (backend, id: string, cmd: string[], options: { cwd?: string; timeout?: string }) => {
        if (cmd.length === 0) throw new Error("exec requires a command")
        const result = await backend.exec(id, cmd, {
          ...(options.cwd === undefined ? {} : { cwd: options.cwd }),
          ...(options.timeout === undefined ? {} : { timeout_ms: Number(options.timeout) }),
        })
        if (json()) out(`${JSON.stringify(result, null, 2)}\n`)
        else {
          if (result.stdout.length > 0) out(result.stdout)
          if (result.stderr.length > 0) err(result.stderr)
        }
        if (result.exit_code !== 0) state.exitCode = result.exit_code
      }),
    )

  program
    .command("logs <id>")
    .description("get sandbox event logs")
    .action(
      wrap(async (backend, id: string) => {
        const logs = await backend.getLogs(id)
        const human = logs.map((l) => `${l.ts} [${l.level}] ${l.event}: ${l.message}`).join("\n")
        emit(human, logs)
      }),
    )

  program
    .command("write-file <id> <path>")
    .description("write a file into a sandbox")
    .option("-c, --content <text>", "inline UTF-8 content")
    .option("-f, --file <localPath>", "read content from a local file")
    .action(
      wrap(async (backend, id: string, path: string, options: { content?: string; file?: string }) => {
        let bytes: Uint8Array
        if (options.content !== undefined) bytes = new TextEncoder().encode(options.content)
        else if (options.file !== undefined) bytes = new Uint8Array(readFileSync(options.file))
        else {
          const piped = deps.stdin?.()
          if (piped === undefined) throw new Error("provide --content, --file, or piped stdin")
          bytes = piped
        }
        const receipt = await backend.writeFile(id, path, bytes)
        emit(`wrote ${receipt.size} bytes to ${receipt.path}`, receipt)
      }),
    )

  program
    .command("read-file <id> <path>")
    .description("read a file from a sandbox")
    .action(
      wrap(async (backend, id: string, path: string) => {
        const bytes = await backend.readFile(id, path)
        if (json()) out(`${JSON.stringify({ path, base64: Buffer.from(bytes).toString("base64") }, null, 2)}\n`)
        else out(new TextDecoder().decode(bytes))
      }),
    )

  program
    .command("list-files <id> [path]")
    .description("list files in a sandbox directory")
    .action(
      wrap(async (backend, id: string, path: string | undefined) => {
        const entries = await backend.listFiles(id, path ?? "/workspace")
        const human = entries.map((e) => `${e.type === "dir" ? "d" : "-"}\t${e.path}`).join("\n")
        emit(human, entries)
      }),
    )

  program
    .command("expose-port <id> <port>")
    .description("forward a sandbox port and get a URL")
    .action(
      wrap(async (backend, id: string, port: string) => {
        const exposed = await backend.exposePort(id, Number(port))
        emit(`${exposed.port} -> ${exposed.url}`, exposed)
      }),
    )

  program
    .command("list-ports <id>")
    .description("list forwarded ports")
    .action(
      wrap(async (backend, id: string) => {
        const ports = await backend.listExposedPorts(id)
        emit(ports.map((p) => `${p.port} -> ${p.url}`).join("\n"), ports)
      }),
    )

  program
    .command("snapshot <id>")
    .description("capture a filesystem snapshot")
    .action(
      wrap(async (backend, id: string) => {
        const snap = await backend.snapshot(id)
        emit(`snapshot ${snap.id} (${snap.ref})`, snap)
      }),
    )

  try {
    await program.parseAsync(argv, { from: "user" })
  } catch (error) {
    if (error instanceof CommanderError) {
      if (error.code === "commander.helpDisplayed" || error.code === "commander.version" || error.exitCode === 0) {
        return 0
      }
      err(`${error.message}\n`)
      return error.exitCode === 0 ? 1 : error.exitCode
    }
    state.exitCode = 1
    err(`error: ${error instanceof Error ? error.message : String(error)}\n`)
  }
  return state.exitCode
}

if (import.meta.main) {
  runCli(process.argv.slice(2))
    .then((code) => {
      process.exitCode = code
    })
    .catch((error: unknown) => {
      process.stderr.write(`fatal: ${error instanceof Error ? error.message : String(error)}\n`)
      process.exitCode = 1
    })
}
