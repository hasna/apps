import { type MachineCommandRunner } from "../remote.js";
import type { ClaudeCliDiffResult, ClaudeCliStatusResult, SetupResult } from "../types.js";
declare const AI_CLI_PACKAGES: {
    readonly claude: "@anthropic-ai/claude-code";
    readonly codex: "@openai/codex";
    readonly gemini: "@google/gemini-cli";
};
export type AiCliTool = keyof typeof AI_CLI_PACKAGES;
export declare function buildClaudeInstallPlan(machineId?: string, tools?: string[]): SetupResult;
export declare function getClaudeCliStatus(machineId?: string, tools?: string[], runner?: MachineCommandRunner): ClaudeCliStatusResult;
export declare function diffClaudeCli(machineId?: string, tools?: string[], runner?: MachineCommandRunner): ClaudeCliDiffResult;
export interface RunClaudeInstallOptions {
    apply?: boolean;
    yes?: boolean;
    expectedPlanDigest?: string;
}
export declare function runClaudeInstall(machineId?: string, tools?: string[], options?: RunClaudeInstallOptions, runner?: MachineCommandRunner): SetupResult;
export declare function runClaudeInstallPlan(plan: SetupResult, options?: RunClaudeInstallOptions, runner?: MachineCommandRunner): SetupResult;
export {};
