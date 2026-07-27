/**
 * Provider resolution + credential loading. Credentials are read from the
 * environment first, then (optionally) from the `secrets` CLI vault. Values are
 * held only in memory and passed straight to the provider SDK — they are never
 * logged, printed, or written to disk by this package.
 */
import { LocalSandboxBackend, defaultSandboxesHome } from "./local-backend"
import { createE2bBackend } from "./e2b-backend"
import { createDaytonaBackend } from "./daytona-backend"
import { MissingCredentialsError, SandboxError, type SandboxBackend, type SandboxProvider } from "./types"

export type SecretsReader = (name: string) => string | undefined

export interface ResolveDeps {
  home?: string
  env?: NodeJS.ProcessEnv
  /** Injectable secret source; defaults to the `secrets` CLI vault. */
  secretsReader?: SecretsReader
}

export const SANDBOX_PROVIDERS: readonly SandboxProvider[] = ["local", "e2b", "daytona"]

export function isSandboxProvider(value: string): value is SandboxProvider {
  return (SANDBOX_PROVIDERS as readonly string[]).includes(value)
}

/** Reads a secret from the `secrets` CLI without ever surfacing its value. */
export function defaultSecretsReader(): SecretsReader {
  return (name: string): string | undefined => {
    try {
      const proc = Bun.spawnSync({
        cmd: ["secrets", "get", name, "--raw"],
        stdout: "pipe",
        stderr: "ignore",
      })
      if (proc.exitCode !== 0) return undefined
      const value = proc.stdout.toString().trim()
      return value.length > 0 ? value : undefined
    } catch {
      return undefined
    }
  }
}

export async function resolveBackend(provider: SandboxProvider, deps: ResolveDeps = {}): Promise<SandboxBackend> {
  const env = deps.env ?? process.env
  const home = deps.home ?? defaultSandboxesHome(env)

  if (provider === "local") return new LocalSandboxBackend(home)

  const secretsReader = deps.secretsReader ?? defaultSecretsReader()
  const readSecret = (name: string): string | undefined => {
    const fromEnv = env[name]
    if (fromEnv !== undefined && fromEnv.length > 0) return fromEnv
    return secretsReader(name)
  }

  if (provider === "e2b") {
    const apiKey = readSecret("E2B_API_KEY")
    if (apiKey === undefined) {
      throw new MissingCredentialsError(
        "e2b provider requires direct E2B_API_KEY credentials (set the env var or store E2B_API_KEY in the `secrets` vault; the v1 CLI does not route this request through Hasna cloud)",
      )
    }
    return createE2bBackend({ apiKey })
  }

  if (provider === "daytona") {
    const apiKey = readSecret("DAYTONA_API_KEY")
    if (apiKey === undefined) {
      throw new MissingCredentialsError(
        "daytona provider requires direct DAYTONA_API_KEY credentials (set the env var or store DAYTONA_API_KEY in the `secrets` vault; the v1 CLI does not route this request through Hasna cloud)",
      )
    }
    const apiUrl = readSecret("DAYTONA_API_URL")
    return createDaytonaBackend({ apiKey, ...(apiUrl === undefined ? {} : { apiUrl }) })
  }

  throw new SandboxError("unknown_provider", `unknown provider: ${String(provider)}`)
}
