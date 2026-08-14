import pkg from "../../package.json" with { type: "json" };

export function packageVersion(): string {
  if (typeof pkg.version !== "string" || pkg.version.trim() === "") throw new Error("package.json version is missing");
  return pkg.version;
}
