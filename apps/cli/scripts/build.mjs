import { execFileSync } from 'node:child_process'
import { chmod } from 'node:fs/promises'
import { resolve } from 'node:path'

const root = resolve(new URL('..', import.meta.url).pathname)
execFileSync(process.execPath, [resolve(root, 'node_modules/typescript/bin/tsc'), '-p', 'tsconfig.build.json'], {
  cwd: root,
  stdio: 'inherit',
})
await chmod(resolve(root, 'dist/cli.js'), 0o755)
