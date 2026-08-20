/**
 * Render a vault read as a child-environment handoff.
 *
 * The generated shell never captures a secret from stdout. The named child
 * variable exists only for the duration of `command` and is never interpolated
 * into the outer script.
 */
export declare function buildSecretsExecShell(secretKey: string, envName: string, command: string): string;
