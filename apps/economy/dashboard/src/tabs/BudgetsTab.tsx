import { useEffect, useState } from 'react'
import type { FormEvent } from 'react'
import { getBudgets, createBudget, deleteBudget } from '../api'
import type { Budget } from '../api'
import { LoadingSpinner, ErrorMessage } from '../components/LoadingSpinner'

function ProgressBar({ percent, isOver }: { percent: number; isOver: boolean }) {
  const clamped = Math.min(100, percent)
  const color = isOver || percent > 90 ? '#ef4444' : percent > 60 ? '#eab308' : '#22c55e'
  return (
    <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
      <div
        style={{
          flex: 1,
          height: 8,
          background: '#2a2a2a',
          borderRadius: 4,
          overflow: 'hidden',
        }}
      >
        <div
          style={{
            width: `${clamped}%`,
            height: '100%',
            background: color,
            borderRadius: 4,
            transition: 'width 0.3s',
          }}
        />
      </div>
      <span style={{ color, fontSize: 13, fontWeight: 600, minWidth: 44, textAlign: 'right' }}>
        {percent.toFixed(1)}%
      </span>
    </div>
  )
}

export function BudgetsTab() {
  const [budgets, setBudgets] = useState<Budget[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)

  // Form state
  const [projectPath, setProjectPath] = useState('')
  const [period, setPeriod] = useState('month')
  const [limitUsd, setLimitUsd] = useState('')
  const [alertAt, setAlertAt] = useState('80')
  const [saving, setSaving] = useState(false)
  const [formError, setFormError] = useState<string | null>(null)

  const load = () => {
    setLoading(true)
    getBudgets()
      .then((r) => setBudgets(r.data))
      .catch((e) => setError(e instanceof Error ? e.message : 'Failed to load'))
      .finally(() => setLoading(false))
  }

  useEffect(() => {
    load()
  }, [])

  const handleDelete = async (id: number) => {
    try {
      await deleteBudget(id)
      load()
    } catch (e) {
      alert(e instanceof Error ? e.message : 'Delete failed')
    }
  }

  const handleAdd = async (e: FormEvent) => {
    e.preventDefault()
    if (!limitUsd || isNaN(Number(limitUsd))) {
      setFormError('Enter a valid limit amount')
      return
    }
    setSaving(true)
    setFormError(null)
    try {
      await createBudget({
        project_path: projectPath || undefined,
        period,
        limit_usd: Number(limitUsd),
        alert_at_percent: Number(alertAt),
      })
      setProjectPath('')
      setLimitUsd('')
      load()
    } catch (e) {
      setFormError(e instanceof Error ? e.message : 'Failed to create budget')
    } finally {
      setSaving(false)
    }
  }

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 24 }}>
      {/* Budget list */}
      <div
        style={{
          background: '#1a1a1a',
          border: '1px solid #2a2a2a',
          borderRadius: 10,
          overflow: 'hidden',
        }}
      >
        <div style={{ padding: '16px 20px', borderBottom: '1px solid #2a2a2a' }}>
          <span style={{ fontWeight: 600, color: '#e5e7eb' }}>Active Budgets</span>
        </div>
        {loading ? (
          <LoadingSpinner />
        ) : error ? (
          <div style={{ padding: 16 }}>
            <ErrorMessage message={error} />
          </div>
        ) : budgets.length === 0 ? (
          <div style={{ padding: '32px', textAlign: 'center', color: '#6b7280' }}>
            No budgets configured
          </div>
        ) : (
          <div>
            {budgets.map((b) => (
              <div
                key={b.id}
                style={{
                  padding: '16px 20px',
                  borderBottom: '1px solid #222',
                  display: 'flex',
                  gap: 16,
                  alignItems: 'center',
                }}
              >
                <div style={{ flex: 1, minWidth: 0 }}>
                  <div style={{ display: 'flex', gap: 12, alignItems: 'baseline', marginBottom: 8 }}>
                    <span style={{ fontWeight: 500, color: '#f9fafb' }}>
                      {b.project_path || 'Global'}
                    </span>
                    <span
                      style={{
                        background: '#1e3a5f',
                        color: '#60a5fa',
                        borderRadius: 4,
                        padding: '1px 8px',
                        fontSize: 11,
                        fontWeight: 500,
                        textTransform: 'uppercase',
                      }}
                    >
                      {b.period}
                    </span>
                  </div>
                  <ProgressBar percent={b.percent_used} isOver={b.is_over_alert} />
                  <div style={{ color: '#6b7280', fontSize: 12, marginTop: 6 }}>
                    ${b.current_spend_usd.toFixed(4)} / ${b.limit_usd.toFixed(2)} limit
                  </div>
                </div>
                <button
                  onClick={() => handleDelete(b.id)}
                  style={{
                    background: '#2d1414',
                    border: '1px solid #7f1d1d',
                    borderRadius: 6,
                    color: '#fca5a5',
                    padding: '6px 12px',
                    fontSize: 13,
                    cursor: 'pointer',
                    whiteSpace: 'nowrap',
                  }}
                >
                  Delete
                </button>
              </div>
            ))}
          </div>
        )}
      </div>

      {/* Add budget form */}
      <div
        style={{
          background: '#1a1a1a',
          border: '1px solid #2a2a2a',
          borderRadius: 10,
          padding: '20px',
        }}
      >
        <div style={{ fontWeight: 600, color: '#e5e7eb', marginBottom: 16 }}>Add Budget</div>
        <form onSubmit={handleAdd} style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
          <div style={{ display: 'flex', gap: 12, flexWrap: 'wrap' }}>
            <div style={{ flex: 2, minWidth: 200 }}>
              <label style={labelStyle}>Project Path (optional)</label>
              <input
                type="text"
                placeholder="Leave blank for global budget"
                value={projectPath}
                onChange={(e) => setProjectPath(e.target.value)}
                style={inputStyle}
              />
            </div>
            <div style={{ flex: 1, minWidth: 120 }}>
              <label style={labelStyle}>Period</label>
              <select
                value={period}
                onChange={(e) => setPeriod(e.target.value)}
                style={inputStyle}
              >
                <option value="day">Day</option>
                <option value="week">Week</option>
                <option value="month">Month</option>
              </select>
            </div>
            <div style={{ flex: 1, minWidth: 120 }}>
              <label style={labelStyle}>Limit (USD)</label>
              <input
                type="number"
                step="0.01"
                min="0"
                placeholder="10.00"
                value={limitUsd}
                onChange={(e) => setLimitUsd(e.target.value)}
                style={inputStyle}
                required
              />
            </div>
            <div style={{ flex: 1, minWidth: 120 }}>
              <label style={labelStyle}>Alert at %</label>
              <input
                type="number"
                step="1"
                min="1"
                max="100"
                value={alertAt}
                onChange={(e) => setAlertAt(e.target.value)}
                style={inputStyle}
              />
            </div>
          </div>
          {formError && <ErrorMessage message={formError} />}
          <div>
            <button
              type="submit"
              disabled={saving}
              style={{
                background: saving ? '#1e3a5f' : '#1d4ed8',
                color: '#fff',
                border: 'none',
                borderRadius: 8,
                padding: '10px 24px',
                fontSize: 14,
                fontWeight: 600,
                cursor: saving ? 'default' : 'pointer',
                opacity: saving ? 0.7 : 1,
              }}
            >
              {saving ? 'Adding...' : 'Add Budget'}
            </button>
          </div>
        </form>
      </div>
    </div>
  )
}

const labelStyle: React.CSSProperties = {
  display: 'block',
  fontSize: 12,
  color: '#9ca3af',
  marginBottom: 6,
  fontWeight: 500,
}

const inputStyle: React.CSSProperties = {
  width: '100%',
  background: '#111',
  border: '1px solid #2a2a2a',
  borderRadius: 8,
  padding: '8px 12px',
  color: '#e5e7eb',
  fontSize: 14,
  outline: 'none',
}
