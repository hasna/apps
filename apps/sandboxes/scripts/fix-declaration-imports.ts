import { join } from "node:path"

const declarationsRoot = new URL("../dist/adapters/managed/", import.meta.url).pathname
const declarations = new Bun.Glob("**/*.d.ts")

for await (const relativePath of declarations.scan({ cwd: declarationsRoot })) {
  const path = join(declarationsRoot, relativePath)
  const source = await Bun.file(path).text()
  const fixed = source.replace(
    /(["'])(\.{1,2}\/[^"']+)(["'])/gu,
    (_match, open: string, specifier: string, close: string) =>
      /\.(?:c|m)?js$/u.test(specifier)
        ? `${open}${specifier}${close}`
        : `${open}${specifier}.js${close}`,
  )
  if (fixed !== source) await Bun.write(path, fixed)
}
