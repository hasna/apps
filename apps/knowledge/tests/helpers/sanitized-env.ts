export const KNOWLEDGE_TEST_ROLE_ENV_KEYS = [
  'CODEWITH_RUNTIME_ROLE',
  'CODEWITH_EXECUTION_ROLE',
  'CODEWITH_AGENT_ROLE',
  'CODEWITH_ROLE',
  'CODEWITH_HOSTED',
  'CODEWITH_PATH',
  'CODEWITH_HOME',
  'CODEX_HOME',
  'KNOWLEDGE_RUNTIME_ROLE',
  'KNOWLEDGE_EXECUTION_ROLE',
  'KNOWLEDGE_AGENT_ROLE',
  'KNOWLEDGE_ROLE',
  'KNOWLEDGE_HOSTED',
  'HASNA_KNOWLEDGE_STORAGE_MODE',
  'KNOWLEDGE_STORAGE_MODE',
  'HASNA_KNOWLEDGE_MODE',
  'KNOWLEDGE_MODE',
  'HASNA_KNOWLEDGE_API_URL',
  'HASNA_KNOWLEDGE_API_BASE_URL',
  'KNOWLEDGE_API_URL',
  'KNOWLEDGE_API_BASE_URL',
  'OPEN_KNOWLEDGE_API_URL',
  'HASNA_KNOWLEDGE_API_KEY',
  'KNOWLEDGE_API_KEY',
  'OPEN_KNOWLEDGE_API_KEY',
  'HASNA_KNOWLEDGE_DATABASE_URL',
  'KNOWLEDGE_DATABASE_URL',
  'HASNA_KNOWLEDGE_DATABASE_URL_OWNER',
] as const;

export function clearKnowledgeTestRoleEnv(env: NodeJS.ProcessEnv = process.env): void {
  for (const key of KNOWLEDGE_TEST_ROLE_ENV_KEYS) delete env[key];
}

/** Copy ambient non-role settings without inspecting or logging their values. */
export function sanitizedLocalTestEnv(
  overrides: Record<string, string | undefined> = {},
): Record<string, string> {
  const env: Record<string, string> = {};
  for (const [key, value] of Object.entries(process.env)) {
    if (value !== undefined) env[key] = value;
  }
  clearKnowledgeTestRoleEnv(env);
  env.HASNA_KNOWLEDGE_STORAGE_MODE = 'local';
  for (const [key, value] of Object.entries(overrides)) {
    if (value === undefined) delete env[key];
    else env[key] = value;
  }
  return env;
}
