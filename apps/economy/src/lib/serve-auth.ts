export function getServeApiToken(): string | undefined {
  const token = process.env['ECONOMY_API_TOKEN']?.trim() || process.env['HASNA_ECONOMY_API_TOKEN']?.trim()
  return token || undefined
}

export function requireServeApiToken(): string {
  const token = getServeApiToken()
  if (!token) {
    throw new Error('ECONOMY_API_TOKEN or HASNA_ECONOMY_API_TOKEN is required to start economy-serve')
  }
  return token
}

export function getServeBindHost(): string {
  const explicit = process.env['ECONOMY_BIND']?.trim() || process.env['ECONOMY_HOST']?.trim()
  if (explicit) return explicit
  return '127.0.0.1'
}

export function isAuthorizedRequest(req: Request, path: string): boolean {
  if (path === '/health') return true

  const token = getServeApiToken()
  if (!token) return false

  const auth = req.headers.get('Authorization')
  if (auth === `Bearer ${token}`) return true
  if (req.headers.get('X-Economy-Token') === token) return true
  return false
}
