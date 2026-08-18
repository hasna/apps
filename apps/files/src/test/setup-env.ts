const CLIENT_HOSTED_ENV_KEYS = [
  "HASNA_FILES_API_URL",
  "HASNA_FILES_API_KEY",
  "FILES_API_URL",
  "FILES_API_KEY",
] as const;

for (const key of CLIENT_HOSTED_ENV_KEYS) {
  delete process.env[key];
}
