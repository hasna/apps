import { randomUUID } from 'node:crypto'
import { commandName, hasFlag, parseArgs } from './args.js'
import { dispatch } from './commands.js'
import { FileConfigStore } from './config.js'
import { CredentialManager, EncryptedFileStore, OsKeychainStore } from './credentials.js'
import { asCliError, CliError, EXIT_CODES, type ExitCode } from './errors.js'
import { NodeApiTransport } from './http.js'
import { failure, success, type ResultMeta } from './result.js'
import type { Runtime } from './runtime.js'
import { readHiddenSecret, readStdinLine } from './secret-input.js'

export type RunResult = { exitCode: ExitCode; result: ReturnType<typeof success> }

export async function runCli(argv: string[], suppliedRuntime?: Runtime): Promise<RunResult> {
  const started = Date.now()
  let command = 'help'
  let json = argv.includes('--json')
  let profile: string | undefined
  try {
    const args = parseArgs(argv)
    json = hasFlag(args, 'json')
    profile = args.flags.get('profile')?.at(-1)
    command = commandName(args)
    if (hasFlag(args, 'password-stdin') && hasFlag(args, 'passphrase-stdin'))
      throw new Error('--password-stdin and --passphrase-stdin cannot share standard input')
    const runtime = suppliedRuntime ?? defaultRuntime(args)
    const response = await dispatch(args, runtime)
    const meta: ResultMeta = {
      command,
      durationMs: Date.now() - started,
      ...(profile ? { profile } : {}),
      ...(response.requestId ? { requestId: response.requestId } : {}),
      ...(response.idempotencyKey ? { idempotencyKey: response.idempotencyKey } : {}),
    }
    const result = success(response.data, meta)
    runtime.stdout.write(json ? `${JSON.stringify(result)}\n` : response.human ?? `${JSON.stringify(response.data, null, 2)}\n`)
    return { exitCode: EXIT_CODES.SUCCESS, result }
  } catch (unknownError) {
    const error =
      unknownError instanceof Error && unknownError.message.includes('cannot share standard input')
        ? new CliError('USAGE', unknownError.message, EXIT_CODES.USAGE)
        : asCliError(unknownError)
    const runtime = suppliedRuntime ?? fallbackRuntime()
    const result = failure(error, {
      command,
      durationMs: Date.now() - started,
      ...(profile ? { profile } : {}),
      ...(error.requestId ? { requestId: error.requestId } : {}),
    })
    const rendered = `${JSON.stringify(result)}\n`
    if (json) runtime.stdout.write(rendered)
    else runtime.stderr.write(`Error [${error.code}]: ${error.message}\n`)
    return { exitCode: error.exitCode, result }
  }
}

function defaultRuntime(args: ReturnType<typeof parseArgs>): Runtime {
  const passphrase = memoize(async () =>
    hasFlag(args, 'passphrase-stdin')
      ? readStdinLine(process.stdin)
      : readHiddenSecret('Encrypted credential passphrase: '),
  )
  const credentials = new CredentialManager(
    new OsKeychainStore(),
    new EncryptedFileStore(passphrase),
  )
  return {
    config: new FileConfigStore(),
    credentials,
    transport: (profile) =>
      new NodeApiTransport(
        profile.apiUrl,
        profile.connectTimeoutMs ?? 5_000,
        profile.requestTimeoutMs ?? 30_000,
        profile.allowInsecureLocalhost === true && ['localhost', '127.0.0.1', '[::1]', '::1'].includes(new URL(profile.apiUrl).hostname),
      ),
    stdin: process.stdin,
    stdout: process.stdout,
    stderr: process.stderr,
    now: () => new Date(),
    randomUUID,
    env: process.env,
    readPassword: (stdin) =>
      stdin ? readStdinLine(process.stdin) : readHiddenSecret('Password: '),
  }
}

function fallbackRuntime(): Runtime {
  return {
    config: new FileConfigStore(),
    credentials: new CredentialManager(new OsKeychainStore()),
    transport: (profile) => new NodeApiTransport(profile.apiUrl),
    stdin: process.stdin,
    stdout: process.stdout,
    stderr: process.stderr,
    now: () => new Date(),
    randomUUID,
    env: process.env,
    readPassword: () => readHiddenSecret('Password: '),
  }
}

function memoize<T>(factory: () => Promise<T>): () => Promise<T> {
  let value: Promise<T> | undefined
  return () => (value ??= factory())
}
