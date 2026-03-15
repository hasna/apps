// Base types for output parsers

export interface Parser<T = unknown> {
  /** Name of this parser */
  readonly name: string;

  /** Test if this parser can handle the given command/output */
  detect(command: string, output: string): boolean;

  /** Parse the output into structured data */
  parse(command: string, output: string): T;
}

export interface FileEntry {
  name: string;
  type: "file" | "dir" | "symlink" | "other";
  size?: number;
  modified?: string;
  permissions?: string;
}

export interface TestResult {
  passed: number;
  failed: number;
  skipped: number;
  total: number;
  duration?: string;
  failures: { test: string; error: string }[];
}

export interface GitLogEntry {
  hash: string;
  author: string;
  date: string;
  message: string;
}

export interface GitStatus {
  branch: string;
  staged: string[];
  unstaged: string[];
  untracked: string[];
}

export interface BuildResult {
  status: "success" | "failure";
  warnings: number;
  errors: number;
  duration?: string;
  output?: string;
}

export interface NpmInstallResult {
  installed: number;
  duration?: string;
  vulnerabilities: number;
}

export interface ErrorInfo {
  type: string;
  message: string;
  file?: string;
  line?: number;
  suggestion?: string;
}

export interface SearchResult {
  total: number;
  source: FileEntry[];
  other: FileEntry[];
  filtered: { count: number; reason: string }[];
}
