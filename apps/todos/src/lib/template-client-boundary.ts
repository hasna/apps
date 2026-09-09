export function assertTemplateApiEnvironment(
  env: Record<string, string | undefined>,
): void {
  const forbidden = [
    "HASNA_TODOS_DB_PATH",
    "TODOS_DB_PATH",
    "HASNA_TODOS_LOCAL",
    "TODOS_LOCAL",
  ].filter((key) => env[key]?.trim());
  if (forbidden.length)
    throw new Error(
      `Template clients reject ${forbidden.join(", ")}. Configure HASNA_TODOS_API_URL and HASNA_TODOS_API_KEY, or saved account credentials.`,
    );
}
