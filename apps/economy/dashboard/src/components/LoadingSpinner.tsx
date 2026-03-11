export function LoadingSpinner() {
  return (
    <div style={{ display: 'flex', justifyContent: 'center', padding: '48px 0', color: 'var(--muted-foreground)' }}>
      Loading...
    </div>
  )
}

export function ErrorMessage({ message }: { message: string }) {
  return (
    <div
      style={{
        background: 'var(--destructive)',
        border: '1px solid var(--ring)',
        borderRadius: 'calc(var(--radius) - 2px)',
        padding: '12px 16px',
        color: 'var(--destructive-foreground)',
        fontSize: 14,
      }}
    >
      {message}
    </div>
  )
}
