import { useEffect, useState, useCallback } from 'react'
import {
  LineChart,
  Line,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  Legend,
  ResponsiveContainer,
} from 'recharts'
import { getSummary, getDaily, syncSources } from '../api'
import type { Summary, DailyEntry } from '../api'
import { StatCard } from '../components/StatCard'
import { LoadingSpinner, ErrorMessage } from '../components/LoadingSpinner'

function formatUsd(val: number) {
  if (val == null) return '$0.0000'
  if (val >= 100) return `$${val.toFixed(2)}`
  if (val >= 1) return `$${val.toFixed(4)}`
  return `$${val.toFixed(6)}`
}

function formatDate(d: string) {
  return d.slice(5) // MM-DD
}

interface ChartEntry {
  date: string
  claude: number
  codex: number
}

function buildChartData(entries: DailyEntry[]): ChartEntry[] {
  const map = new Map<string, ChartEntry>()
  for (const e of entries) {
    const key = e.date
    if (!map.has(key)) map.set(key, { date: formatDate(key), claude: 0, codex: 0 })
    const row = map.get(key)!
    if (e.agent === 'claude') row.claude += e.cost_usd
    else if (e.agent === 'codex') row.codex += e.cost_usd
    else {
      row.claude += e.cost_usd
    }
  }
  return Array.from(map.values()).sort((a, b) => a.date.localeCompare(b.date))
}

export function OverviewTab() {
  const [todaySummary, setTodaySummary] = useState<Summary | null>(null)
  const [weekSummary, setWeekSummary] = useState<Summary | null>(null)
  const [monthSummary, setMonthSummary] = useState<Summary | null>(null)
  const [chartData, setChartData] = useState<ChartEntry[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [syncing, setSyncing] = useState(false)
  const [syncMsg, setSyncMsg] = useState<string | null>(null)

  const load = useCallback(async () => {
    setLoading(true)
    setError(null)
    try {
      const [t, w, m, daily] = await Promise.all([
        getSummary('today'),
        getSummary('week'),
        getSummary('month'),
        getDaily(30),
      ])
      setTodaySummary(t.data)
      setWeekSummary(w.data)
      setMonthSummary(m.data)
      setChartData(buildChartData(daily.data))
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Failed to load data')
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => {
    load()
  }, [load])

  const handleSync = async () => {
    setSyncing(true)
    setSyncMsg(null)
    try {
      await syncSources('all')
      setSyncMsg('Sync complete')
      load()
    } catch (e) {
      setSyncMsg(e instanceof Error ? e.message : 'Sync failed')
    } finally {
      setSyncing(false)
      setTimeout(() => setSyncMsg(null), 3000)
    }
  }

  if (loading) return <LoadingSpinner />
  if (error) return <ErrorMessage message={error} />

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 24 }}>
      {/* Header row */}
      <div style={{ display: 'flex', gap: 16, alignItems: 'flex-start' }}>
        <StatCard
          label="Today"
          value={formatUsd(todaySummary?.total_usd ?? 0)}
          sub={`${todaySummary?.sessions ?? 0} sessions`}
        />
        <StatCard
          label="This Week"
          value={formatUsd(weekSummary?.total_usd ?? 0)}
          sub={`${weekSummary?.sessions ?? 0} sessions`}
        />
        <StatCard
          label="This Month"
          value={formatUsd(monthSummary?.total_usd ?? 0)}
          sub={`${monthSummary?.sessions ?? 0} sessions`}
        />
        <div style={{ display: 'flex', flexDirection: 'column', gap: 8, justifyContent: 'center' }}>
          <button
            onClick={handleSync}
            disabled={syncing}
            style={{
              background: syncing ? '#1e3a5f' : '#1d4ed8',
              color: '#fff',
              border: 'none',
              borderRadius: 8,
              padding: '10px 20px',
              fontSize: 14,
              fontWeight: 600,
              cursor: syncing ? 'default' : 'pointer',
              whiteSpace: 'nowrap',
              opacity: syncing ? 0.7 : 1,
            }}
          >
            {syncing ? 'Syncing...' : 'Sync Now'}
          </button>
          {syncMsg && (
            <div style={{ fontSize: 12, color: '#22c55e', textAlign: 'center' }}>{syncMsg}</div>
          )}
        </div>
      </div>

      {/* Daily chart */}
      <div
        style={{
          background: '#1a1a1a',
          border: '1px solid #2a2a2a',
          borderRadius: 10,
          padding: '24px',
        }}
      >
        <div style={{ fontSize: 15, fontWeight: 600, marginBottom: 20, color: '#e5e7eb' }}>
          Daily Cost — Last 30 Days
        </div>
        {chartData.length === 0 ? (
          <div style={{ color: '#6b7280', textAlign: 'center', padding: '32px 0' }}>
            No data available
          </div>
        ) : (
          <ResponsiveContainer width="100%" height={280}>
            <LineChart data={chartData} margin={{ top: 4, right: 16, left: 0, bottom: 4 }}>
              <CartesianGrid strokeDasharray="3 3" stroke="#2a2a2a" />
              <XAxis
                dataKey="date"
                tick={{ fill: '#6b7280', fontSize: 11 }}
                axisLine={{ stroke: '#2a2a2a' }}
                tickLine={false}
              />
              <YAxis
                tick={{ fill: '#6b7280', fontSize: 11 }}
                axisLine={false}
                tickLine={false}
                tickFormatter={(v) => `$${Number(v).toFixed(3)}`}
                width={60}
              />
              <Tooltip
                contentStyle={{
                  background: '#1e1e1e',
                  border: '1px solid #333',
                  borderRadius: 6,
                  fontSize: 13,
                }}
                labelStyle={{ color: '#9ca3af' }}
                formatter={(val) => [`$${Number(val).toFixed(4)}`, undefined]}
              />
              <Legend
                wrapperStyle={{ fontSize: 13, color: '#9ca3af', paddingTop: 12 }}
              />
              <Line
                type="monotone"
                dataKey="claude"
                stroke="#3b82f6"
                strokeWidth={2}
                dot={false}
                name="Claude"
              />
              <Line
                type="monotone"
                dataKey="codex"
                stroke="#f97316"
                strokeWidth={2}
                dot={false}
                name="Codex"
              />
            </LineChart>
          </ResponsiveContainer>
        )}
      </div>
    </div>
  )
}
