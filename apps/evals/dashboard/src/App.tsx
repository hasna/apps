import { useState, useEffect } from 'react'
import type { EvalRun } from './types'
import { RunList } from './components/RunList'
import { RunDetail } from './components/RunDetail'
import './App.css'

export default function App() {
  const [runs, setRuns] = useState<EvalRun[]>([])
  const [selected, setSelected] = useState<EvalRun | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)

  const loadRuns = () => {
    setLoading(true)
    fetch('/api/runs?limit=50')
      .then(r => r.json())
      .then((data: EvalRun[]) => { setRuns(data); setLoading(false) })
      .catch(e => { setError(String(e)); setLoading(false) })
  }

  useEffect(() => { loadRuns() }, [])

  return (
    <div className="app">
      <header>
        <div className="header-content">
          <h1>evals</h1>
          <span className="subtitle">@hasna/evals dashboard</span>
        </div>
        <button onClick={loadRuns} className="btn-refresh">↻ Refresh</button>
      </header>
      <main>
        {error && <div className="error">Cannot connect to evals-serve. Run: <code>evals-serve</code></div>}
        {loading && !error && <div className="loading">Loading runs...</div>}
        {!loading && !error && (
          <div className="layout">
            <aside><RunList runs={runs} selected={selected} onSelect={setSelected} /></aside>
            <section>
              {selected ? <RunDetail run={selected} /> : <div className="empty">Select a run to view details</div>}
            </section>
          </div>
        )}
      </main>
    </div>
  )
}
