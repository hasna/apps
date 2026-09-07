/** Ordinary CLI, TUI and MCP clients keep mail in the authenticated API. */
export function assertApiClientStorage(env: NodeJS.ProcessEnv = process.env): void {
  const settings = ["HASNA_EMAILS_DB_PATH", "EMAILS_DB_PATH"].filter((name) => env[name]?.trim());
  if (settings.length) {
    throw new Error(`Emails clients require the authenticated Emails API. Unset ${settings.join(" and ")} and configure the API URL and credential with emails auth or the shared credential file. Local SQLite is available only through the explicit storage library and legacy standalone server.`);
  }
}
