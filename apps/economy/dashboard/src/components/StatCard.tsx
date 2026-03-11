interface StatCardProps {
  label: string
  value: string
  sub?: string
}

export function StatCard({ label, value, sub }: StatCardProps) {
  return (
    <div
      style={{
        background: 'var(--card)',
        border: '1px solid var(--border)',
        borderRadius: 'var(--radius)',
        padding: '20px 24px',
        flex: 1,
        minWidth: 0,
      }}
    >
      <div style={{ color: 'var(--muted-foreground)', fontSize: 13, marginBottom: 6 }}>{label}</div>
      <div style={{ fontSize: 28, fontWeight: 700, color: 'var(--foreground)', letterSpacing: '-0.02em' }}>
        {value}
      </div>
      {sub && <div style={{ color: 'var(--muted-foreground)', fontSize: 12, marginTop: 4, opacity: 0.8 }}>{sub}</div>}
    </div>
  )
}
