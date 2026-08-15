import { Component, type ErrorInfo, type ReactNode } from "react";

interface Props {
  children: ReactNode;
}

interface State {
  hasError: boolean;
  error: Error | null;
}

export class ErrorBoundary extends Component<Props, State> {
  constructor(props: Props) {
    super(props);
    this.state = { hasError: false, error: null };
  }

  static getDerivedStateFromError(error: Error): State {
    return { hasError: true, error };
  }

  componentDidCatch(error: Error, info: ErrorInfo) {
    console.error("[ErrorBoundary]", error, info);
  }

  handleRetry = () => {
    this.setState({ hasError: false, error: null });
  };

  render() {
    if (this.state.hasError) {
      return (
        <div
          style={{
            display: "flex",
            flexDirection: "column",
            alignItems: "center",
            justifyContent: "center",
            minHeight: "50vh",
            gap: 16,
            color: "var(--text-muted)",
            textAlign: "center",
            padding: 40,
          }}
        >
          <div style={{ fontSize: 40 }}>⚠️</div>
          <h2 style={{ fontSize: 18, fontWeight: 600, color: "var(--text)", margin: 0 }}>
            Something went wrong
          </h2>
          <p style={{ fontSize: 13, margin: 0, maxWidth: 400, lineHeight: 1.6 }}>
            An unexpected error occurred. You can try refreshing the page or clicking the button below to retry.
          </p>
          {this.state.error && (
            <pre
              style={{
                fontSize: 11,
                background: "var(--bg-card)",
                border: "1px solid var(--border)",
                borderRadius: 6,
                padding: "8px 12px",
                color: "var(--red)",
                maxWidth: 480,
                overflowX: "auto",
                textAlign: "left",
              }}
            >
              {this.state.error.message}
            </pre>
          )}
          <button
            onClick={this.handleRetry}
            style={{
              padding: "8px 20px",
              borderRadius: 6,
              border: "1px solid var(--blue)",
              background: "var(--blue)",
              color: "#fff",
              cursor: "pointer",
              fontSize: 13,
              fontWeight: 600,
            }}
          >
            Retry
          </button>
        </div>
      );
    }

    return this.props.children;
  }
}
