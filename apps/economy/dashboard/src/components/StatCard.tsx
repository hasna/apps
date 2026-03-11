interface StatCardProps {
  label: string
  value: string
  sub?: string
}

export function StatCard({ label, value, sub }: StatCardProps) {
  return (
    <div
      style={{
        background: '#1a1a1a',
        border: '1px solid #2a2a2a',
        borderRadius: 10,
        padding: '20px 24px',
        flex: 1,
        minWidth: 0,
      }}
    >
      <div style={{ color: '#9ca3af', fontSize: 13, marginBottom: 6 }}>{label}</div>
      <div style={{ fontSize: 28, fontWeight: 700, color: '#f9fafb', letterSpacing: '-0.02em' }}>
        {value}
      </div>
      {sub && <div style={{ color: '#6b7280', fontSize: 12, marginTop: 4 }}>{sub}</div>}
    </div>
  )
}
