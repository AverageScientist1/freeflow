import { Component, type ErrorInfo, type ReactNode } from 'react'

interface Props { children: ReactNode }
interface State { error: Error | null }

// Shows a message instead of a blank window if something in the UI throws.
export class ErrorBoundary extends Component<Props, State> {
  state: State = { error: null }

  static getDerivedStateFromError(error: Error): State {
    return { error }
  }

  componentDidCatch(error: Error, info: ErrorInfo): void {
    console.error('UI error', error, info.componentStack)
  }

  render(): ReactNode {
    if (!this.state.error) return this.props.children
    return (
      <div className="empty-state" role="alert">
        <h2>Something went wrong</h2>
        <p>{this.state.error.message}</p>
        <p className="muted">Your Workbench file on disk was not changed. Reload to continue.</p>
        <button type="button" className="btn primary" onClick={() => window.location.reload()}>Reload</button>
      </div>
    )
  }
}
