/** Respect the dependency's ESM export condition from the actual image root. */
export async function loadImageAuth(root = "/app") {
  return await import(Bun.resolveSync("@hasna/contracts/auth", root));
}
