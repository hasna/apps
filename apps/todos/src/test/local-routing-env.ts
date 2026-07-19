/**
 * Explicit local routing baseline for subprocess tests.
 *
 * Developer machines can carry live self-hosted credentials, shell startup
 * hooks, proxy settings, and provider configuration. Tests inherit only the
 * variables required to launch a child process; every other value must be an
 * explicit override owned by the test.
 */
const LAUNCH_ENV_ALLOWLIST = [
  "PATH",
  "PATHEXT",
  "SystemRoot",
  "SYSTEMROOT",
  "WINDIR",
  "COMSPEC",
] as const;

type TestEnvironment = Readonly<Record<string, string | undefined>>;

export function localRoutingTestEnv(
  overrides: Record<string, string | undefined> = {},
  ambientEnv: TestEnvironment = process.env,
): Record<string, string | undefined> {
  const launchEnv: Record<string, string> = {};
  for (const key of LAUNCH_ENV_ALLOWLIST) {
    const value = ambientEnv[key];
    if (value !== undefined) launchEnv[key] = value;
  }

  return {
    ...launchEnv,
    NO_COLOR: "1",
    HASNA_TODOS_STORAGE_MODE: "local",
    TODOS_STORAGE_MODE: "local",
    HASNA_TODOS_DB_PATH: "",
    HASNA_TODOS_API_URL: "",
    HASNA_TODOS_API_KEY: "",
    TODOS_API_URL: "",
    TODOS_API_KEY: "",
    ...overrides,
  };
}
