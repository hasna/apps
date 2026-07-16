import { lstat, readFile } from 'node:fs/promises'
import { CliError, EXIT_CODES } from './errors.js'
import type { ParsedArgs } from './args.js'
import { flag } from './args.js'

const MAX_INPUT = 1_048_576

async function readLimitedStdin(input: NodeJS.ReadableStream): Promise<string> {
  let value = ''
  for await (const chunk of input) {
    value += String(chunk)
    if (Buffer.byteLength(value) > MAX_INPUT)
      throw new CliError('INPUT_TOO_LARGE', 'Input exceeds 1 MiB', EXIT_CODES.VALIDATION)
  }
  return value
}

export async function readJsonInput(
  args: ParsedArgs,
  input: NodeJS.ReadableStream = process.stdin,
): Promise<Record<string, unknown>> {
  const file = flag(args, 'file')
  const stdin = flag(args, 'input')
  if (file && stdin)
    throw new CliError('USAGE', 'Use only one of --file or --input', EXIT_CODES.USAGE)
  let raw = '{}'
  if (file) {
    const stats = await lstat(file)
    if (!stats.isFile() || stats.isSymbolicLink())
      throw new CliError('INPUT_INVALID', 'Input must be a regular non-symlink file', EXIT_CODES.VALIDATION)
    if (stats.size > MAX_INPUT)
      throw new CliError('INPUT_TOO_LARGE', 'Input exceeds 1 MiB', EXIT_CODES.VALIDATION)
    raw = await readFile(file, 'utf8')
  } else if (stdin !== undefined) {
    if (stdin !== '-')
      throw new CliError('USAGE', '--input currently accepts only - for stdin', EXIT_CODES.USAGE)
    raw = await readLimitedStdin(input)
  }
  try {
    const parsed = JSON.parse(raw) as unknown
    if (!parsed || Array.isArray(parsed) || typeof parsed !== 'object') throw new Error('not object')
    return parsed as Record<string, unknown>
  } catch (error) {
    throw new CliError('INPUT_INVALID', 'Input must be a JSON object', EXIT_CODES.VALIDATION, {
      cause: error,
    })
  }
}
