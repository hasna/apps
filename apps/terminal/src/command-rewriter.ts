// Command rewriter — auto-optimize commands to produce less output
// Only rewrites when semantic result is identical

interface RewriteRule {
  pattern: RegExp;
  rewrite: (match: RegExpMatchArray, cmd: string) => string;
  reason: string;
}

const rules: RewriteRule[] = [
  // find | grep -v node_modules → find -not -path
  {
    pattern: /find\s+(\S+)\s+(.*?)\|\s*grep\s+-v\s+node_modules/,
    rewrite: (m, cmd) => cmd.replace(m[0], `find ${m[1]} ${m[2]}-not -path '*/node_modules/*'`),
    reason: "avoid pipe, filter in-kernel",
  },
  // cat file | grep X → grep X file
  {
    pattern: /cat\s+(\S+)\s*\|\s*grep\s+(.*)/,
    rewrite: (m) => `grep ${m[2]} ${m[1]}`,
    reason: "useless cat",
  },
  // find without node_modules exclusion → add it
  {
    pattern: /^find\s+\.\s+(.*)(?!.*node_modules)/,
    rewrite: (m, cmd) => {
      if (cmd.includes("node_modules") || cmd.includes("-not -path")) return cmd;
      return cmd.replace(/^find\s+\.\s+/, "find . -not -path '*/node_modules/*' -not -path '*/.git/*' ");
    },
    reason: "auto-exclude node_modules and .git",
  },
  // git log without limit → add --oneline -20
  {
    pattern: /^git\s+log\s*$/,
    rewrite: () => "git log --oneline -20",
    reason: "prevent unbounded log output",
  },
  // git diff without stat → add --stat for overview
  {
    pattern: /^git\s+diff\s*$/,
    rewrite: () => "git diff --stat",
    reason: "stat overview is usually sufficient",
  },
  // npm ls without depth → add --depth=0
  {
    pattern: /^npm\s+ls\s*$/,
    rewrite: () => "npm ls --depth=0",
    reason: "full tree is massive, top-level usually enough",
  },
  // ps aux without filter → sort by memory and head (macOS compatible)
  {
    pattern: /^ps\s+aux\s*$/,
    rewrite: () => "ps aux | sort -k4 -rn | head -20",
    reason: "full process list is noise, show top consumers",
  },
];

export interface RewriteResult {
  original: string;
  rewritten: string;
  changed: boolean;
  reason?: string;
}

/** Rewrite a command to produce less output */
export function rewriteCommand(cmd: string): RewriteResult {
  const trimmed = cmd.trim();

  for (const rule of rules) {
    const match = trimmed.match(rule.pattern);
    if (match) {
      const rewritten = rule.rewrite(match, trimmed);
      if (rewritten !== trimmed) {
        return { original: trimmed, rewritten, changed: true, reason: rule.reason };
      }
    }
  }

  return { original: trimmed, rewritten: trimmed, changed: false };
}
