import { constants } from 'node:fs'
import { chmod, lstat, mkdir, open, rename, rm } from 'node:fs/promises'
import { dirname, join } from 'node:path'
import { randomUUID } from 'node:crypto'
import { CliError, EXIT_CODES } from './errors.js'

const unsafeMode = 0o077

export async function assertSafePrivateFile(path: string): Promise<void> {
  try {
    const stat = await lstat(path)
    if (!stat.isFile() || stat.isSymbolicLink() || stat.nlink !== 1 || (stat.mode & unsafeMode) !== 0 || (process.getuid && stat.uid !== process.getuid()))
      throw new Error('unsafe private file')
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') return
    throw new CliError('LOCAL_FILE_UNSAFE', 'A private CLI state file failed ownership or permission checks', EXIT_CODES.CONFIG, { cause: error })
  }
}

export async function readPrivateFile(path: string, maxBytes = 1_048_576): Promise<string> {
  await assertSafePrivateFile(path)
  const handle = await open(path, constants.O_RDONLY | (constants.O_NOFOLLOW ?? 0))
  try {
    const stat = await handle.stat()
    if (!stat.isFile() || stat.nlink !== 1 || (stat.mode & unsafeMode) !== 0 || (process.getuid && stat.uid !== process.getuid())) throw new Error('unsafe private file')
    if (stat.size > maxBytes) throw new CliError('LOCAL_FILE_TOO_LARGE', 'A private CLI state file exceeded its safety limit', EXIT_CODES.CONFIG)
    return await handle.readFile('utf8')
  } finally {
    await handle.close()
  }
}

export async function atomicWritePrivateFile(path: string, contents: string, options: { requirePrivateParent?: boolean } = {}): Promise<void> {
  const directory = dirname(path)
  await mkdir(directory, { recursive: true, mode: 0o700 })
  const parent = await lstat(directory)
  if (!parent.isDirectory() || parent.isSymbolicLink() || (options.requirePrivateParent !== false && ((parent.mode & unsafeMode) !== 0 || (process.getuid && parent.uid !== process.getuid()))))
    throw new CliError('LOCAL_DIRECTORY_UNSAFE', 'The CLI state directory failed ownership or permission checks', EXIT_CODES.CONFIG)
  await assertSafePrivateFile(path)
  const lock = join(directory, `.${path.split('/').at(-1)}.lock`)
  let lockHandle
  try {
    lockHandle = await open(lock, constants.O_CREAT | constants.O_EXCL | constants.O_WRONLY | (constants.O_NOFOLLOW ?? 0), 0o600)
  } catch (error) {
    throw new CliError('CONFIG_BUSY', 'Another CLI process is updating local state', EXIT_CODES.CONFIG, { cause: error })
  }
  const temporary = join(directory, `.${path.split('/').at(-1)}.${randomUUID()}.tmp`)
  try {
    const handle = await open(temporary, constants.O_CREAT | constants.O_EXCL | constants.O_WRONLY | (constants.O_NOFOLLOW ?? 0), 0o600)
    try {
      await handle.writeFile(contents)
      await handle.sync()
    } finally {
      await handle.close()
    }
    await chmod(temporary, 0o600)
    await rename(temporary, path)
    const directoryHandle = await open(directory, constants.O_RDONLY)
    try { await directoryHandle.sync() } finally { await directoryHandle.close() }
  } finally {
    await rm(temporary, { force: true })
    await lockHandle.close()
    await rm(lock, { force: true })
  }
}
