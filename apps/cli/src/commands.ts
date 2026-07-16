import { createHash } from 'node:crypto'
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
import { asCliError, CliError, EXIT_CODES } from './errors.js'
import { unwrap, type ApiTransport, type HttpRequestOptions } from './http.js'
import { readJsonInput } from './input.js'
import { createPlan, requirePlanApproval } from './plan.js'
import { builtinProviders, cwebProvider } from './providers/cweb.js'
import type { CommandOutput, Runtime } from './runtime.js'
import { atomicWritePrivateFile } from './local-files.js'

const HELP = `Hasna CLI 0.2.0

Usage: hasna [global options] <command> [subcommand] [options]

Common API options (command-scoped):
  --json                       Emit hasna.cli_result.v1 JSON
  --profile <name>             Select a profile
  --api-url <url>              Override the profile API URL
  --connect-timeout <ms>       Override connect timeout
  --request-timeout <ms>       Override request timeout

Authentication secrets:
  --password-stdin             Read the password from standard input
  --two-factor-env <VAR>       Read optional six-digit 2FA from an environment variable

Commands:
  doctor | config
  plans list|show|resolve
  profiles list|show|add|use|remove
  auth login|logout|status|whoami|tokens
  apps list|search|show|status|install|update|uninstall
  accounts list|show|provision|deprovision
  app cweb capabilities
  careers jobs list|show|create|update|publish|close|delete
  careers applications list|show|submit|status|export|anonymize

Exit codes: 0 success; 2 usage/local validation/config; 3 authentication;
4 permission; 5 not found; 6 conflict; 7 network/TLS/timeout;
8 remote failure; 9 partial; 10 cancelled; 11 unsupported; 70 internal.
`

export async function dispatch(args: ParsedArgs, runtime: Runtime): Promise<CommandOutput> {
  const [group, action] = args.positionals
  if (!group || group === 'help' || hasFlag(args, 'help')) return output(HELP.trim(), HELP)
  if (group === 'version' || (hasFlag(args, 'version') && args.positionals.length === 0))
    return output({ version: '0.2.0' }, '0.2.0\n')
  if (group === 'doctor') return doctor(args, runtime)
  if (group === 'config') return configCommand(args, runtime)
  if (group === 'plans') return plans(action, args, runtime)
  if (group === 'profiles') return profiles(action, args, runtime)
  if (group === 'apps') return apps(action, args, runtime)
  if (group === 'accounts') return accounts(action, args, runtime)
  if (group === 'app') return appCommand(action, args, runtime)
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

async function plans(action: string | undefined, args: ParsedArgs, runtime: Runtime): Promise<CommandOutput> {
  if (action === 'list') {
    const config = await runtime.config.load()
    return output(Object.entries(config.pendingPlans ?? {}).sort(([left], [right]) => left.localeCompare(right)).map(([digest, plan]) => ({
      digest,
      operation: plan.operation,
      target: plan.target,
      expiresAt: plan.expiresAt,
      state: plan.state ?? 'pending',
      ...(plan.reservedAt ? { reservedAt: plan.reservedAt } : {}),
    })))
  }
  const digest = requiredPositional(args, 2, 'plan digest')
  validatePlanDigest(digest)
  if (action === 'show') {
    const plan = (await runtime.config.load()).pendingPlans?.[digest]
    if (!plan) throw new CliError('PLAN_NOT_FOUND', 'The mutation plan was not found', EXIT_CODES.NOT_FOUND)
    return output({ digest, ...plan, reservationId: plan.reservationId ? '<redacted>' : undefined })
  }
  if (action === 'resolve') {
    const outcome = flag(args, 'outcome')
    if (outcome !== 'applied' && outcome !== 'not-applied')
      throw new CliError('USAGE', 'plans resolve requires --outcome applied|not-applied', EXIT_CODES.USAGE)
    if (!hasFlag(args, 'yes'))
      throw new CliError('CONFIRMATION_REQUIRED', 'plans resolve requires --yes after remote verification', EXIT_CODES.CANCELLED)
    const warning = outcome === 'not-applied'
      ? 'Only resolve as not-applied after independently verifying the remote mutation did not take effect.'
      : 'Resolve as applied only after independently verifying the remote mutation took effect.'
    try {
      await retryConfigBusy(digest, () => runtime.config.update((config) => {
        const plan = config.pendingPlans?.[digest]
        if (!plan) throw new CliError('PLAN_NOT_FOUND', 'The mutation plan was not found', EXIT_CODES.NOT_FOUND)
        if (plan.state !== 'in-flight')
          throw new CliError('PLAN_NOT_IN_FLIGHT', 'Only an in-flight mutation plan can be resolved', EXIT_CODES.CONFLICT)
        if (outcome === 'applied') delete config.pendingPlans?.[digest]
        else config.pendingPlans![digest] = {
          operation: plan.operation,
          target: plan.target,
          expiresAt: new Date(runtime.now().getTime() + 10 * 60_000).toISOString(),
          state: 'pending',
        }
      }))
    } catch (error) {
      if (asCliError(error).code === 'CONFIG_BUSY')
        throw new CliError('PLAN_STATE_BUSY', 'The mutation plan state is busy', EXIT_CODES.CONFLICT, { cause: error })
      throw error
    }
    return output({ digest, resolved: true, outcome, warning })
  }
  throw new CliError('USAGE', 'plans requires list, show, or resolve', EXIT_CODES.USAGE)
}

function validatePlanDigest(digest: string): void {
  if (!/^sha256:[0-9a-f]{64}$/.test(digest))
    throw new CliError('VALIDATION_ERROR', 'Invalid plan digest', EXIT_CODES.VALIDATION)
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
      apiUrl: validateApiUrl(apiUrl, { allowInsecureLocalhost: hasFlag(args, 'allow-insecure-localhost') }),
      ...(hasFlag(args, 'allow-insecure-localhost') ? { allowInsecureLocalhost: true } : {}),
      ...(flag(args, 'org') || flag(args, 'org-slug')
        ? { orgSlug: flag(args, 'org') || flag(args, 'org-slug') }
        : {}),
      ...(credentialEnv ? { credential: `env:${credentialEnv}` as const } : {}),
      ...(store ? { credentialStore: store as 'keychain' | 'encrypted-file' } : {}),
    }
    await runtime.config.update((current) => {
      if (current.profiles[name]) throw new CliError('PROFILE_EXISTS', `Profile ${name} already exists`, EXIT_CODES.CONFLICT)
      current.profiles[name] = profile
      current.currentProfile ??= name
    })
    return output({ ...profile, credential: credentialEnv ? 'env:<redacted>' : undefined })
  }
  if (action === 'use') {
    const name = requiredPositional(args, 2, 'profile name')
    await runtime.config.update((current) => {
      if (!current.profiles[name]) throw new CliError('PROFILE_NOT_FOUND', `Profile ${name} was not found`, EXIT_CODES.NOT_FOUND)
      current.currentProfile = name
    })
    return output({ currentProfile: name })
  }
  if (action === 'remove') {
    const name = requiredPositional(args, 2, 'profile name')
    await runtime.config.update(async (current) => {
      const profile = current.profiles[name]
      if (!profile) throw new CliError('PROFILE_NOT_FOUND', `Profile ${name} was not found`, EXIT_CODES.NOT_FOUND)
      await runtime.credentials.delete(profile)
      delete current.profiles[name]
      if (current.currentProfile === name) current.currentProfile = Object.keys(current.profiles)[0]
    })
    return output({ removed: name })
  }
  throw new CliError('USAGE', 'profiles requires list, show, add, use, or remove', EXIT_CODES.USAGE)
}

async function apps(action: string | undefined, args: ParsedArgs, runtime: Runtime) {
  let config = await runtime.config.load()
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
      const compatibility = await inspectCwebApi(runtime.transport(profile))
      api = { reachable: true, ...compatibility }
    } catch (error) {
      api = { reachable: false, reason: error instanceof CliError ? error.code : 'NETWORK_ERROR' }
    }
    return output({ installed: Boolean(installed), installation: installed, api })
  }
  if (!['install', 'update', 'uninstall'].includes(action ?? ''))
    throw new CliError('USAGE', 'Unknown apps action', EXIT_CODES.USAGE)
  let context: Record<string, unknown> = { providerVersion: provider.manifest.version }
  if (action !== 'uninstall') {
    const profile = profileFor(args, config)
    const compatibility = await inspectCwebApi(runtime.transport(profile))
    if (!compatibility.compatible)
      throw new CliError('API_INCOMPATIBLE', 'The configured cweb API is incompatible with this CLI', EXIT_CODES.REMOTE)
    context = { ...context, profile: profile.name, apiUrl: profile.apiUrl, org: requireOrg(profile, args), openApiHash: compatibility.hash }
  }
  const changes =
    action === 'uninstall'
      ? { from: config.apps[id] ?? null, to: null, context }
      : { from: config.apps[id] ?? null, to: provider.manifest, context }
  const plan = createPlan(`apps.${action}`, id, changes)
  if (hasFlag(args, 'dry-run')) return output({ ...plan, dryRun: true })
  const authorization = await authorizePlan(args, runtime, plan)
  if (authorization.waiting) return authorization.waiting
  let applied: Config
  try {
    applied = await runtime.config.update((current) => {
      if (action === 'uninstall') delete current.apps[id]
      else {
        const now = runtime.now().toISOString()
        current.apps[id] = {
          id,
          version: provider.manifest.version,
          provider: provider.manifest.provider,
          installedAt: current.apps[id]?.installedAt ?? now,
          updatedAt: now,
        }
      }
    })
  } catch (error) {
    await settleAfterFailure(runtime, authorization, error)
    throw error
  }
  await settleAfterSuccess(runtime, authorization)
  return output({ applied: true, planDigest: plan.digest, app: applied.apps[id] ?? null })
}

async function appCommand(action: string | undefined, args: ParsedArgs, runtime: Runtime) {
  const subcommand = args.positionals[2]
  if (action === 'cweb' && subcommand === 'capabilities') {
    const config = await runtime.config.load()
    const profile = profileFor(args, config)
    return output(await inspectCwebApi(runtime.transport(profile)))
  }
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
  const config = await runtime.config.load()
  const profile = profileFor(args, config)
  const org = requireOrg(profile, args)
  const plan = createPlan(`accounts.${action}`, target, {
    context: { profile: profile.name, apiUrl: profile.apiUrl, org, provider: provider.manifest.provider, providerVersion: provider.manifest.version },
    changes,
  })
  if (hasFlag(args, 'dry-run')) return output({ ...plan, dryRun: true })
  const authorization = await authorizePlan(args, runtime, plan)
  if (authorization.waiting) return authorization.waiting
  let result: unknown
  try {
    if (action === 'provision' && provider.accounts.provision) result = await provider.accounts.provision(context, changes)
    else if (action === 'deprovision' && provider.accounts.deprovision) result = await provider.accounts.deprovision(context, target)
    else throw new CliError('CAPABILITY_UNSUPPORTED', `Provider ${provider.id} cannot ${action}`, EXIT_CODES.UNSUPPORTED)
  } catch (error) {
    await settleAfterFailure(runtime, authorization, error)
    throw error
  }
  await settleAfterSuccess(runtime, authorization)
  return output(result)
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
    const twoFactorEnv = flag(args, 'two-factor-env')
    if (twoFactorEnv && !/^[A-Z_][A-Z0-9_]*$/.test(twoFactorEnv))
      throw new CliError('VALIDATION_ERROR', 'Invalid two-factor environment variable', EXIT_CODES.VALIDATION)
    const twoFactorCode = twoFactorEnv ? runtime.env[twoFactorEnv] : undefined
    if (twoFactorEnv && !twoFactorCode)
      throw new CliError('TWO_FACTOR_REQUIRED', 'The configured two-factor environment variable is empty', EXIT_CODES.AUTH)
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
    const unwrapped = unwrap(response)
    const data = unwrapped && typeof unwrapped === 'object' && !Array.isArray(unwrapped) ? unwrapped as Record<string, unknown> : {}
    const token = data.token
    if (typeof token !== 'string')
      throw new CliError('REMOTE_RESPONSE_INVALID', 'The login response did not contain a token', EXIT_CODES.REMOTE, { requestId: response.requestId })
    let updated: Profile | undefined
    await runtime.config.update(async (current) => {
      const latest = { ...(current.profiles[profile.name] ?? profile), credentialStore: profile.credentialStore }
      updated = await runtime.credentials.store(latest, token)
      current.profiles[profile.name] = { ...updated, orgSlug }
    })
    const { token: _redacted, ...safe } = data
    return { data: { ...safe, stored: updated?.credentialStore }, requestId: response.requestId }
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
    return guardedMutation(api, args, runtime, mutationContext('auth.tokens.revoke', requiredPositional(args, 3, 'token id'), profile, org), {
      method: 'DELETE',
      path: `/api/v1/orgs/${encodeURIComponent(org)}/auth/tokens/${encodeURIComponent(requiredPositional(args, 3, 'token id'))}`,
      token,
    })
  if (operation === 'rotate') {
    if (!flag(args, 'idempotency-key'))
      throw new CliError('USAGE', 'Token rotation requires an explicit --idempotency-key', EXIT_CODES.USAGE)
    return guardedMutation(api, args, runtime, mutationContext('auth.tokens.rotate', requiredPositional(args, 3, 'token id'), profile, org), {
      method: 'POST',
      path: `/api/v1/orgs/${encodeURIComponent(org)}/auth/tokens/${encodeURIComponent(requiredPositional(args, 3, 'token id'))}/rotate`,
      token,
      headers: { 'Idempotency-Key': idempotency(args, runtime) },
    })
  }
  if (operation === 'revoke-all')
    return guardedMutation(api, args, runtime, mutationContext('auth.tokens.revoke-all', org, profile, org), {
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
        department: flag(args, 'department'),
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
    return guardedMutation(api, args, runtime, mutationContext(`careers.jobs.${operation}`, slug ?? '', profile, org), {
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
    return guardedMutation(api, args, runtime, mutationContext('careers.applications.status', id, profile, org), { method: 'PATCH', path: `${base}/${encodeURIComponent(id)}`, token, body: { status } })
  }
  if (operation === 'anonymize')
    return guardedMutation(api, args, runtime, mutationContext('careers.applications.anonymize', id, profile, org), { method: 'POST', path: `${base}/${encodeURIComponent(id)}/anonymize`, token })
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
  const rows: string[] = []
  let cursor = flag(args, 'cursor')
  let pages = 0
  let bytes = 0
  let complete = false
  for (let page = 0; page < 1_000; page += 1) {
    const response = await api.request({
      path: `${base}/export`,
      token,
      accept: 'text/csv',
      query: { limit: intFlag(args, 'limit', { min: 1, max: 1000 }) ?? 1000, cursor },
    })
    pages += 1
    bytes += Buffer.byteLength(response.text)
    if (bytes > 50 * 1024 * 1024)
      throw new CliError('EXPORT_LIMIT_EXCEEDED', 'The export exceeded the 50 MiB safety limit', EXIT_CODES.PARTIAL, { details: { pages, bytes } })
    const lines = response.text.replace(/\r\n/g, '\n').split('\n')
    if (lines.at(-1) === '') lines.pop()
    rows.push(...(page === 0 ? lines : lines.slice(1)))
    if (response.headers['x-export-complete'] === 'true') {
      complete = true
      break
    }
    const next = response.headers['x-next-cursor']
    if (!next || next === cursor)
      throw new CliError('REMOTE_EXPORT_CURSOR_INVALID', 'The API returned an invalid export cursor', EXIT_CODES.REMOTE, { requestId: response.requestId })
    cursor = next
  }
  if (!complete)
    throw new CliError('EXPORT_INCOMPLETE', 'The export did not complete within the 1,000-page safety limit', EXIT_CODES.PARTIAL, { details: { pages, bytes } })
  const csv = `${rows.join('\n')}\n`
  const destination = flag(args, 'output')
  if (!destination) return output({ csv, pages }, csv)
  const path = resolve(destination)
  await mkdir(dirname(path), { recursive: true, mode: 0o700 })
  await atomicWritePrivateFile(path, csv, { requirePrivateParent: false })
  return output({ path, pages, bytes: Buffer.byteLength(csv) })
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

type MutationContext = {
  operation: string
  target: string
  profile: string
  apiUrl: string
  org: string
  provider: 'builtin:cweb'
  apiRevision: '1.1.0'
}

function mutationContext(operation: string, target: string, profile: Profile, org: string): MutationContext {
  return { operation, target, profile: profile.name, apiUrl: profile.apiUrl, org, provider: 'builtin:cweb', apiRevision: '1.1.0' }
}

async function guardedMutation(
  api: ApiTransport,
  args: ParsedArgs,
  runtime: Runtime,
  context: MutationContext,
  options: HttpRequestOptions,
): Promise<CommandOutput> {
  if (hasFlag(args, 'dry-run')) return mutation(api, args, runtime, options)
  const safeRequest = {
    method: options.method,
    path: options.path,
    body: options.body,
    headers: options.headers,
  }
  const plan = createPlan(context.operation, context.target, { context, request: safeRequest })
  const authorization = await authorizePlan(args, runtime, plan)
  if (authorization.waiting) return authorization.waiting
  let result: CommandOutput
  try {
    result = await mutation(api, args, runtime, options)
  } catch (error) {
    await settleAfterFailure(runtime, authorization, error)
    throw error
  }
  await settleAfterSuccess(runtime, authorization, result.requestId)
  return result
}

type PlanAuthorization = { waiting?: CommandOutput; reservation?: { digest: string; id: string } }

async function authorizePlan(args: ParsedArgs, runtime: Runtime, plan: ReturnType<typeof createPlan>): Promise<PlanAuthorization> {
  const now = runtime.now().getTime()
  const apply = flag(args, 'apply')
  if (!apply) {
    let status: Awaited<ReturnType<Runtime['config']['recordPendingPlan']>>
    try {
      status = await retryConfigBusy(plan.digest, () => runtime.config.recordPendingPlan(plan.digest, {
        operation: plan.operation,
        target: plan.target,
        expiresAt: new Date(now + 10 * 60_000).toISOString(),
      }, now))
    } catch (error) {
      if (asCliError(error).code === 'CONFIG_BUSY')
        throw new CliError('PLAN_STATE_BUSY', 'The mutation plan state is busy', EXIT_CODES.CONFLICT, { cause: error })
      throw error
    }
    if (status === 'in-flight')
      throw new CliError('PLAN_IN_FLIGHT', 'An identical mutation plan is already being applied', EXIT_CODES.CONFLICT)
    return { waiting: output(plan) }
  }
  requirePlanApproval(plan, apply, hasFlag(args, 'yes'))
  const reservationId = runtime.randomUUID()
  let reserved: boolean
  try {
    reserved = await retryConfigBusy(reservationId, () => runtime.config.reservePendingPlan(apply, plan.operation, plan.target, now, reservationId))
  } catch (error) {
    if (asCliError(error).code === 'CONFIG_BUSY')
      throw new CliError('PLAN_RESERVATION_BUSY', 'The mutation plan is being reserved by another process', EXIT_CODES.CONFLICT, { cause: error })
    throw error
  }
  if (!reserved)
    throw new CliError('PLAN_EXPIRED_OR_REPLAYED', 'The mutation plan is expired, unknown, or already used', EXIT_CODES.CONFLICT)
  return { reservation: { digest: apply, id: reservationId } }
}

async function settleAuthorization(runtime: Runtime, authorization: PlanAuthorization, outcome: 'consume' | 'release'): Promise<void> {
  if (!authorization.reservation) return
  const settled = await retryConfigBusy(
    authorization.reservation.id,
    () => runtime.config.settlePendingPlan(authorization.reservation!.digest, authorization.reservation!.id, outcome),
  )
  if (!settled)
    throw new CliError('PLAN_RESERVATION_LOST', 'The mutation plan reservation could not be finalized', EXIT_CODES.CONFLICT)
}

async function settleAfterSuccess(runtime: Runtime, authorization: PlanAuthorization, requestId?: string): Promise<void> {
  try {
    await settleAuthorization(runtime, authorization, 'consume')
  } catch (error) {
    throw new CliError(
      'MUTATION_SETTLEMENT_PARTIAL',
      'The mutation completed, but its local plan state could not be finalized; do not automatically retry',
      EXIT_CODES.PARTIAL,
      { cause: error, requestId, details: authorization.reservation ? { planDigest: authorization.reservation.digest } : undefined },
    )
  }
}

async function settleAfterFailure(runtime: Runtime, authorization: PlanAuthorization, error: unknown): Promise<void> {
  try {
    await settleAuthorization(runtime, authorization, shouldReleasePlan(error) ? 'release' : 'consume')
  } catch {
    // Preserve the remote/transport failure. The in-flight reservation remains fail-closed until expiry.
  }
}

function shouldReleasePlan(error: unknown): boolean {
  return asCliError(error).exitCode === EXIT_CODES.NETWORK
}

async function retryConfigBusy<T>(key: string, operation: () => Promise<T>): Promise<T> {
  for (let attempt = 0; attempt < 3; attempt += 1) {
    try {
      return await operation()
    } catch (error) {
      if (asCliError(error).code !== 'CONFIG_BUSY' || attempt === 2) throw error
      await wait(configRetryDelay(key, attempt))
    }
  }
  throw new CliError('CONFIG_BUSY', 'The CLI configuration is busy', EXIT_CODES.CONFIG)
}

function configRetryDelay(key: string, attempt: number): number {
  const jitter = [...key].reduce((total, character) => total + character.charCodeAt(0), 0) % 7
  return 5 + attempt * 10 + jitter
}

async function wait(milliseconds: number): Promise<void> {
  await new Promise((resolve) => setTimeout(resolve, milliseconds))
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
    ...(apiUrl ? { apiUrl: validateApiUrl(apiUrl, { allowInsecureLocalhost: profile.allowInsecureLocalhost }) } : {}),
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
  if (!/^[A-Za-z0-9._:-]{8,128}$/.test(value))
    throw new CliError('VALIDATION_ERROR', 'Idempotency key must match [A-Za-z0-9._:-]{8,128}', EXIT_CODES.VALIDATION)
  return value
}

const requiredCwebOperations: Array<[string, string]> = [
  ['/api/v1/auth/login', 'post'],
  ['/api/v1/auth/whoami', 'get'],
  ['/api/v1/auth/logout', 'post'],
  ['/api/v1/orgs/{orgSlug}/auth/tokens', 'get'],
  ['/api/v1/orgs/{orgSlug}/auth/tokens', 'post'],
  ['/api/v1/orgs/{orgSlug}/auth/tokens/{id}', 'delete'],
  ['/api/v1/orgs/{orgSlug}/auth/tokens/{id}/rotate', 'post'],
  ['/api/v1/orgs/{orgSlug}/auth/tokens/revoke-all', 'post'],
  ['/api/v1/orgs/{orgSlug}/careers/jobs', 'get'],
  ['/api/v1/orgs/{orgSlug}/careers/jobs', 'post'],
  ['/api/v1/orgs/{orgSlug}/careers/jobs/{slug}', 'get'],
  ['/api/v1/orgs/{orgSlug}/careers/jobs/{slug}', 'patch'],
  ['/api/v1/orgs/{orgSlug}/careers/jobs/{slug}', 'delete'],
  ['/api/v1/orgs/{orgSlug}/careers/jobs/{slug}/publish', 'post'],
  ['/api/v1/orgs/{orgSlug}/careers/jobs/{slug}/close', 'post'],
  ['/api/v1/orgs/{orgSlug}/careers/jobs/{slug}/applications', 'get'],
  ['/api/v1/orgs/{orgSlug}/careers/jobs/{slug}/applications', 'post'],
  ['/api/v1/orgs/{orgSlug}/careers/applications', 'get'],
  ['/api/v1/orgs/{orgSlug}/careers/applications/export', 'get'],
  ['/api/v1/orgs/{orgSlug}/careers/applications/{id}', 'get'],
  ['/api/v1/orgs/{orgSlug}/careers/applications/{id}', 'patch'],
  ['/api/v1/orgs/{orgSlug}/careers/applications/{id}/anonymize', 'post'],
]

async function inspectCwebApi(api: ApiTransport) {
  const response = await api.request({ path: cwebProvider.manifest.api.openApiPath })
  const spec = (response.body && typeof response.body === 'object' && !Array.isArray(response.body) ? response.body : {}) as { info?: { title?: unknown; version?: unknown }; paths?: Record<string, Record<string, unknown>> }
  const missing = requiredCwebOperations
    .filter(([path, method]) => !spec.paths?.[path]?.[method])
    .map(([path, method]) => `${method.toUpperCase()} ${path}`)
  const title = spec.info?.title
  const version = spec.info?.version
  const compatible = title === 'Hasna CWeb CLI API' && isSemverAtLeast(version, '1.1.0') && missing.length === 0
  const hash = `sha256:${createHash('sha256').update(stableJson(response.body)).digest('hex')}`
  return { compatible, title, version, missing, hash, requiredVersion: '1.1.0' }
}

function isSemverAtLeast(value: unknown, minimum: string): boolean {
  if (typeof value !== 'string') return false
  const parse = (input: string) => {
    const match = /^(\d+)\.(\d+)\.(\d+)(?:-([0-9A-Za-z.-]+))?(?:\+[0-9A-Za-z.-]+)?$/.exec(input)
    return match ? { core: [Number(match[1]), Number(match[2]), Number(match[3])] as const, prerelease: match[4] } : undefined
  }
  const actual = parse(value)
  const required = parse(minimum)
  if (!actual || !required) return false
  for (let index = 0; index < 3; index += 1) {
    if (actual.core[index] !== required.core[index]) return (actual.core[index] ?? 0) > (required.core[index] ?? 0)
  }
  return !actual.prerelease || Boolean(required.prerelease)
}

function stableJson(value: unknown): string {
  if (value === null || typeof value !== 'object') return JSON.stringify(value)
  if (Array.isArray(value)) return `[${value.map(stableJson).join(',')}]`
  return `{${Object.entries(value as Record<string, unknown>).sort(([a], [b]) => a.localeCompare(b)).map(([key, item]) => `${JSON.stringify(key)}:${stableJson(item)}`).join(',')}}`
}
