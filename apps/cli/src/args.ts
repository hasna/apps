import { CliError, EXIT_CODES } from './errors.js'

export type ParsedArgs = {
  positionals: string[]
  flags: Map<string, string[]>
}

const valueFlags = new Set([
  'profile',
  'api-url',
  'connect-timeout',
  'request-timeout',
  'org',
  'org-slug',
  'credential-env',
  'credential-store',
  'store',
  'file',
  'input',
  'output',
  'idempotency-key',
  'apply',
  'status',
  'limit',
  'offset',
  'cursor',
  'job',
  'version',
  'expected-version',
  'email',
  'token-name',
  'name',
  'scopes',
  'expires-in-days',
  'title',
  'department',
  'location',
  'type',
  'description',
  'requirements',
  'benefits',
  'salary',
  'expires-at',
  'phone',
  'resume',
  'cover-letter',
  'app',
  'two-factor-code',
])

export function parseArgs(argv: string[]): ParsedArgs {
  const flags = new Map<string, string[]>()
  const positionals: string[] = []
  for (let index = 0; index < argv.length; index += 1) {
    const token = argv[index]
    if (!token) continue
    if (token === '--') {
      positionals.push(...argv.slice(index + 1))
      break
    }
    if (!token.startsWith('--')) {
      positionals.push(token)
      continue
    }
    const [rawName, inline] = token.slice(2).split('=', 2)
    if (!rawName) throw new CliError('USAGE', 'Empty option name', EXIT_CODES.USAGE)
    let value = inline
    if (value === undefined && valueFlags.has(rawName)) {
      value = argv[index + 1]
      if (!value || value.startsWith('--'))
        throw new CliError('USAGE', `--${rawName} requires a value`, EXIT_CODES.USAGE)
      index += 1
    }
    const values = flags.get(rawName) ?? []
    values.push(value ?? 'true')
    flags.set(rawName, values)
  }
  return { positionals, flags }
}

export function flag(args: ParsedArgs, name: string): string | undefined {
  return args.flags.get(name)?.at(-1)
}

export function hasFlag(args: ParsedArgs, name: string): boolean {
  return args.flags.has(name)
}

export function intFlag(
  args: ParsedArgs,
  name: string,
  options: { min?: number; max?: number } = {},
): number | undefined {
  const raw = flag(args, name)
  if (raw === undefined) return undefined
  const parsed = Number(raw)
  if (!Number.isInteger(parsed) || parsed < (options.min ?? Number.MIN_SAFE_INTEGER))
    throw new CliError('VALIDATION_ERROR', `--${name} must be an integer`, EXIT_CODES.VALIDATION)
  if (options.max !== undefined && parsed > options.max)
    throw new CliError(
      'VALIDATION_ERROR',
      `--${name} must be at most ${options.max}`,
      EXIT_CODES.VALIDATION,
    )
  return parsed
}

export function requiredPositional(args: ParsedArgs, index: number, label: string): string {
  const value = args.positionals[index]
  if (!value) throw new CliError('USAGE', `Missing ${label}`, EXIT_CODES.USAGE)
  return value
}
