import { fileURLToPath } from "node:url";

/**
 * Resolve a local-only runtime without giving Bun a static module specifier to
 * fold into a public bootstrap. Source execution loads the sibling TypeScript
 * module. Package builds place every local runtime under dist/storage, which
 * also works when the guarded wrapper was bundled into a CLI/server/MCP file.
 */
export function resolveTodosStorageRuntimeModulePath(
  callerUrl: string,
  runtimeName: string,
): string {
  const caller = new URL(callerUrl);
  if (caller.pathname.endsWith(".ts") || caller.pathname.endsWith(".tsx")) {
    return fileURLToPath(new URL(`./${runtimeName}.ts`, caller));
  }

  let directory = new URL(".", caller);
  while (directory.pathname !== "/") {
    if (directory.pathname.endsWith("/dist/")) {
      return fileURLToPath(new URL(`storage/${runtimeName}.js`, directory));
    }
    const parent = new URL("../", directory);
    if (parent.pathname === directory.pathname) break;
    directory = parent;
  }

  // Install-free test builds use an arbitrary output root instead of a
  // directory named dist. Their runtime files live beside the public output in
  // a storage subdirectory.
  if (new URL(".", caller).pathname.endsWith("/storage/")) {
    return fileURLToPath(new URL(`./${runtimeName}.js`, caller));
  }
  return fileURLToPath(new URL(`./storage/${runtimeName}.js`, caller));
}
