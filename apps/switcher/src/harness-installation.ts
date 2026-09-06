import type { HarnessId } from "./harness-types";

/**
 * Native installation facts used by doctor and missing-executable errors.
 *
 * These records deliberately distinguish a verified package from a project
 * distribution.  A project entry has no guessed npm command: the operator is
 * sent to the upstream installation instructions and can pass the resulting
 * executable with --executable.
 */
export type HarnessInstallation = {
  displayName: string;
  executable: string;
  versionRequirement: string;
  packageOrProject: string;
  documentationUrl: string;
  installationGuidance: string;
};

const records: Record<HarnessId, HarnessInstallation> = {
  claude: {
    displayName: "Claude Code",
    executable: "claude",
    versionRequirement: ">=2.1.242",
    packageOrProject: "Claude Code official distribution",
    documentationUrl: "https://code.claude.com/docs/en/quickstart",
    installationGuidance: "follow the official Claude Code installation instructions, then ensure the claude executable is on PATH or pass its absolute path with --executable",
  },
  codex: {
    displayName: "Codex CLI",
    executable: "codex",
    versionRequirement: ">=0.153.0",
    packageOrProject: "OpenAI Codex official distribution",
    documentationUrl: "https://github.com/openai/codex",
    installationGuidance: "follow the official Codex CLI installation instructions, then ensure the codex executable is on PATH or pass its absolute path with --executable",
  },
  grok: {
    displayName: "Grok Build",
    executable: "grok",
    versionRequirement: ">=1.0.13",
    packageOrProject: "xAI Grok Build official project",
    documentationUrl: "https://github.com/xai-org/grok-build",
    installationGuidance: "install a released Grok Build executable using the upstream project instructions, then ensure grok is on PATH or pass its absolute path with --executable",
  },
  opencode: {
    displayName: "OpenCode (legacy)",
    executable: "opencode",
    versionRequirement: ">=1.18.0",
    packageOrProject: "opencode-ai",
    documentationUrl: "https://github.com/anomalyco/opencode/blob/dev/packages/web/src/content/docs/cli.mdx",
    installationGuidance: "install the official opencode-ai release at a compatible version, then ensure opencode is on PATH or pass its absolute path with --executable",
  },
  opencode2: {
    displayName: "OpenCode 2",
    executable: "opencode2",
    versionRequirement: "beta-19157 or newer (including stable >=2.0.0)",
    packageOrProject: "OpenCode 2 official distribution",
    documentationUrl: "https://opencode.ai/v2/docs/",
    installationGuidance: "follow the OpenCode 2 distribution instructions for the opencode2 executable, then ensure it is on PATH or pass its absolute path with --executable",
  },
  pi: {
    displayName: "Pi Coding Agent",
    executable: "pi",
    versionRequirement: ">=0.85.1",
    packageOrProject: "@earendil-works/pi-coding-agent",
    documentationUrl: "https://github.com/earendil-works/pi/blob/main/packages/coding-agent/README.md",
    installationGuidance: "install @earendil-works/pi-coding-agent at a compatible version, then ensure pi is on PATH or pass its absolute path with --executable",
  },
  omp: {
    displayName: "OMP (oh-my-pi)",
    executable: "omp",
    versionRequirement: ">=18.1.11",
    packageOrProject: "@oh-my-pi/pi-coding-agent",
    documentationUrl: "https://github.com/can1357/oh-my-pi",
    installationGuidance: "install the official @oh-my-pi/pi-coding-agent package at a compatible version, then ensure omp is on PATH or pass its absolute path with --executable",
  },
  dsh: {
    displayName: "DeepSeek Harness",
    executable: "dsh",
    versionRequirement: ">=0.1.2-rc.1",
    packageOrProject: "@deepseek-ai/dsh",
    documentationUrl: "https://github.com/deepseek-ai/deepseek-harness/blob/master/apps/cli/reference/README.md",
    installationGuidance: "install the official @deepseek-ai/dsh package at a compatible version, then ensure dsh is on PATH or pass its absolute path with --executable",
  },
  cline: {
    displayName: "Cline",
    executable: "cline",
    versionRequirement: ">=3.0.61",
    packageOrProject: "cline",
    documentationUrl: "https://github.com/cline/cline/tree/main/apps/cli",
    installationGuidance: "install the official cline CLI at a compatible version, then ensure cline is on PATH or pass its absolute path with --executable",
  },
  hermes: {
    displayName: "Hermes Agent",
    executable: "hermes",
    versionRequirement: ">=0.21.0",
    packageOrProject: "NousResearch Hermes Agent",
    documentationUrl: "https://github.com/NousResearch/hermes-agent#quick-install",
    installationGuidance: "use the official Hermes Agent installer documented upstream, then ensure hermes is on PATH or pass its absolute path with --executable",
  },
  "prime-agent": {
    displayName: "Prime Agent",
    executable: "prime-agent",
    versionRequirement: ">=0.9.2",
    packageOrProject: "PrimeIntellect Prime Agent",
    documentationUrl: "https://github.com/PrimeIntellect-ai/prime-agent",
    installationGuidance: "install a versioned Prime Agent release using the upstream installer or release artifact, then ensure prime-agent is on PATH or pass its absolute path with --executable",
  },
  gemini: {
    displayName: "Gemini CLI",
    executable: "gemini",
    versionRequirement: "exactly 0.58.0",
    packageOrProject: "@google/gemini-cli",
    documentationUrl: "https://github.com/google-gemini/gemini-cli",
    installationGuidance: "install @google/gemini-cli exactly at version 0.58.0, then ensure gemini is on PATH or pass its absolute path with --executable",
  },
  aider: {
    displayName: "Aider",
    executable: "aider",
    versionRequirement: "exactly 0.86.2",
    packageOrProject: "aider-chat",
    documentationUrl: "https://aider.chat/docs/install.html",
    installationGuidance: "install aider-chat exactly at version 0.86.2 using the official Aider installation instructions, then ensure aider is on PATH or pass its absolute path with --executable",
  },
  kilo: {
    displayName: "Kilo Code",
    executable: "kilo",
    versionRequirement: ">=7.5.15",
    packageOrProject: "@kilocode/cli",
    documentationUrl: "https://github.com/Kilo-Org/kilocode/releases/tag/v7.5.15",
    installationGuidance: "install @kilocode/cli at a compatible version from the official Kilo Code distribution, then ensure kilo is on PATH or pass its absolute path with --executable",
  },
};

export function harnessInstallation(harness: HarnessId): HarnessInstallation {
  return records[harness];
}

export function harnessInstallationMessage(harness: HarnessId, executable: string, explicitOverride: boolean): string {
  const metadata = harnessInstallation(harness);
  const prefix = explicitOverride
    ? `Configured executable ${executable} could not report a usable ${metadata.displayName} version.`
    : `${metadata.displayName} (${metadata.executable}) is not installed or could not report a usable version.`;
  const retry = explicitOverride
    ? "Pass a different trusted absolute path with --executable after installing it."
    : "Install it, then retry, or pass a trusted absolute path with --executable.";
  return `${prefix} The adapter requires ${metadata.versionRequirement}. ${metadata.installationGuidance}. See ${metadata.documentationUrl}. ${retry}`;
}
