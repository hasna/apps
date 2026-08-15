import packageJson from "../../package.json";

export function getPackageVersion(_fromUrl = import.meta.url): string {
  return packageJson.version || "0.0.0";
}
