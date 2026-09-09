/** Ordinary task-list clients never select an on-box database. */
export function assertTaskListApiEnvironment(env: Record<string, string | undefined> = process.env): void {
  const selectors = ["HASNA_TODOS_DB_PATH", "TODOS_DB_PATH", "HASNA_TODOS_LOCAL", "TODOS_LOCAL"]
    .filter(key => Boolean(env[key]?.trim()));
  if (selectors.length) throw new Error(`Task-list commands require the authenticated shared API. Unset ${selectors.join(", ")} and configure HASNA_TODOS_API_URL and HASNA_TODOS_API_KEY, or saved account credentials.`);
}
