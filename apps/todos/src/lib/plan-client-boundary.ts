export function assertPlanApiEnvironment(
  env: Record<string, string | undefined> = process.env,
): void {
  const keys = [
    "HASNA_TODOS_DB_PATH",
    "TODOS_DB_PATH",
    "HASNA_TODOS_LOCAL",
    "TODOS_LOCAL",
  ].filter((key) => Boolean(env[key]?.trim()));
  if (keys.length)
    throw new Error(
      `Plan commands require the authenticated shared API. Unset ${keys.join(", ")} and configure HASNA_TODOS_API_URL and HASNA_TODOS_API_KEY, or saved account credentials.`,
    );
}
