import { useEffect, useState } from 'react'
import { getProjects } from '../api'
import type { ProjectStat } from '../api'
import { LoadingSpinner, ErrorMessage } from '../components/LoadingSpinner'

function truncate(s: string, n: number) {
  if (!s) return ''
  return s.length > n ? '…' + s.slice(-n) : s
}

function formatUsd(val: number) {
  return `$${(val ?? 0).toFixed(4)}`
}

function formatDate(d: string) {
  if (!d) return ''
  return new Date(d).toLocaleDateString()
}

export function ProjectsTab() {
  const [projects, setProjects] = useState<ProjectStat[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)

  const load = () => {
    setLoading(true)
    getProjects()
      .then((r) => {
        const sorted = [...r.data].sort((a, b) => b.cost_usd - a.cost_usd)
        setProjects(sorted)
      })
      .catch((e) => setError(e instanceof Error ? e.message : 'Failed to load'))
      .finally(() => setLoading(false))
  }

  useEffect(() => {
    load()
  }, [])

  if (loading) return <LoadingSpinner />
  if (error) return <ErrorMessage message={error} />

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
      <div
        style={{
          background: 'var(--card)',
          border: '1px solid var(--border)',
          borderRadius: 'var(--radius)',
          overflow: 'auto',
        }}
      >
        <table>
          <thead>
            <tr>
              <th>Project Name</th>
              <th>Path</th>
              <th>Sessions</th>
              <th>Cost</th>
              <th>Last Active</th>
            </tr>
          </thead>
          <tbody>
            {projects.length === 0 ? (
              <tr>
                <td colSpan={5} style={{ textAlign: 'center', color: 'var(--muted-foreground)', padding: '32px 0' }}>
                  No projects found
                </td>
              </tr>
            ) : (
              projects.map((p, i) => (
                <tr key={i}>
                  <td style={{ fontWeight: 500, color: 'var(--foreground)' }}>
                    {p.project_name || '—'}
                  </td>
                  <td
                    style={{
                      fontFamily: 'monospace',
                      fontSize: 12,
                      color: 'var(--muted-foreground)',
                      maxWidth: 280,
                    }}
                    title={p.project_path}
                  >
                    {truncate(p.project_path, 40)}
                  </td>
                  <td style={{ color: 'var(--muted-foreground)' }}>{p.sessions}</td>
                  <td style={{ color: 'var(--foreground)', fontWeight: 600 }}>{formatUsd(p.cost_usd)}</td>
                  <td style={{ color: 'var(--muted-foreground)', fontSize: 13 }}>{formatDate(p.last_active)}</td>
                </tr>
              ))
            )}
          </tbody>
        </table>
      </div>
    </div>
  )
}
