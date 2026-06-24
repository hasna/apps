import { normalize, relative, resolve } from "node:path";

export function resolveDashboardFile(dashboardDir: string, pathname: string): string | null {
  if (!pathname.startsWith("/dashboard/")) return null;
  const decoded = safeDecode(pathname);
  if (!decoded || decoded.includes("\0")) return null;
  const relativePath = normalize(decoded.replace(/^\/dashboard\/+/, ""));
  if (!relativePath || relativePath === "." || relativePath.startsWith("..")) return null;

  const root = resolve(dashboardDir);
  const candidate = resolve(root, relativePath);
  const rel = relative(root, candidate);
  if (rel.startsWith("..") || rel === "" || rel.includes("..")) return null;
  return candidate;
}

function safeDecode(pathname: string): string | null {
  try {
    return decodeURIComponent(pathname);
  } catch {
    return null;
  }
}
