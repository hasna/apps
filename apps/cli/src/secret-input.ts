import { CliError, EXIT_CODES } from './errors.js'

export async function readStdinLine(input: NodeJS.ReadableStream = process.stdin): Promise<string> {
  let value = ''
  for await (const chunk of input) {
    value += String(chunk)
    if (value.length > 1_048_576)
      throw new CliError('INPUT_TOO_LARGE', 'Standard input exceeds 1 MiB', EXIT_CODES.VALIDATION)
  }
  const line = value.replace(/\r?\n$/, '')
  if (!line) throw new CliError('SECRET_REQUIRED', 'A secret value is required', EXIT_CODES.AUTH)
  return line
}

export async function readHiddenSecret(
  prompt: string,
  input: NodeJS.ReadStream = process.stdin,
  output: NodeJS.WriteStream = process.stderr,
): Promise<string> {
  if (!input.isTTY || typeof input.setRawMode !== 'function')
    throw new CliError(
      'TTY_REQUIRED',
      'A TTY is required; use the command-specific --*-stdin option',
      EXIT_CODES.USAGE,
    )
  output.write(prompt)
  input.setRawMode(true)
  input.resume()
  return new Promise((resolve, reject) => {
    let value = ''
    let done = false
    const cleanup = () => {
      input.off('data', onData)
      input.setRawMode(false)
      input.pause()
      output.write('\n')
    }
    const onData = (chunk: Buffer) => {
      for (const character of chunk.toString('utf8')) {
        if (done) return
        if (character === '\u0003' || character === '\u0004') {
          done = true
          cleanup()
          reject(new CliError('CANCELLED', 'Input cancelled', EXIT_CODES.CANCELLED))
        } else if (character === '\r' || character === '\n') {
          done = true
          cleanup()
          if (!value) reject(new CliError('SECRET_REQUIRED', 'A secret is required', EXIT_CODES.AUTH))
          else resolve(value)
        } else if (character === '\u007f' || character === '\b') value = value.slice(0, -1)
        else {
          value += character
          if (value.length > 1_048_576) {
            done = true
            cleanup()
            reject(new CliError('INPUT_TOO_LARGE', 'Secret input exceeds 1 MiB', EXIT_CODES.USAGE))
          }
        }
      }
    }
    input.on('data', onData)
  })
}
