import { getPackageVersion } from "./package-info.js";

export interface MetadataArgsOptions {
  command: string;
  description: string;
  usage: string;
  options?: string[];
}

export function getMetadataResponse(args: string[], options: MetadataArgsOptions): string | undefined {
  if (args.includes("--version") || args.includes("-V")) {
    return getPackageVersion();
  }
  if (!args.includes("--help") && !args.includes("-h")) {
    return undefined;
  }

  const optionLines = [
    "  -V, --version  Print package version",
    "  -h, --help     Print this help",
    ...(options.options ?? []),
  ];

  return [
    `Usage: ${options.usage}`,
    "",
    options.description,
    "",
    "Options:",
    ...optionLines,
  ].join("\n");
}

export function handleMetadataArgs(args: string[], options: MetadataArgsOptions): boolean {
  const response = getMetadataResponse(args, options);
  if (response === undefined) return false;
  console.log(response);
  return true;
}
