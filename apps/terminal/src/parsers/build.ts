// Parser for build output (npm/bun/pnpm build, tsc, webpack, vite, etc.)

import type { Parser, BuildResult, NpmInstallResult } from "./base.js";

export const buildParser: Parser<BuildResult> = {
  name: "build",

  detect(command: string, output: string): boolean {
    if (/\b(npm|bun|pnpm|yarn)\s+(run\s+)?build\b/.test(command)) return true;
    if (/\btsc\b/.test(command)) return true;
    if (/\b(webpack|vite|esbuild|rollup|turbo)\b/.test(command)) return true;
    return /\b(compiled|bundled|built)\b/i.test(output) && /\b(success|error|warning)\b/i.test(output);
  },

  parse(_command: string, output: string): BuildResult {
    const lines = output.split("\n");
    let warnings = 0, errors = 0, duration: string | undefined;

    // Count warnings and errors
    for (const line of lines) {
      if (/\bwarning\b/i.test(line)) warnings++;
      if (/\berror\b/i.test(line) && !/0 errors/.test(line)) errors++;
    }

    // Specific patterns
    const tscErrors = output.match(/Found (\d+) error/);
    if (tscErrors) errors = parseInt(tscErrors[1]);

    const warningCount = output.match(/(\d+)\s+warning/);
    if (warningCount) warnings = parseInt(warningCount[1]);

    // Duration
    const timeMatch = output.match(/(?:in|took)\s+([\d.]+\s*(?:s|ms|m))/i) ||
      output.match(/Done in ([\d.]+s)/);
    if (timeMatch) duration = timeMatch[1];

    const status: "success" | "failure" = errors > 0 ? "failure" : "success";

    return { status, warnings, errors, duration };
  },
};

export const npmInstallParser: Parser<NpmInstallResult> = {
  name: "npm-install",

  detect(command: string, _output: string): boolean {
    return /\b(npm|bun|pnpm|yarn)\s+(install|add|i)\b/.test(command);
  },

  parse(_command: string, output: string): NpmInstallResult {
    let installed = 0, vulnerabilities = 0, duration: string | undefined;

    // npm: added 47 packages in 3.2s
    const npmMatch = output.match(/added\s+(\d+)\s+packages?\s+in\s+([\d.]+s)/);
    if (npmMatch) {
      installed = parseInt(npmMatch[1]);
      duration = npmMatch[2];
    }

    // bun: 47 packages installed [1.2s]
    const bunMatch = output.match(/(\d+)\s+packages?\s+installed.*?\[([\d.]+[ms]*s)\]/);
    if (!npmMatch && bunMatch) {
      installed = parseInt(bunMatch[1]);
      duration = bunMatch[2];
    }

    // Vulnerabilities
    const vulnMatch = output.match(/(\d+)\s+vulnerabilit/);
    if (vulnMatch) vulnerabilities = parseInt(vulnMatch[1]);

    return { installed, vulnerabilities, duration };
  },
};
