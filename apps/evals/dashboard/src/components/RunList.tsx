import type { EvalRun } from '../types'

interface Props {
  runs: EvalRun[]
  selected: EvalRun | null
  onSelect: (run: EvalRun) => void
}

export function RunList({ runs, selected, onSelect }: Props) {
  if (runs.length === 0) {
    return (
      <div className="run-list-empty">
        <p>No runs yet.</p>
        <p>Run <code>evals run dataset.jsonl --adapter http --url http://localhost:3000/api/chat --save</code></p>
      </div>
    )
  }

  return (
    <div className="run-list">
      <div className="run-list-header">
        <span>{runs.length} run{runs.length !== 1 ? 's' : ''}</span>
      </div>
      {runs.map(run => {
        const pct = (run.stats.passRate * 100).toFixed(0)
        const isSelected = selected?.id === run.id
        const color = run.stats.passRate === 1 ? 'green' : run.stats.passRate >= 0.8 ? 'yellow' : 'red'
        const date = new Date(run.createdAt).toLocaleDateString(undefined, { month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' })

        return (
          <button
            key={run.id}
            className={`run-item ${isSelected ? 'selected' : ''}`}
            onClick={() => onSelect(run)}
          >
            <div className="run-item-top">
              <span className={`badge badge-${color}`}>{pct}%</span>
              <span className="run-id">{run.id.slice(0, 8)}</span>
            </div>
            <div className="run-dataset">{run.dataset.split('/').pop()}</div>
            <div className="run-meta">
              <span>{run.stats.passed}/{run.stats.total} passed</span>
              <span>{date}</span>
            </div>
          </button>
        )
      })}
    </div>
  )
}
