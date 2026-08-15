export function getServeApiToken(): string | undefined {
  return process.env['ECONOMY_API_TOKEN'] ?? process.env['HASNA_ECONOMY_API_TOKEN']
}

export function getServeBindHost(): string {
  const explicit = process.env['ECONOMY_BIND'] ?? process.env['ECONOMY_HOST']
  if (explicit) return explicit
  return getServeApiToken() ? '127.0.0.1' : '0.0.0.0'
}

export function isAuthorizedRequest(req: Request, path: string): boolean {
  const token = getServeApiToken()
  if (!token) return true
  if (path === '/health') return true

  const auth = req.headers.get('Authorization')
  if (auth === `Bearer ${token}`) return true
  if (req.headers.get('X-Economy-Token') === token) return true
  return false
}
