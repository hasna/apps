export function childEnvironment(env: NodeJS.ProcessEnv = process.env): Record<string, string> {
  const allowed = /^(PATH|HOME|USER|LOGNAME|SHELL|TMPDIR|TEMP|TMP|TERM|COLORTERM|LANG|LC_[A-Z_]+|XDG_CONFIG_HOME|XDG_DATA_HOME|XDG_STATE_HOME|XDG_CACHE_HOME|SSH_AUTH_SOCK|GIT_SSH_COMMAND|EDITOR|VISUAL|NO_COLOR|FORCE_COLOR|CODEX_HOME|GROK_HOME|GROK_SANDBOX|GROK_DISABLE_API_KEY_AUTH|CLAUDE_CONFIG_DIR)$/;
  return Object.fromEntries(Object.entries(env).filter((entry): entry is [string,string] => allowed.test(entry[0]) && entry[1] !== undefined));
}
