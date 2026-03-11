import { useEffect, useState } from 'react'
import { getModels } from '../api'
import type { ModelStat } from '../api'
import { LoadingSpinner, ErrorMessage } from '../components/LoadingSpinner'

function formatUsd(val: number) {
  return `$${(val ?? 0).toFixed(4)}`
}

export function ModelsTab() {
  const [models, setModels] = useState<ModelStat[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    getModels()
      .then((r) => {
        const sorted = [...r.data].sort((a, b) => b.cost_usd - a.cost_usd)
        setModels(sorted)
      })
      .catch((e) => setError(e instanceof Error ? e.message : 'Failed to load'))
      .finally(() => setLoading(false))
  }, [])

  if (loading) return <LoadingSpinner />
  if (error) return <ErrorMessage message={error} />

  return (
    <div
      style={{
        background: '#1a1a1a',
        border: '1px solid #2a2a2a',
        borderRadius: 10,
        overflow: 'auto',
      }}
    >
      <table>
        <thead>
          <tr>
            <th>Model</th>
            <th>Agent</th>
            <th>Requests</th>
            <th>Tokens</th>
            <th>Cost</th>
          </tr>
        </thead>
        <tbody>
          {models.length === 0 ? (
            <tr>
              <td colSpan={5} style={{ textAlign: 'center', color: '#6b7280', padding: '32px 0' }}>
                No model data
              </td>
            </tr>
          ) : (
            models.map((m, i) => (
              <tr key={`${m.model}-${m.agent}-${i}`}>
                <td style={{ fontFamily: 'monospace', fontSize: 13 }}>{m.model}</td>
                <td>
                  <span style={agentBadge(m.agent)}>{m.agent}</span>
                </td>
                <td style={{ color: '#9ca3af' }}>{(m.requests ?? 0).toLocaleString()}</td>
                <td style={{ color: '#9ca3af' }}>{(m.total_tokens ?? 0).toLocaleString()}</td>
                <td style={{ color: '#f9fafb', fontWeight: 600 }}>{formatUsd(m.cost_usd)}</td>
              </tr>
            ))
          )}
        </tbody>
      </table>
    </div>
  )
}

function agentBadge(agent: string): React.CSSProperties {
  const colors: Record<string, { bg: string; color: string }> = {
    claude: { bg: '#1e3a5f', color: '#60a5fa' },
    codex: { bg: '#431407', color: '#fb923c' },
  }
  const c = colors[agent] ?? { bg: '#1a1a1a', color: '#9ca3af' }
  return {
    background: c.bg,
    color: c.color,
    borderRadius: 4,
    padding: '2px 8px',
    fontSize: 12,
    fontWeight: 500,
  }
}
