// Parser for common error patterns

import type { Parser, ErrorInfo } from "./base.js";

const ERROR_PATTERNS: { type: string; pattern: RegExp; extract: (m: RegExpMatchArray, output: string) => ErrorInfo }[] = [
  {
    type: "port_in_use",
    pattern: /EADDRINUSE.*?(?::(\d+))|port\s+(\d+)\s+(?:is\s+)?(?:already\s+)?in\s+use/i,
    extract: (m) => ({
      type: "port_in_use",
      message: m[0],
      suggestion: `Kill the process: lsof -i :${m[1] ?? m[2]} -t | xargs kill`,
    }),
  },
  {
    type: "file_not_found",
    pattern: /ENOENT.*?'([^']+)'|No such file or directory:\s*(.+)/,
    extract: (m) => ({
      type: "file_not_found",
      message: m[0],
      file: m[1] ?? m[2]?.trim(),
      suggestion: "Check the file path exists",
    }),
  },
  {
    type: "permission_denied",
    pattern: /EACCES.*?'([^']+)'|Permission denied:\s*(.+)/,
    extract: (m) => ({
      type: "permission_denied",
      message: m[0],
      file: m[1] ?? m[2]?.trim(),
      suggestion: "Check file permissions or run with sudo",
    }),
  },
  {
    type: "command_not_found",
    pattern: /command not found:\s*(\S+)|(\S+):\s*not found/,
    extract: (m) => ({
      type: "command_not_found",
      message: m[0],
      suggestion: `Install ${m[1] ?? m[2]} or check your PATH`,
    }),
  },
  {
    type: "dependency_missing",
    pattern: /Cannot find module\s+'([^']+)'|Module not found.*?'([^']+)'/,
    extract: (m) => ({
      type: "dependency_missing",
      message: m[0],
      suggestion: `Install: npm install ${m[1] ?? m[2]}`,
    }),
  },
  {
    type: "syntax_error",
    pattern: /SyntaxError:\s*(.+)|error TS\d+:\s*(.+)/,
    extract: (m, output) => {
      const fileMatch = output.match(/(\S+\.\w+):(\d+)/);
      return {
        type: "syntax_error",
        message: m[1] ?? m[2] ?? m[0],
        file: fileMatch?.[1],
        line: fileMatch ? parseInt(fileMatch[2]) : undefined,
        suggestion: "Fix the syntax error in the referenced file",
      };
    },
  },
  {
    type: "out_of_memory",
    pattern: /ENOMEM|JavaScript heap out of memory|Killed/,
    extract: (m) => ({
      type: "out_of_memory",
      message: m[0],
      suggestion: "Increase memory: NODE_OPTIONS=--max-old-space-size=4096",
    }),
  },
  {
    type: "network_error",
    pattern: /ECONNREFUSED|ENOTFOUND|ETIMEDOUT|fetch failed/,
    extract: (m) => ({
      type: "network_error",
      message: m[0],
      suggestion: "Check network connection and target URL/host",
    }),
  },
];

export const errorParser: Parser<ErrorInfo> = {
  name: "error",

  detect(_command: string, output: string): boolean {
    return ERROR_PATTERNS.some(({ pattern }) => pattern.test(output));
  },

  parse(_command: string, output: string): ErrorInfo {
    for (const { pattern, extract } of ERROR_PATTERNS) {
      const match = output.match(pattern);
      if (match) return extract(match, output);
    }

    // Generic error fallback
    const errorLine = output.split("\n").find(l => /error/i.test(l));
    return {
      type: "unknown",
      message: errorLine?.trim() ?? "Unknown error",
    };
  },
};
