import { useEffect, useState } from 'react'
import type { FormEvent } from 'react'
import { getPricing, createPricing, deletePricing } from '../api'
import type { Pricing } from '../api'
import { LoadingSpinner, ErrorMessage } from '../components/LoadingSpinner'

export function PricingTab() {
  const [pricing, setPricing] = useState<Pricing[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)

  // Form state
  const [model, setModel] = useState('')
  const [inputPer1m, setInputPer1m] = useState('')
  const [outputPer1m, setOutputPer1m] = useState('')
  const [cacheReadPer1m, setCacheReadPer1m] = useState('')
  const [cacheWritePer1m, setCacheWritePer1m] = useState('')
  const [saving, setSaving] = useState(false)
  const [formError, setFormError] = useState<string | null>(null)

  const load = () => {
    setLoading(true)
    getPricing()
      .then((r) => setPricing(r.data))
      .catch((e) => setError(e instanceof Error ? e.message : 'Failed to load'))
      .finally(() => setLoading(false))
  }

  useEffect(() => {
    load()
  }, [])

  const handleDelete = async (m: string) => {
    try {
      await deletePricing(m)
      load()
    } catch (e) {
      alert(e instanceof Error ? e.message : 'Delete failed')
    }
  }

  const handleSave = async (e: FormEvent) => {
    e.preventDefault()
    if (!model) {
      setFormError('Model name is required')
      return
    }
    setSaving(true)
    setFormError(null)
    try {
      await createPricing({
        model,
        input_per_1m: Number(inputPer1m) || 0,
        output_per_1m: Number(outputPer1m) || 0,
        cache_read_per_1m: Number(cacheReadPer1m) || 0,
        cache_write_per_1m: Number(cacheWritePer1m) || 0,
      })
      setModel('')
      setInputPer1m('')
      setOutputPer1m('')
      setCacheReadPer1m('')
      setCacheWritePer1m('')
      load()
    } catch (e) {
      setFormError(e instanceof Error ? e.message : 'Failed to save pricing')
    } finally {
      setSaving(false)
    }
  }

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 24 }}>
      {/* Pricing table */}
      <div
        style={{
          background: 'var(--card)',
          border: '1px solid var(--border)',
          borderRadius: 'var(--radius)',
          overflow: 'auto',
        }}
      >
        {loading ? (
          <LoadingSpinner />
        ) : error ? (
          <div style={{ padding: 16 }}>
            <ErrorMessage message={error} />
          </div>
        ) : (
          <table>
            <thead>
              <tr>
                <th>Model</th>
                <th>Input / 1M</th>
                <th>Output / 1M</th>
                <th>Cache Read / 1M</th>
                <th>Cache Write / 1M</th>
                <th></th>
              </tr>
            </thead>
            <tbody>
              {pricing.length === 0 ? (
                <tr>
                  <td colSpan={6} style={{ textAlign: 'center', color: 'var(--muted-foreground)', padding: '32px 0' }}>
                    No pricing data
                  </td>
                </tr>
              ) : (
                pricing.map((p) => (
                  <tr key={p.model}>
                    <td style={{ fontFamily: 'monospace', fontSize: 13 }}>{p.model}</td>
                    <td style={{ color: 'var(--muted-foreground)' }}>${p.input_per_1m?.toFixed(4)}</td>
                    <td style={{ color: 'var(--muted-foreground)' }}>${p.output_per_1m?.toFixed(4)}</td>
                    <td style={{ color: 'var(--muted-foreground)' }}>
                      {p.cache_read_per_1m != null ? `$${p.cache_read_per_1m.toFixed(4)}` : '—'}
                    </td>
                    <td style={{ color: 'var(--muted-foreground)' }}>
                      {p.cache_write_per_1m != null ? `$${p.cache_write_per_1m.toFixed(4)}` : '—'}
                    </td>
                    <td>
                      <button
                        onClick={() => handleDelete(p.model)}
                        style={{
                          background: 'transparent',
                          border: '1px solid var(--border)',
                          borderRadius: 'calc(var(--radius) - 2px)',
                          color: '#ef4444',
                          padding: '4px 10px',
                          fontSize: 12,
                          cursor: 'pointer',
                          transition: 'background 0.15s',
                        }}
                        onMouseEnter={(e) => (e.currentTarget.style.background = 'var(--accent)')}
                        onMouseLeave={(e) => (e.currentTarget.style.background = 'transparent')}
                      >
                        Delete
                      </button>
                    </td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
        )}
      </div>

      {/* Edit pricing form */}
      <div
        style={{
          background: 'var(--card)',
          border: '1px solid var(--border)',
          borderRadius: 'var(--radius)',
          padding: '20px',
        }}
      >
        <div style={{ fontWeight: 600, color: 'var(--foreground)', marginBottom: 16 }}>
          Add / Update Pricing
        </div>
        <form onSubmit={handleSave} style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
          <div>
            <label style={labelStyle}>Model Name</label>
            <input
              type="text"
              placeholder="e.g. claude-opus-4-5"
              value={model}
              onChange={(e) => setModel(e.target.value)}
              style={inputStyle}
              required
            />
          </div>
          <div style={{ display: 'flex', gap: 12, flexWrap: 'wrap' }}>
            <div style={{ flex: 1, minWidth: 120 }}>
              <label style={labelStyle}>Input / 1M tokens ($)</label>
              <input
                type="number"
                step="0.0001"
                min="0"
                placeholder="3.00"
                value={inputPer1m}
                onChange={(e) => setInputPer1m(e.target.value)}
                style={inputStyle}
              />
            </div>
            <div style={{ flex: 1, minWidth: 120 }}>
              <label style={labelStyle}>Output / 1M tokens ($)</label>
              <input
                type="number"
                step="0.0001"
                min="0"
                placeholder="15.00"
                value={outputPer1m}
                onChange={(e) => setOutputPer1m(e.target.value)}
                style={inputStyle}
              />
            </div>
            <div style={{ flex: 1, minWidth: 120 }}>
              <label style={labelStyle}>Cache Read / 1M ($)</label>
              <input
                type="number"
                step="0.0001"
                min="0"
                placeholder="0.30"
                value={cacheReadPer1m}
                onChange={(e) => setCacheReadPer1m(e.target.value)}
                style={inputStyle}
              />
            </div>
            <div style={{ flex: 1, minWidth: 120 }}>
              <label style={labelStyle}>Cache Write / 1M ($)</label>
              <input
                type="number"
                step="0.0001"
                min="0"
                placeholder="3.75"
                value={cacheWritePer1m}
                onChange={(e) => setCacheWritePer1m(e.target.value)}
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
                background: saving ? 'var(--secondary)' : 'var(--primary)',
                color: saving ? 'var(--secondary-foreground)' : 'var(--primary-foreground)',
                border: 'none',
                borderRadius: 'calc(var(--radius) - 2px)',
                padding: '10px 24px',
                fontSize: 14,
                fontWeight: 600,
                cursor: saving ? 'default' : 'pointer',
                opacity: saving ? 0.7 : 1,
                transition: 'opacity 0.15s',
              }}
            >
              {saving ? 'Saving...' : 'Save Pricing'}
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
  color: 'var(--muted-foreground)',
  marginBottom: 6,
  fontWeight: 500,
}

const inputStyle: React.CSSProperties = {
  width: '100%',
  background: 'var(--background)',
  border: '1px solid var(--border)',
  borderRadius: 'calc(var(--radius) - 2px)',
  padding: '8px 12px',
  color: 'var(--foreground)',
  fontSize: 14,
  outline: 'none',
}
