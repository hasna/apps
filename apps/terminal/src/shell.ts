export function getShell(): string {
  return process.env.SHELL || "/bin/bash";
}
