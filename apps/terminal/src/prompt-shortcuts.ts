export interface PromptShortcut {
  command: string;
  displayCommand?: string;
  reason: string;
}

function normalizePrompt(prompt: string): string {
  return prompt
    .toLowerCase()
    .replace(/[?!,.;:]+/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function asksToRun(prompt: string): boolean {
  return /\b(run|execute|start)\b/.test(prompt);
}

export function getPromptShortcut(prompt: string): PromptShortcut | null {
  const p = normalizePrompt(prompt);

  if (/\b(typecheck|type check|tsc)\b/.test(p)) {
    return { command: "bun run typecheck", reason: "local typecheck shortcut" };
  }

  if (/\b(run|execute)\b.*\b(build|compile)\b|\b(build|compile)\b.*\b(project|repo|package)\b/.test(p)) {
    return { command: "bun run build", reason: "local build shortcut" };
  }

  if (asksToRun(p) && /\b(tests?|test suite|unit tests?)\b/.test(p)) {
    return { command: "bun test", reason: "local test runner shortcut" };
  }

  if (/\b(todos?|fixmes?|throw new|console error|console\.error)\b/.test(p) && /\b(test|tests|debug|triage|find|search)\b/.test(p)) {
    return {
      command: 'rg -n "TODO|FIXME|throw new|console\\\\.error|describe" src package.json',
      displayCommand: "rg TODO/FIXME/errors/tests",
      reason: "local debug search shortcut",
    };
  }

  if (/\b(what|which|show|find|list)\b.*\b(tests? exist|test files?|spec files?)\b|\b(test files?|spec files?)\b.*\b(what|which|show|find|list)\b/.test(p)) {
    return {
      command: "find . \\( -path './node_modules' -o -path './dist' -o -path './.git' \\) -prune -o \\( -name '*.test.ts' -o -name '*.test.tsx' -o -name '*.spec.ts' -o -name '*.spec.tsx' \\) -type f -print | sort",
      displayCommand: "find test files",
      reason: "local test discovery shortcut",
    };
  }

  if (/\b(what|show|summarize|summary|current)\b.*\b(changed|changes|git|working tree|status)\b|\bgit\b.*\b(status|changes?)\b/.test(p)) {
    return { command: "git status --short --branch", reason: "local git status shortcut" };
  }

  if (/\b(source|src|code|project|repo)\b.*\b(structure|files?|tree|layout)\b|\b(show|list)\b.*\b(source|src)\b/.test(p)) {
    return { command: "find src -maxdepth 2 -type f | sort", displayCommand: "find src files", reason: "local source structure shortcut" };
  }

  if (/\b(overview|summarize project|project summary|repo summary)\b/.test(p)) {
    return { command: "find src -maxdepth 2 -type f | sort", displayCommand: "find src files", reason: "local project overview shortcut" };
  }

  return null;
}
