const SHELL_ENV_NAME = /^[A-Za-z_][A-Za-z0-9_]*$/;

function shellSingleQuote(value: string): string {
  return `'${value.replace(/'/g, `'\\''`)}'`;
}

/**
 * Render a vault read as a child-environment handoff.
 *
 * The generated shell never captures a secret from stdout. The named child
 * variable exists only for the duration of `command` and is never interpolated
 * into the outer script.
 */
export function buildSecretsExecShell(secretKey: string, envName: string, command: string): string {
  if (!SHELL_ENV_NAME.test(envName)) {
    throw new Error(`Invalid shell environment variable name: ${envName}`);
  }
  return `secrets exec ${shellSingleQuote(secretKey)} --as ${envName} -- sh -c ${shellSingleQuote(command)}`;
}
