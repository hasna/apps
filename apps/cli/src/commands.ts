import { chmod, rename, writeFile } from 'node:fs/promises'
import { dirname, resolve } from 'node:path'
import { mkdir } from 'node:fs/promises'
import { flag, hasFlag, intFlag, requiredPositional, type ParsedArgs } from './args.js'
import {
  type Config,
  resolveProfile,
  type Profile,
  validateApiUrl,
  validateProfileName,
} from './config.js'
import { CliError, EXIT_CODES } from './errors.js'
import { unwrap, type ApiTransport, type HttpRequestOptions } from './http.js'
import { readJsonInput } from './input.js'
import { createPlan, requirePlanApproval } from './plan.js'
import { builtinProviders, cwebProvider } from './providers/cweb.js'
import type { CommandOutput, Runtime } from './runtime.js'

const HELP = `Hasna CLI 0.2.0

Usage: hasna [global options] <command> [subcommand] [options]

Global options:
  --json                       Emit hasna.cli_result.v1 JSON
  --profile <name>             Select a profile
  --api-url <url>              Override the profile API URL
  --connect-timeout <ms>       Override connect timeout
  --request-timeout <ms>       Override request timeout

Commands:
  doctor | config
  profiles list|show|add|use|remove
  auth login|logout|status|whoami|tokens
  apps list|search|show|status|install|update|uninstall
  accounts list|show|provision|deprovision
  app cweb capabilities
  careers jobs list|show|create|update|publish|close|delete
  careers applications list|show|submit|status|export|anonymize

Exit codes: 0 success; 2 usage; 3 config; 4 auth; 5 forbidden;
6 not found; 7 conflict; 8 validation; 9 network; 10 timeout;
11 unsupported; 70 internal.
`

export async function dispatch(args: ParsedArgs, runtime: Runtime): Promise<CommandOutput> {
  const [group, action] = args.positionals
  if (!group || group === 'help' || hasFlag(args, 'help')) return output(HELP.trim(), HELP)
  if (group === 'version' || (hasFlag(args, 'version') && args.positionals.length === 0))
    return output({ version: '0.2.0' }, '0.2.0\n')
  if (group === 'doctor') return doctor(args, runtime)
  if (group === 'config') return configCommand(args, runtime)
  if (group === 'profiles') return profiles(action, args, runtime)
  if (group === 'apps') return apps(action, args, runtime)
  if (group === 'accounts') return accounts(action, args, runtime)
  if (group === 'app') return appCommand(action, args)
  if (group === 'auth') return auth(action, args, runtime)
  if (group === 'careers') return careers(action, args, runtime)
  throw new CliError('USAGE', `Unknown command: ${group}`, EXIT_CODES.USAGE)
}

function output(data: unknown, human?: string): CommandOutput {
  return { data, human }
}

async function doctor(args: ParsedArgs, runtime: Runtime): Promise<CommandOutput> {
  const config = await runtime.config.load()
  const checks: Array<{ name: string; ok: boolean; detail: string }> = [
    { name: 'node', ok: Number(process.versions.node.split('.')[0]) >= 20, detail: process.versions.node },
    { name: 'config', ok: true, detail: runtime.config.path },
    { name: 'providers', ok: builtinProviders.size === 1, detail: 'builtin:cweb only' },
  ]
  try {
    const profile = profileFor(args, config)
    checks.push({ name: 'profile', ok: true, detail: profile.name })
    try {
      await runtime.credentials.resolve(profile)
      checks.push({ name: 'credential', ok: true, detail: 'available (redacted)' })
    } catch {
      checks.push({ name: 'credential', ok: false, detail: 'not configured' })
    }
  } catch {
    checks.push({ name: 'profile', ok: false, detail: 'not selected' })
  }
  return output({ healthy: checks.every((check) => check.ok), checks })
}

async function configCommand(args: ParsedArgs, runtime: Runtime): Promise<CommandOutput> {
  const action = args.positionals[1] ?? 'show'
  if (action === 'path') return output({ path: runtime.config.path }, `${runtime.config.path}\n`)
  if (action === 'show') {
    const config = await runtime.config.load()
    return output(redactedConfig(config))
  }
  throw new CliError('USAGE', 'config supports show and path', EXIT_CODES.USAGE)
}

function redactedConfig(config: Config): Config {
  return {
    ...config,
    profiles: Object.fromEntries(
      Object.entries(config.profiles).map(([name, profile]) => [
        name,
        { ...profile, ...(profile.credential ? { credential: `${profile.credential.split(':')[0]}:<redacted>` } : {}) },
      ]),
    ),
  } as Config
}

async function profiles(action: string | undefined, args: ParsedArgs, runtime: Runtime) {
  const config = await runtime.config.load()
  if (action === 'list')
    return output(
      Object.values(config.profiles).map((profile) => ({
        ...profile,
        current: profile.name === config.currentProfile,
        credential: profile.credential ? `${profile.credential.split(':')[0]}:<redacted>` : undefined,
      })),
    )
  if (action === 'show') {
    const name = args.positionals[2] || flag(args, 'profile') || config.currentProfile
    if (!name || !config.profiles[name])
      throw new CliError('PROFILE_NOT_FOUND', 'Profile was not found', EXIT_CODES.NOT_FOUND)
    return output(redactedConfig({ ...config, profiles: { [name]: config.profiles[name] } }).profiles[name])
  }
  if (action === 'add') {
    const name = requiredPositional(args, 2, 'profile name')
    validateProfileName(name)
    if (config.profiles[name])
      throw new CliError('PROFILE_EXISTS', `Profile ${name} already exists`, EXIT_CODES.CONFLICT)
    const apiUrl = flag(args, 'api-url')
    if (!apiUrl) throw new CliError('USAGE', '--api-url is required', EXIT_CODES.USAGE)
    const credentialEnv = flag(args, 'credential-env')
    if (credentialEnv && !/^[A-Z_][A-Z0-9_]*$/.test(credentialEnv))
      throw new CliError('VALIDATION_ERROR', 'Invalid credential environment variable', EXIT_CODES.VALIDATION)
    const store = flag(args, 'credential-store')
    if (store && store !== 'keychain' && store !== 'encrypted-file')
      throw new CliError('VALIDATION_ERROR', 'Credential store must be keychain or encrypted-file', EXIT_CODES.VALIDATION)
    const profile: Profile = {
      name,
      apiUrl: validateApiUrl(apiUrl),
      ...(flag(args, 'org') || flag(args, 'org-slug')
        ? { orgSlug: flag(args, 'org') || flag(args, 'org-slug') }
        : {}),
      ...(credentialEnv ? { credential: `env:${credentialEnv}` as const } : {}),
      ...(store ? { credentialStore: store as 'keychain' | 'encrypted-file' } : {}),
    }
    config.profiles[name] = profile
    config.currentProfile ??= name
    await runtime.config.save(config)
    return output({ ...profile, credential: credentialEnv ? 'env:<redacted>' : undefined })
  }
  if (action === 'use') {
    const name = requiredPositional(args, 2, 'profile name')
    if (!config.profiles[name])
      throw new CliError('PROFILE_NOT_FOUND', `Profile ${name} was not found`, EXIT_CODES.NOT_FOUND)
    config.currentProfile = name
    await runtime.config.save(config)
    return output({ currentProfile: name })
  }
  if (action === 'remove') {
    const name = requiredPositional(args, 2, 'profile name')
    const profile = config.profiles[name]
    if (!profile) throw new CliError('PROFILE_NOT_FOUND', `Profile ${name} was not found`, EXIT_CODES.NOT_FOUND)
    await runtime.credentials.delete(profile)
    delete config.profiles[name]
    if (config.currentProfile === name) config.currentProfile = Object.keys(config.profiles)[0]
    await runtime.config.save(config)
    return output({ removed: name })
  }
  throw new CliError('USAGE', 'profiles requires list, show, add, use, or remove', EXIT_CODES.USAGE)
}

async function apps(action: string | undefined, args: ParsedArgs, runtime: Runtime) {
  const config = await runtime.config.load()
  const manifests = [...builtinProviders.values()].map((provider) => provider.manifest)
  if (action === 'list') return output(manifests)
  if (action === 'search') {
    const query = requiredPositional(args, 2, 'search query').toLowerCase()
    return output(manifests.filter((app) => `${app.id} ${app.name} ${app.description}`.toLowerCase().includes(query)))
  }
  const id = requiredPositional(args, 2, 'app id')
  const provider = builtinProviders.get(id)
  if (!provider) throw new CliError('APP_NOT_FOUND', `App ${id} was not found`, EXIT_CODES.NOT_FOUND)
  if (action === 'show') return output(provider.manifest)
  if (action === 'status') {
    const installed = config.apps[id]
    let api: unknown = { reachable: false, reason: 'profile not configured' }
    try {
      const profile = profileFor(args, config)
      const response = await runtime.transport(profile).request({ path: provider.manifest.api.openApiPath })
      api = { reachable: true, status: response.status, title: (response.body as { info?: { title?: string } }).info?.title }
    } catch (error) {
      api = { reachable: false, reason: error instanceof CliError ? error.code : 'NETWORK_ERROR' }
    }
    return output({ installed: Boolean(installed), installation: installed, api })
  }
  if (!['install', 'update', 'uninstall'].includes(action ?? ''))
    throw new CliError('USAGE', 'Unknown apps action', EXIT_CODES.USAGE)
  const changes =
    action === 'uninstall'
      ? { from: config.apps[id] ?? null, to: null }
      : { from: config.apps[id] ?? null, to: provider.manifest }
  const plan = createPlan(`apps.${action}`, id, changes)
  if (!flag(args, 'apply')) return output(plan)
  requirePlanApproval(plan, flag(args, 'apply'), hasFlag(args, 'yes'))
  if (action === 'uninstall') delete config.apps[id]
  else {
    const now = runtime.now().toISOString()
    config.apps[id] = {
      id,
      version: provider.manifest.version,
      provider: provider.manifest.provider,
      installedAt: config.apps[id]?.installedAt ?? now,
      updatedAt: now,
    }
  }
  await runtime.config.save(config)
  return output({ applied: true, planDigest: plan.digest, app: config.apps[id] ?? null })
}

function appCommand(action: string | undefined, args: ParsedArgs) {
  const subcommand = args.positionals[2]
  if (action === 'cweb' && subcommand === 'capabilities') return output(cwebProvider.manifest)
  throw new CliError('USAGE', 'Use app cweb capabilities', EXIT_CODES.USAGE)
}

async function accounts(action: string | undefined, args: ParsedArgs, runtime: Runtime) {
  const appId = flag(args, 'app') || 'cweb'
  const provider = builtinProviders.get(appId)
  if (!provider) throw new CliError('APP_NOT_FOUND', `App ${appId} was not found`, EXIT_CODES.NOT_FOUND)
  if (!provider.accounts)
    throw new CliError(
      'CAPABILITY_UNSUPPORTED',
      `Provider ${provider.id} does not support account management`,
      EXIT_CODES.UNSUPPORTED,
      { details: { provider: provider.id, capability: `accounts.${action ?? 'unknown'}` } },
    )
  const context = await providerContext(args, runtime, true)
  if (action === 'list') return output(await provider.accounts.list(context))
  if (action === 'show') return output(await provider.accounts.show(context, requiredPositional(args, 2, 'account id')))
  const target = action === 'deprovision' ? requiredPositional(args, 2, 'account id') : provider.id
  const changes = action === 'provision' ? await readJsonInput(args, runtime.stdin) : { id: target }
  const plan = createPlan(`accounts.${action}`, target, changes)
  if (!flag(args, 'apply')) return output(plan)
  requirePlanApproval(plan, flag(args, 'apply'), hasFlag(args, 'yes'))
  if (action === 'provision' && provider.accounts.provision)
    return output(await provider.accounts.provision(context, changes))
  if (action === 'deprovision' && provider.accounts.deprovision)
    return output(await provider.accounts.deprovision(context, target))
  throw new CliError('CAPABILITY_UNSUPPORTED', `Provider ${provider.id} cannot ${action}`, EXIT_CODES.UNSUPPORTED)
}

async function auth(action: string | undefined, args: ParsedArgs, runtime: Runtime) {
  const config = await runtime.config.load()
  const profile = profileFor(args, config)
  const api = runtime.transport(profile)
  if (action === 'login') {
    const email = flag(args, 'email')
    const orgSlug = flag(args, 'org') || flag(args, 'org-slug') || profile.orgSlug
    if (!email || !orgSlug)
      throw new CliError('USAGE', 'auth login requires --email and --org', EXIT_CODES.USAGE)
    const twoFactorCode = flag(args, 'two-factor-code')
    if (twoFactorCode && !/^\d{6}$/.test(twoFactorCode))
      throw new CliError('VALIDATION_ERROR', 'Two-factor code must be six digits', EXIT_CODES.VALIDATION)
    if (flag(args, 'store')) {
      const store = flag(args, 'store')
      if (store !== 'keychain' && store !== 'encrypted-file')
        throw new CliError('VALIDATION_ERROR', '--store must be keychain or encrypted-file', EXIT_CODES.VALIDATION)
      profile.credentialStore = store
    }
    const password = await runtime.readPassword(hasFlag(args, 'password-stdin'))
    const response = await api.request({
      method: 'POST',
      path: '/api/v1/auth/login',
      body: {
        email,
        password,
        orgSlug,
        tokenName: flag(args, 'token-name') || `hasna-cli:${profile.name}`,
        ...(twoFactorCode ? { twoFactorCode } : {}),
      },
    })
    const data = unwrap(response) as Record<string, unknown>
    const token = data.token
    if (typeof token !== 'string')
      throw new CliError('RESPONSE_INVALID', 'Login response did not contain a token', EXIT_CODES.NETWORK)
    const updated = await runtime.credentials.store(profile, token)
    config.profiles[profile.name] = { ...updated, orgSlug }
    await runtime.config.save(config)
    const { token: _redacted, ...safe } = data
    return { data: { ...safe, stored: updated.credentialStore }, requestId: response.requestId }
  }
  if (action === 'status') {
    try {
      await runtime.credentials.resolve(profile)
      return output({ authenticated: true, profile: profile.name, credential: 'available (redacted)' })
    } catch {
      return output({ authenticated: false, profile: profile.name })
    }
  }
  if (action === 'whoami') return apiJson(api, { path: '/api/v1/auth/whoami', token: await runtime.credentials.resolve(profile) })
  if (action === 'logout') {
    const token = await runtime.credentials.resolve(profile)
    const response = await api.request({ method: 'POST', path: '/api/v1/auth/logout', token })
    await runtime.credentials.delete(profile)
    return { data: unwrap(response), requestId: response.requestId }
  }
  if (action === 'tokens') return authTokens(args, runtime, profile, api)
  throw new CliError('USAGE', 'Unknown auth action', EXIT_CODES.USAGE)
}

async function authTokens(args: ParsedArgs, runtime: Runtime, profile: Profile, api: ApiTransport) {
  const operation = args.positionals[2]
  const org = requireOrg(profile, args)
  const token = await runtime.credentials.resolve(profile)
  if (operation === 'list') return apiJson(api, { path: `/api/v1/orgs/${encodeURIComponent(org)}/auth/tokens`, token })
  if (operation === 'create') {
    const body = await readJsonInput(args, runtime.stdin)
    if (flag(args, 'name')) body.name = flag(args, 'name')
    if (flag(args, 'scopes')) body.scopes = flag(args, 'scopes')?.split(',').map((scope) => scope.trim())
    if (intFlag(args, 'expires-in-days', { min: 1, max: 90 })) body.expiresInDays = intFlag(args, 'expires-in-days')
    if (typeof body.name !== 'string' || !Array.isArray(body.scopes) || body.scopes.length === 0)
      throw new CliError(
        'VALIDATION_ERROR',
        'Token creation requires name and at least one scope',
        EXIT_CODES.VALIDATION,
      )
    return mutation(api, args, runtime, {
      method: 'POST',
      path: `/api/v1/orgs/${encodeURIComponent(org)}/auth/tokens`,
      token,
      body,
    })
  }
  if (operation === 'revoke')
    return mutation(api, args, runtime, {
      method: 'DELETE',
      path: `/api/v1/orgs/${encodeURIComponent(org)}/auth/tokens/${encodeURIComponent(requiredPositional(args, 3, 'token id'))}`,
      token,
    })
  if (operation === 'rotate')
    return mutation(api, args, runtime, {
      method: 'POST',
      path: `/api/v1/orgs/${encodeURIComponent(org)}/auth/tokens/${encodeURIComponent(requiredPositional(args, 3, 'token id'))}/rotate`,
      token,
      headers: { 'Idempotency-Key': idempotency(args, runtime) },
    })
  if (operation === 'revoke-all')
    return mutation(api, args, runtime, {
      method: 'POST',
      path: `/api/v1/orgs/${encodeURIComponent(org)}/auth/tokens/revoke-all`,
      token,
    })
  throw new CliError('USAGE', 'Unknown auth tokens action', EXIT_CODES.USAGE)
}

async function careers(action: string | undefined, args: ParsedArgs, runtime: Runtime) {
  if (action === 'jobs') return careersJobs(args, runtime)
  if (action === 'applications') return careersApplications(args, runtime)
  throw new CliError('USAGE', 'careers requires jobs or applications', EXIT_CODES.USAGE)
}

async function careersJobs(args: ParsedArgs, runtime: Runtime) {
  const operation = args.positionals[2]
  const { profile, api, org } = await apiContext(args, runtime)
  const base = `/api/v1/orgs/${encodeURIComponent(org)}/careers/jobs`
  if (operation === 'list') {
    const token = await optionalToken(runtime, profile)
    return apiJson(api, {
      path: base,
      token,
      query: {
        status: flag(args, 'status'),
        limit: intFlag(args, 'limit', { min: 1, max: 100 }),
        offset: intFlag(args, 'offset', { min: 0 }),
      },
    })
  }
  const slug = operation === 'create' ? undefined : requiredPositional(args, 3, 'job slug')
  if (operation === 'show')
    return apiJson(api, { path: `${base}/${encodeURIComponent(slug ?? '')}`, token: await optionalToken(runtime, profile) })
  const token = await runtime.credentials.resolve(profile)
  if (operation === 'create' || operation === 'update') {
    const body = await readJsonInput(args, runtime.stdin)
    for (const key of ['title', 'department', 'location', 'type', 'description', 'requirements', 'benefits', 'salary'] as const)
      if (flag(args, key) !== undefined) body[key] = flag(args, key)
    if (flag(args, 'expires-at') !== undefined) body.expiresAt = flag(args, 'expires-at')
    if (operation === 'update') {
      const version = intFlag(args, 'expected-version', { min: 1 }) ?? intFlag(args, 'version', { min: 1 })
      if (version !== undefined) body.expectedVersion = version
      if (!version || Object.keys(body).every((key) => key === 'expectedVersion'))
        throw new CliError(
          'VALIDATION_ERROR',
          'Job update requires expectedVersion and at least one changed field',
          EXIT_CODES.VALIDATION,
        )
    } else {
      const missing = ['title', 'department', 'location', 'type', 'description', 'requirements'].filter(
        (key) => typeof body[key] !== 'string' || String(body[key]).trim() === '',
      )
      if (missing.length)
        throw new CliError(
          'VALIDATION_ERROR',
          `Missing required job fields: ${missing.join(', ')}`,
          EXIT_CODES.VALIDATION,
        )
      if ('status' in body && body.status !== 'DRAFT')
        throw new CliError('VALIDATION_ERROR', 'New jobs may only have DRAFT status', EXIT_CODES.VALIDATION)
    }
    return mutation(api, args, runtime, {
      method: operation === 'create' ? 'POST' : 'PATCH',
      path: operation === 'create' ? base : `${base}/${encodeURIComponent(slug ?? '')}`,
      token,
      body,
      headers: operation === 'create' ? { 'Idempotency-Key': idempotency(args, runtime) } : undefined,
    })
  }
  if (['publish', 'close', 'delete'].includes(operation ?? '')) {
    const version = intFlag(args, 'version', { min: 1 }) ?? intFlag(args, 'expected-version', { min: 1 })
    if (!version) throw new CliError('USAGE', '--version is required', EXIT_CODES.USAGE)
    return mutation(api, args, runtime, {
      method: operation === 'delete' ? 'DELETE' : 'POST',
      path: `${base}/${encodeURIComponent(slug ?? '')}${operation === 'delete' ? '' : `/${operation}`}`,
      token,
      headers: { 'If-Match': String(version) },
    })
  }
  throw new CliError('USAGE', 'Unknown careers jobs action', EXIT_CODES.USAGE)
}

async function careersApplications(args: ParsedArgs, runtime: Runtime) {
  const operation = args.positionals[2]
  const { profile, api, org } = await apiContext(args, runtime)
  const base = `/api/v1/orgs/${encodeURIComponent(org)}/careers/applications`
  if (operation === 'list') {
    const token = await runtime.credentials.resolve(profile)
    const job = flag(args, 'job')
    return apiJson(api, {
      path: job ? `/api/v1/orgs/${encodeURIComponent(org)}/careers/jobs/${encodeURIComponent(job)}/applications` : base,
      token,
      query: {
        status: flag(args, 'status'),
        limit: intFlag(args, 'limit', { min: 1, max: 100 }),
        offset: intFlag(args, 'offset', { min: 0 }),
      },
    })
  }
  if (operation === 'show')
    return apiJson(api, {
      path: `${base}/${encodeURIComponent(requiredPositional(args, 3, 'application id'))}`,
      token: await runtime.credentials.resolve(profile),
    })
  if (operation === 'submit') {
    const job = flag(args, 'job') || args.positionals[3]
    if (!job) throw new CliError('USAGE', 'submit requires --job <slug>', EXIT_CODES.USAGE)
    const body = await readJsonInput(args, runtime.stdin)
    if ('resume' in body)
      throw new CliError(
        'VALIDATION_ERROR',
        'The cweb application API does not accept a resume field',
        EXIT_CODES.VALIDATION,
      )
    for (const key of ['name', 'email', 'phone', 'cover-letter'] as const) {
      const value = flag(args, key)
      if (value !== undefined) body[key === 'cover-letter' ? 'coverLetter' : key] = value
    }
    if (hasFlag(args, 'terms-accepted')) body.termsAccepted = true
    if (typeof body.name !== 'string' || typeof body.email !== 'string' || body.termsAccepted !== true)
      throw new CliError(
        'VALIDATION_ERROR',
        'Application submission requires name, email, and termsAccepted=true',
        EXIT_CODES.VALIDATION,
      )
    return mutation(api, args, runtime, {
      method: 'POST',
      path: `/api/v1/orgs/${encodeURIComponent(org)}/careers/jobs/${encodeURIComponent(job)}/applications`,
      body,
      headers: { 'Idempotency-Key': idempotency(args, runtime) },
    })
  }
  const token = await runtime.credentials.resolve(profile)
  if (operation === 'export') return exportApplications(args, runtime, api, token, base)
  const id = requiredPositional(args, 3, 'application id')
  if (operation === 'status') {
    const body = await readJsonInput(args, runtime.stdin)
    const status = flag(args, 'status') || (typeof body.status === 'string' ? body.status : undefined)
    if (!status) throw new CliError('USAGE', '--status is required', EXIT_CODES.USAGE)
    if (!['NEW', 'REVIEWING', 'INTERVIEWED', 'OFFERED', 'HIRED', 'REJECTED'].includes(status))
      throw new CliError('VALIDATION_ERROR', 'Invalid application status', EXIT_CODES.VALIDATION)
    return mutation(api, args, runtime, { method: 'PATCH', path: `${base}/${encodeURIComponent(id)}`, token, body: { status } })
  }
  if (operation === 'anonymize')
    return mutation(api, args, runtime, { method: 'POST', path: `${base}/${encodeURIComponent(id)}/anonymize`, token })
  throw new CliError('USAGE', 'Unknown careers applications action', EXIT_CODES.USAGE)
}

async function exportApplications(
  args: ParsedArgs,
  runtime: Runtime,
  api: ApiTransport,
  token: string,
  base: string,
): Promise<CommandOutput> {
  if (hasFlag(args, 'dry-run'))
    return output({ dryRun: true, method: 'GET', path: `${base}/export`, output: flag(args, 'output') ?? 'stdout' })
  const pages: string[] = []
  let cursor = flag(args, 'cursor')
  for (let page = 0; page < 10_000; page += 1) {
    const response = await api.request({
      path: `${base}/export`,
      token,
      accept: 'text/csv',
      query: { limit: intFlag(args, 'limit', { min: 1, max: 1000 }) ?? 1000, cursor },
    })
    pages.push(response.text)
    if (response.headers['x-export-complete'] === 'true') break
    const next = response.headers['x-next-cursor']
    if (!next || next === cursor)
      throw new CliError('EXPORT_CURSOR_INVALID', 'Export cursor did not advance', EXIT_CODES.NETWORK)
    cursor = next
  }
  const csv = pages.map((page, index) => (index === 0 ? page : page.split('\n').slice(1).join('\n'))).join('')
  const destination = flag(args, 'output')
  if (!destination) return output({ csv, pages: pages.length }, csv)
  const path = resolve(destination)
  await mkdir(dirname(path), { recursive: true })
  const temporary = `${path}.${process.pid}.tmp`
  await writeFile(temporary, csv, { mode: 0o600 })
  await chmod(temporary, 0o600)
  await rename(temporary, path)
  return output({ path, pages: pages.length, bytes: Buffer.byteLength(csv) })
}

async function mutation(
  api: ApiTransport,
  args: ParsedArgs,
  runtime: Runtime,
  options: HttpRequestOptions,
): Promise<CommandOutput> {
  if (hasFlag(args, 'dry-run'))
    return output({
      dryRun: true,
      request: {
        method: options.method,
        path: options.path,
        body: options.body,
        headers: Object.fromEntries(
          Object.entries(options.headers ?? {}).map(([key, value]) => [
            key,
            key.toLowerCase() === 'authorization' ? '<redacted>' : value,
          ]),
        ),
      },
    })
  const response = await api.request(options)
  return {
    data: unwrap(response),
    requestId: response.requestId,
    idempotencyKey: options.headers?.['Idempotency-Key'],
  }
}

async function apiJson(api: ApiTransport, options: HttpRequestOptions): Promise<CommandOutput> {
  const response = await api.request(options)
  return { data: unwrap(response), requestId: response.requestId }
}

function profileFor(args: ParsedArgs, config: Config): Profile {
  const profile = resolveProfile(config, flag(args, 'profile'))
  const apiUrl = flag(args, 'api-url')
  const connectTimeoutMs = intFlag(args, 'connect-timeout', { min: 100 })
  const requestTimeoutMs = intFlag(args, 'request-timeout', { min: 100 })
  return {
    ...profile,
    ...(apiUrl ? { apiUrl: validateApiUrl(apiUrl) } : {}),
    ...(connectTimeoutMs ? { connectTimeoutMs } : {}),
    ...(requestTimeoutMs ? { requestTimeoutMs } : {}),
  }
}

async function apiContext(args: ParsedArgs, runtime: Runtime) {
  const config = await runtime.config.load()
  const profile = profileFor(args, config)
  return { profile, api: runtime.transport(profile), org: requireOrg(profile, args) }
}

async function providerContext(args: ParsedArgs, runtime: Runtime, requireToken: boolean) {
  const config = await runtime.config.load()
  const profile = profileFor(args, config)
  return {
    api: runtime.transport(profile),
    ...(requireToken ? { token: await runtime.credentials.resolve(profile) } : {}),
    ...(profile.orgSlug ? { orgSlug: profile.orgSlug } : {}),
  }
}

function requireOrg(profile: Profile, args: ParsedArgs): string {
  const org = flag(args, 'org') || flag(args, 'org-slug') || profile.orgSlug
  if (!org) throw new CliError('ORG_REQUIRED', 'Set --org or configure an orgSlug', EXIT_CODES.CONFIG)
  return org
}

async function optionalToken(runtime: Runtime, profile: Profile): Promise<string | undefined> {
  try {
    return await runtime.credentials.resolve(profile)
  } catch {
    return undefined
  }
}

function idempotency(args: ParsedArgs, runtime: Runtime): string {
  const value = flag(args, 'idempotency-key') || runtime.randomUUID()
  if (value.length < 8 || value.length > 128)
    throw new CliError('VALIDATION_ERROR', 'Idempotency key must be 8-128 characters', EXIT_CODES.VALIDATION)
  return value
}
