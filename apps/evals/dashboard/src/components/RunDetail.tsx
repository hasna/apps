import type { EvalRun, EvalResult, Verdict } from '../types'

interface Props {
  run: EvalRun
}

function VerdictBadge({ verdict, error }: { verdict: Verdict; error?: string }) {
  if (error) return <span className="verdict verdict-unknown">⚠ ERROR</span>
  if (verdict === 'PASS') return <span className="verdict verdict-pass">✓ PASS</span>
  if (verdict === 'FAIL') return <span className="verdict verdict-fail">✗ FAIL</span>
  return <span className="verdict verdict-unknown">? UNKNOWN</span>
}

function ResultRow({ result, expanded, onToggle }: {
  result: EvalResult
  expanded: boolean
  onToggle: () => void
}) {
  const hasDetails = result.error || result.judgeResult || result.assertionResults.some(a => !a.passed)

  return (
    <>
      <tr
        className={`result-row ${result.verdict === 'PASS' ? '' : 'result-row-fail'} ${hasDetails ? 'clickable' : ''}`}
        onClick={hasDetails ? onToggle : undefined}
      >
        <td><VerdictBadge verdict={result.verdict} error={result.error} /></td>
        <td className="case-id">{result.caseId}</td>
        <td className="output-preview">{result.output.slice(0, 80)}{result.output.length > 80 ? '…' : ''}</td>
        <td>{result.durationMs}ms</td>
        <td>{result.costUsd ? `$${result.costUsd.toFixed(4)}` : '—'}</td>
        <td>{result.passRate !== undefined ? `${(result.passRate * 100).toFixed(0)}% (×${result.repeatVerdicts?.length})` : '—'}</td>
        {hasDetails && <td>{expanded ? '▲' : '▼'}</td>}
      </tr>
      {expanded && hasDetails && (
        <tr className="detail-row">
          <td colSpan={7}>
            <div className="detail-content">
              {result.error && <p className="detail-error">Error: {result.error}</p>}
              {result.assertionResults.filter(a => !a.passed).map((a, i) => (
                <p key={i} className="detail-assertion">✗ {a.type}: {a.reason}</p>
              ))}
              {result.judgeResult && (
                <div className="detail-judge">
                  <strong>Judge reasoning:</strong>
                  <p>{result.judgeResult.reasoning}</p>
                </div>
              )}
            </div>
          </td>
        </tr>
      )}
    </>
  )
}

export function RunDetail({ run }: Props) {
  const { stats } = run
  const pct = (stats.passRate * 100).toFixed(1)
  const date = new Date(run.createdAt).toLocaleString()

  const [expanded, setExpanded] = useState<Set<string>>(new Set())
  const toggle = (id: string) => setExpanded(prev => {
    const next = new Set(prev)
    next.has(id) ? next.delete(id) : next.add(id)
    return next
  })

  return (
    <div className="run-detail">
      <div className="run-detail-header">
        <div>
          <h2>{run.dataset.split('/').pop()}</h2>
          <div className="run-detail-meta">
            <code>{run.id.slice(0, 8)}</code>
            <span>{date}</span>
          </div>
        </div>
        <div className="run-stats">
          <div className={`stat-score ${stats.passRate === 1 ? 'green' : stats.passRate >= 0.8 ? 'yellow' : 'red'}`}>
            {stats.passed}/{stats.total} <small>({pct}%)</small>
          </div>
          <div className="stat-row">
            {stats.failed > 0 && <span className="stat-fail">{stats.failed} failed</span>}
            {stats.unknown > 0 && <span className="stat-unknown">{stats.unknown} unknown</span>}
            {stats.errors > 0 && <span className="stat-error">{stats.errors} errors</span>}
            <span className="stat-time">{(stats.totalDurationMs / 1000).toFixed(1)}s</span>
            {stats.totalCostUsd > 0 && <span className="stat-cost">${stats.totalCostUsd.toFixed(4)}</span>}
          </div>
        </div>
      </div>

      <table className="results-table">
        <thead>
          <tr>
            <th>Verdict</th>
            <th>Case ID</th>
            <th>Output</th>
            <th>Duration</th>
            <th>Cost</th>
            <th>Pass^k</th>
            <th></th>
          </tr>
        </thead>
        <tbody>
          {run.results.map(r => (
            <ResultRow
              key={r.caseId}
              result={r}
              expanded={expanded.has(r.caseId)}
              onToggle={() => toggle(r.caseId)}
            />
          ))}
        </tbody>
      </table>
    </div>
  )
}

// useState needs to be imported — add it
import { useState } from 'react'
