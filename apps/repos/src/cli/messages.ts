export function formatRepoNotFoundMessage(
  repoInput: string,
  suggestion?: { name: string; path?: string }
): string {
  if (!suggestion) {
    return `Repo not found: ${repoInput}`;
  }

  const pathHint = suggestion.path ? ` (${suggestion.path})` : "";
  return `Repo not found: ${repoInput}. Did you mean '${suggestion.name}'${pathHint}?`;
}
