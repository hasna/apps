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
  'two-factor-env',
])

const commonApi = ['json', 'profile', 'api-url', 'connect-timeout', 'request-timeout', 'org', 'org-slug', 'passphrase-stdin']
const input = ['file', 'input']
const approval = ['apply', 'yes', 'dry-run']

const commandFlags: Record<string, string[]> = {
  help: ['json', 'help'],
  version: ['json'],
  doctor: [...commonApi],
  config: ['json'],
  profiles: ['json'],
  'profiles list': ['json'],
  'profiles show': ['json', 'profile'],
  'profiles add': ['json', 'api-url', 'org', 'org-slug', 'credential-env', 'credential-store', 'allow-insecure-localhost'],
  'profiles use': ['json'],
  'profiles remove': ['json', 'passphrase-stdin'],
  apps: ['json'],
  'apps list': ['json'],
  'apps search': ['json'],
  'apps show': ['json'],
  'apps status': [...commonApi],
  'apps install': [...commonApi, ...approval],
  'apps update': [...commonApi, ...approval],
  'apps uninstall': [...commonApi, ...approval],
  app: ['json'],
  'app cweb capabilities': [...commonApi],
  accounts: [...commonApi, 'app'],
  'accounts list': [...commonApi, 'app'],
  'accounts show': [...commonApi, 'app'],
  'accounts provision': [...commonApi, 'app', ...input, ...approval],
  'accounts deprovision': [...commonApi, 'app', ...approval],
  auth: [...commonApi],
  'auth login': [...commonApi, 'email', 'store', 'password-stdin', 'two-factor-env', 'token-name'],
  'auth status': [...commonApi],
  'auth whoami': [...commonApi],
  'auth logout': [...commonApi],
  'auth tokens list': [...commonApi],
  'auth tokens create': [...commonApi, ...input, 'name', 'scopes', 'expires-in-days', 'dry-run'],
  'auth tokens revoke': [...commonApi, ...approval],
  'auth tokens rotate': [...commonApi, ...approval, 'idempotency-key'],
  'auth tokens revoke-all': [...commonApi, ...approval],
  careers: [...commonApi],
  'careers jobs list': [...commonApi, 'status', 'department', 'limit', 'offset'],
  'careers jobs show': [...commonApi],
  'careers jobs create': [...commonApi, ...input, 'title', 'department', 'location', 'type', 'description', 'requirements', 'benefits', 'salary', 'expires-at', 'idempotency-key', 'dry-run'],
  'careers jobs update': [...commonApi, ...input, 'title', 'department', 'location', 'type', 'description', 'requirements', 'benefits', 'salary', 'expires-at', 'version', 'expected-version', 'dry-run'],
  'careers jobs publish': [...commonApi, 'version', 'expected-version', ...approval],
  'careers jobs close': [...commonApi, 'version', 'expected-version', ...approval],
  'careers jobs delete': [...commonApi, 'version', 'expected-version', ...approval],
  'careers applications list': [...commonApi, 'job', 'status', 'limit', 'offset'],
  'careers applications show': [...commonApi],
  'careers applications submit': [...commonApi, ...input, 'job', 'name', 'email', 'phone', 'cover-letter', 'terms-accepted', 'idempotency-key', 'dry-run'],
  'careers applications status': [...commonApi, ...input, 'status', ...approval],
  'careers applications export': [...commonApi, 'cursor', 'limit', 'output', 'dry-run'],
  'careers applications anonymize': [...commonApi, ...approval],
}

const positionalArity: Record<string, [number, number]> = {
  help: [0, 1], version: [1, 1], doctor: [1, 1], config: [1, 2],
  'profiles list': [2, 2], 'profiles show': [2, 3], 'profiles add': [3, 3], 'profiles use': [3, 3], 'profiles remove': [3, 3],
  'apps list': [2, 2], 'apps search': [3, 3], 'apps show': [3, 3], 'apps status': [3, 3], 'apps install': [3, 3], 'apps update': [3, 3], 'apps uninstall': [3, 3],
  'app cweb capabilities': [3, 3],
  'accounts list': [2, 2], 'accounts show': [3, 3], 'accounts provision': [2, 2], 'accounts deprovision': [3, 3],
  'auth login': [2, 2], 'auth status': [2, 2], 'auth whoami': [2, 2], 'auth logout': [2, 2],
  'auth tokens list': [3, 3], 'auth tokens create': [3, 3], 'auth tokens revoke': [4, 4], 'auth tokens rotate': [4, 4], 'auth tokens revoke-all': [3, 3],
  'careers jobs list': [3, 3], 'careers jobs create': [3, 3], 'careers jobs show': [4, 4], 'careers jobs update': [4, 4], 'careers jobs publish': [4, 4], 'careers jobs close': [4, 4], 'careers jobs delete': [4, 4],
  'careers applications list': [3, 3], 'careers applications export': [3, 3], 'careers applications submit': [3, 4], 'careers applications show': [4, 4], 'careers applications status': [4, 4], 'careers applications anonymize': [4, 4],
}

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
    if (inline !== undefined && !valueFlags.has(rawName))
      throw new CliError('USAGE', `--${rawName} does not accept a value`, EXIT_CODES.USAGE)
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
  const parsed = { positionals, flags }
  assertAllowedFlags(parsed)
  return parsed
}

export function assertAllowedFlags(args: ParsedArgs): void {
  const route = commandName(args)
  const allowed = new Set(commandFlags[route] ?? (args.positionals.length ? ['json'] : ['json', 'help', 'version']))
  for (const [name, values] of args.flags) {
    if (!allowed.has(name))
      throw new CliError('USAGE', `Unsupported option --${name} for ${route || 'this command'}`, EXIT_CODES.USAGE)
    if (values.length > 1)
      throw new CliError('USAGE', `Option --${name} may only be supplied once`, EXIT_CODES.USAGE)
  }
  if (args.flags.has('dry-run') && (args.flags.has('apply') || args.flags.has('yes')))
    throw new CliError('USAGE', '--dry-run cannot be combined with --apply or --yes', EXIT_CODES.USAGE)
  if (args.flags.has('yes') && !args.flags.has('apply'))
    throw new CliError('USAGE', '--yes requires --apply', EXIT_CODES.USAGE)
  const arity = positionalArity[route]
  if (arity && (args.positionals.length < arity[0] || args.positionals.length > arity[1]))
    throw new CliError('USAGE', `Unexpected positional arguments for ${route}`, EXIT_CODES.USAGE)
}

export function commandName(args: ParsedArgs): string {
  const positionals = args.positionals
  if (positionals.length === 0) return 'help'
  if (positionals[0] === 'help' || positionals[0] === 'version' || positionals[0] === 'doctor') return positionals[0]
  if (!['config', 'profiles', 'apps', 'accounts', 'app', 'auth', 'careers'].includes(positionals[0] ?? '')) return positionals[0] ?? 'help'
  if (positionals[0] === 'app' && positionals[1] === 'cweb' && positionals[2] === 'capabilities')
    return 'app cweb capabilities'
  if (positionals[0] === 'auth' && positionals[1] === 'tokens') return positionals.slice(0, 3).join(' ')
  if (positionals[0] === 'careers') return positionals.slice(0, 3).join(' ')
  return positionals.slice(0, 2).join(' ')
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
