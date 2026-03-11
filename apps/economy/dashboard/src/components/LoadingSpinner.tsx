export function LoadingSpinner() {
  return (
    <div style={{ display: 'flex', justifyContent: 'center', padding: '48px 0', color: '#6b7280' }}>
      Loading...
    </div>
  )
}

export function ErrorMessage({ message }: { message: string }) {
  return (
    <div
      style={{
        background: '#2d1414',
        border: '1px solid #7f1d1d',
        borderRadius: 8,
        padding: '12px 16px',
        color: '#fca5a5',
        fontSize: 14,
      }}
    >
      {message}
    </div>
  )
}
