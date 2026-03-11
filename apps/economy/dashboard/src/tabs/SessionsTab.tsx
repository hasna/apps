import { useEffect, useState, useCallback } from 'react'
import { getSessions } from '../api'
import type { Session } from '../api'
import { LoadingSpinner, ErrorMessage } from '../components/LoadingSpinner'

const PAGE_SIZE = 50

function truncate(s: string, n: number) {
  if (!s) return ''
  return s.length > n ? s.slice(0, n) + '…' : s
}

function formatUsd(val: number) {
  if (val == null) return '$0.0000'
  return `$${val.toFixed(4)}`
}

function formatDate(d: string) {
  if (!d) return ''
  return new Date(d).toLocaleString()
}

export function SessionsTab() {
  const [sessions, setSessions] = useState<Session[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [search, setSearch] = useState('')
  const [agentFilter, setAgentFilter] = useState('')
  const [page, setPage] = useState(0)

  const load = useCallback(async () => {
    setLoading(true)
    setError(null)
    try {
      const res = await getSessions({
        agent: agentFilter || undefined,
        project: search || undefined,
        limit: PAGE_SIZE,
        offset: page * PAGE_SIZE,
      })
      setSessions(res.data)
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Failed to load sessions')
    } finally {
      setLoading(false)
    }
  }, [agentFilter, search, page])

  useEffect(() => {
    const t = setTimeout(() => load(), 300)
    return () => clearTimeout(t)
  }, [load])

  const handleSearch = (v: string) => {
    setSearch(v)
    setPage(0)
  }

  const handleAgent = (v: string) => {
    setAgentFilter(v)
    setPage(0)
  }

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
      {/* Filters */}
      <div style={{ display: 'flex', gap: 12 }}>
        <input
          type="text"
          placeholder="Search by project..."
          value={search}
          onChange={(e) => handleSearch(e.target.value)}
          style={inputStyle}
        />
        <select
          value={agentFilter}
          onChange={(e) => handleAgent(e.target.value)}
          style={{ ...inputStyle, flex: 'none', width: 160 }}
        >
          <option value="">All agents</option>
          <option value="claude">Claude</option>
          <option value="codex">Codex</option>
        </select>
      </div>

      {/* Table */}
      <div style={tableContainer}>
        {loading ? (
          <LoadingSpinner />
        ) : error ? (
          <ErrorMessage message={error} />
        ) : (
          <table>
            <thead>
              <tr>
                <th>Session ID</th>
                <th>Agent</th>
                <th>Project</th>
                <th>Cost</th>
                <th>Tokens</th>
                <th>Requests</th>
                <th>Started</th>
              </tr>
            </thead>
            <tbody>
              {sessions.length === 0 ? (
                <tr>
                  <td colSpan={7} style={{ textAlign: 'center', color: 'var(--muted-foreground)', padding: '32px 0' }}>
                    No sessions found
                  </td>
                </tr>
              ) : (
                sessions.map((s) => (
                  <tr key={s.session_id}>
                    <td style={{ fontFamily: 'monospace', fontSize: 12, color: 'var(--muted-foreground)' }}>
                      {truncate(s.session_id, 16)}
                    </td>
                    <td>
                      <span style={agentBadge(s.agent)}>{s.agent}</span>
                    </td>
                    <td style={{ maxWidth: 200 }}>{truncate(s.project || s.project_path || '', 30)}</td>
                    <td style={{ color: 'var(--foreground)', fontWeight: 500 }}>{formatUsd(s.cost_usd)}</td>
                    <td style={{ color: 'var(--muted-foreground)' }}>{(s.total_tokens ?? 0).toLocaleString()}</td>
                    <td style={{ color: 'var(--muted-foreground)' }}>{s.requests}</td>
                    <td style={{ color: 'var(--muted-foreground)', fontSize: 12 }}>{formatDate(s.started_at)}</td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
        )}
      </div>

      {/* Pagination */}
      <div style={{ display: 'flex', gap: 12, alignItems: 'center' }}>
        <button
          onClick={() => setPage((p) => Math.max(0, p - 1))}
          disabled={page === 0}
          style={paginationBtn(page === 0)}
        >
          ← Prev
        </button>
        <span style={{ color: 'var(--muted-foreground)', fontSize: 13 }}>Page {page + 1}</span>
        <button
          onClick={() => setPage((p) => p + 1)}
          disabled={sessions.length < PAGE_SIZE}
          style={paginationBtn(sessions.length < PAGE_SIZE)}
        >
          Next →
        </button>
      </div>
    </div>
  )
}

const inputStyle: React.CSSProperties = {
  background: 'var(--card)',
  border: '1px solid var(--border)',
  borderRadius: 'calc(var(--radius) - 2px)',
  padding: '8px 12px',
  color: 'var(--foreground)',
  fontSize: 14,
  outline: 'none',
  flex: 1,
}

const tableContainer: React.CSSProperties = {
  background: 'var(--card)',
  border: '1px solid var(--border)',
  borderRadius: 'var(--radius)',
  overflow: 'auto',
}

function agentBadge(agent: string): React.CSSProperties {
  const colors: Record<string, { bg: string; color: string }> = {
    claude: { bg: '#1e3a5f', color: '#60a5fa' },
    codex: { bg: '#431407', color: '#fb923c' },
  }
  const c = colors[agent] ?? { bg: 'var(--secondary)', color: 'var(--secondary-foreground)' }
  return {
    background: c.bg,
    color: c.color,
    borderRadius: 4,
    padding: '2px 8px',
    fontSize: 12,
    fontWeight: 500,
  }
}

function paginationBtn(disabled: boolean): React.CSSProperties {
  return {
    background: disabled ? 'var(--muted)' : 'var(--card)',
    border: '1px solid var(--border)',
    borderRadius: 'calc(var(--radius) - 2px)',
    padding: '8px 16px',
    color: disabled ? 'var(--muted-foreground)' : 'var(--foreground)',
    cursor: disabled ? 'default' : 'pointer',
    fontSize: 14,
    opacity: disabled ? 0.5 : 1,
  }
}
