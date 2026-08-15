import { chmodSync } from "node:fs"

const SHEBANG = "#!/usr/bin/env bun\n"
const bins = ["dist/cli/index.js", "dist/mcp/index.js"]

for (const bin of bins) {
  const file = Bun.file(bin)
  let source = await file.text()
  if (!source.startsWith("#!")) {
    source = SHEBANG + source
    await Bun.write(bin, source)
  } else if (!source.startsWith(SHEBANG)) {
    source = SHEBANG + source.slice(source.indexOf("\n") + 1)
    await Bun.write(bin, source)
  }
  chmodSync(bin, 0o755)
}
